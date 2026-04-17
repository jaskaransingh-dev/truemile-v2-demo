// src/services/gmail/oauth.service.ts

import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { prisma } from '../db';
import { encryptToken, decryptToken } from '../../utils/encryption';

const oauth2Client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',  // ← ADD THIS
  'https://www.googleapis.com/auth/userinfo.email',
  'openid'
];

export class GmailOAuthService {
  /**
   * Generate authorization URL for user consent
   */
  static getAuthUrl(userId: string): string {
    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent',
      state: JSON.stringify({ userId, provider: 'gmail' })
    });
  }

  /**
   * Handle OAuth callback and store tokens
   */
  static async handleCallback(code: string, userId: string): Promise<void> {
    try {
      const { tokens } = await oauth2Client.getToken(code);
      
      if (!tokens.access_token) {
        throw new Error('No access token received from Google');
      }

      if (!tokens.refresh_token) {
        console.error('WARNING: No refresh token received.');
      }

      console.log('✓ Access token received');
      console.log('✓ Refresh token received:', !!tokens.refresh_token);
      if (tokens.refresh_token) {
        console.log('═══ REFRESH TOKEN (copy to .env as GOOGLE_REFRESH_TOKEN) ═══');
        console.log(tokens.refresh_token);
        console.log('═════════════════════════════════════════════════════════════');
      }

      oauth2Client.setCredentials(tokens);
      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const { data } = await oauth2.userinfo.get();
      
      if (!data.email) {
        throw new Error('Could not retrieve user email');
      }

      console.log('✓ Successfully authenticated user:', data.email);

      const tokenExpiry = tokens.expiry_date 
        ? new Date(tokens.expiry_date)
        : new Date(Date.now() + 3600 * 1000);

      // Create or get user by email (email is unique, id is auto-generated)
      const dbUser = await prisma.user.upsert({
        where: { email: data.email },
        create: {
          email: data.email,
          name: data.name || null
        },
        update: {
          name: data.name || null
        }
      });

      await prisma.emailAccount.upsert({
        where: {
          userId_email_provider: {
            userId: dbUser.id,
            email: data.email,
            provider: 'GMAIL'
          }
        },
        create: {
          userId: dbUser.id,
          provider: 'GMAIL',
          email: data.email,
          accessToken: encryptToken(tokens.access_token),
          refreshToken: tokens.refresh_token ? encryptToken(tokens.refresh_token) : null,
          tokenExpiry,
          isActive: true
        },
        update: {
          accessToken: encryptToken(tokens.access_token),
          refreshToken: tokens.refresh_token ? encryptToken(tokens.refresh_token) : null,
          tokenExpiry,
          isActive: true,
          updatedAt: new Date()
        }
      });

      console.log('✓ Tokens stored in database');
    } catch (error) {
      console.error('Gmail OAuth callback error:', error);
      throw new Error('Failed to complete Gmail authentication');
    }
  }

  /**
   * Get valid OAuth2 client for an email account
   * skipValidation prevents infinite loops during token refresh
   */
  static async getAuthClient(emailAccountId: string, skipValidation = false): Promise<OAuth2Client> {
    const account = await prisma.emailAccount.findUnique({
      where: { id: emailAccountId }
    });

    if (!account || account.provider !== 'GMAIL') {
      throw new Error('Gmail account not found');
    }

    if (!skipValidation) {
      console.log('=== Gmail Token Status for', account.email, '===');
      console.log('Token expiry:', account.tokenExpiry);
      console.log('Has refresh token?', !!account.refreshToken);
    }

    const client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    const accessToken = decryptToken(account.accessToken);
    const refreshToken = account.refreshToken ? decryptToken(account.refreshToken) : null;

    client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
      expiry_date: account.tokenExpiry?.getTime()
    });

    // Check if token is expired
    if (this.isTokenExpired(account.tokenExpiry)) {
      if (!refreshToken) {
        console.error('✗ Token expired and no refresh token available');
        await prisma.emailAccount.update({
          where: { id: emailAccountId },
          data: { isActive: false }
        });
        throw new Error('Token expired and no refresh token - user must re-authenticate');
      }
      
      console.log('Token expired, refreshing...');
      await this.refreshAccessToken(emailAccountId);
      return this.getAuthClient(emailAccountId, true); // Skip validation on retry
    }

    return client;
  }

  /**
   * Refresh access token using refresh token
   */
  static async refreshAccessToken(emailAccountId: string): Promise<void> {
    const account = await prisma.emailAccount.findUnique({
      where: { id: emailAccountId }
    });

    if (!account || !account.refreshToken) {
      throw new Error('Cannot refresh token: account or refresh token not found');
    }

    const client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    try {
      const refreshToken = decryptToken(account.refreshToken);
      console.log('Attempting token refresh...');

      client.setCredentials({
        refresh_token: refreshToken
      });

      const { credentials } = await client.refreshAccessToken();

      if (!credentials.access_token) {
        throw new Error('No access token returned from refresh');
      }

      console.log('✓ Token refresh successful');

      const tokenExpiry = credentials.expiry_date
        ? new Date(credentials.expiry_date)
        : new Date(Date.now() + 3600 * 1000);

      await prisma.emailAccount.update({
        where: { id: emailAccountId },
        data: {
          accessToken: encryptToken(credentials.access_token),
          tokenExpiry,
          updatedAt: new Date()
        }
      });

      console.log('✓ Updated token stored');
    } catch (error: any) {
      console.error('✗ Token refresh failed:', error.message);

      await prisma.emailAccount.update({
        where: { id: emailAccountId },
        data: { isActive: false }
      });

      throw new Error('Failed to refresh Gmail token - user needs to re-authenticate');
    }
  }

  /**
   * Check if token is expired or about to expire (within 5 minutes)
   */
  private static isTokenExpired(expiry: Date | null): boolean {
    if (!expiry) return true;
    const bufferMs = 5 * 60 * 1000;
    return expiry.getTime() - Date.now() < bufferMs;
  }

  /**
   * Revoke access and delete account
   */
  static async revokeAccess(emailAccountId: string): Promise<void> {
    const account = await prisma.emailAccount.findUnique({
      where: { id: emailAccountId }
    });

    if (!account) return;

    try {
      const client = new OAuth2Client(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET
      );
      
      const accessToken = decryptToken(account.accessToken);
      await client.revokeToken(accessToken);
    } catch (error) {
      console.error('Error revoking Gmail token:', error);
    }

    await prisma.emailAccount.delete({
      where: { id: emailAccountId }
    });
  }
}