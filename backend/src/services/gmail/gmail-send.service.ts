import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { prisma } from '../db';
import { decryptToken } from '../../utils/encryption';

interface SendEmailParams {
  to: string;
  subject: string;
  body: string;
  from?: string;
}

interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export class GmailSendService {
  
  /**
   * Send email via Gmail API
   */
  static async sendEmail(
    emailAccountId: string,
    params: SendEmailParams
  ): Promise<SendEmailResult> {
    try {
      // Get email account with decrypted tokens
      const account = await prisma.emailAccount.findUnique({
        where: { id: emailAccountId }
      });

      if (!account) {
        return { success: false, error: 'Email account not found' };
      }

      if (!account.isActive) {
        return { success: false, error: 'Email account is not active' };
      }

      // Setup OAuth2 client
      const oauth2Client = new OAuth2Client(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
      );

      // Decrypt tokens before using
      const accessToken = decryptToken(account.accessToken);
      const refreshToken = account.refreshToken ? decryptToken(account.refreshToken) : null;

      oauth2Client.setCredentials({
        access_token: accessToken,
        refresh_token: refreshToken || undefined,
        expiry_date: account.tokenExpiry?.getTime()
      });

      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

      // Create email in RFC 2822 format
      const email = this.createEmailMessage(params);
      const encodedEmail = Buffer.from(email).toString('base64url');

      // Send email
      const response = await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedEmail
        }
      });

      if (response.data.id) {
        return {
          success: true,
          messageId: response.data.id
        };
      } else {
        return {
          success: false,
          error: 'No message ID returned from Gmail'
        };
      }

    } catch (error: any) {
      console.error('Gmail send error:', error);
      return {
        success: false,
        error: error.message || 'Failed to send email'
      };
    }
  }

  /**
   * Create RFC 2822 formatted email message
   */
  private static createEmailMessage(params: SendEmailParams): string {
    const { to, subject, body, from } = params;
    
    const messageBody = body && body.trim().length > 0 ? body.trim() : 'No content';
    
    const lines = [
      `To: ${to}`,
      from ? `From: ${from}` : `From: Unknown`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      messageBody
    ];

    return lines.join('\r\n');
  }

  /**
   * Get the user's Gmail address
   */
  static async getGmailAddress(emailAccountId: string): Promise<string | null> {
    try {
      const account = await prisma.emailAccount.findUnique({
        where: { id: emailAccountId }
      });

      if (!account) return null;

      const oauth2Client = new OAuth2Client(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
      );

      // Decrypt tokens before using
      const accessToken = decryptToken(account.accessToken);
      const refreshToken = account.refreshToken ? decryptToken(account.refreshToken) : null;

      oauth2Client.setCredentials({
        access_token: accessToken,
        refresh_token: refreshToken || undefined,
        expiry_date: account.tokenExpiry?.getTime()
      });

      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      const profile = await gmail.users.getProfile({ userId: 'me' });

      return profile.data.emailAddress || null;

    } catch (error) {
      console.error('Error getting Gmail address:', error);
      return null;
    }
  }

  /**
   * Send email from first active Gmail account
   */
  static async sendFromFirstAccount(params: SendEmailParams): Promise<SendEmailResult> {
    try {
      // Find first active Gmail account
      const account = await prisma.emailAccount.findFirst({
        where: {
          provider: 'GMAIL',
          isActive: true
        },
        orderBy: {
          lastSyncAt: 'desc'
        }
      });

      if (!account) {
        return {
          success: false,
          error: 'No active Gmail account found. Please connect Gmail first.'
        };
      }

      // Get sender email address
      const senderEmail = await this.getGmailAddress(account.id);
      if (senderEmail) {
        params.from = senderEmail;
      }

      return this.sendEmail(account.id, params);

    } catch (error: any) {
      console.error('Send from first account error:', error);
      return {
        success: false,
        error: error.message || 'Failed to send email'
      };
    }
  }
}

export default GmailSendService;