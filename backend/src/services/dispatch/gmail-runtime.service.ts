import { google, gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export class GmailRuntimeService {
  private static oauthClient: OAuth2Client | null = null;
  private static senderEmail: string | null = null;

  private static getClient(): OAuth2Client {
    if (!this.oauthClient) {
      this.oauthClient = new OAuth2Client(
        required('GOOGLE_CLIENT_ID'),
        required('GOOGLE_CLIENT_SECRET'),
        process.env.GOOGLE_REDIRECT_URI
      );
    }

    this.oauthClient.setCredentials({
      refresh_token: required('GOOGLE_REFRESH_TOKEN'),
    });

    return this.oauthClient;
  }

  private static gmail(): gmail_v1.Gmail {
    return google.gmail({ version: 'v1', auth: this.getClient() });
  }

  static async getSenderEmail(): Promise<string> {
    if (this.senderEmail) return this.senderEmail;

    if (process.env.GMAIL_SENDER_EMAIL) {
      this.senderEmail = process.env.GMAIL_SENDER_EMAIL;
      return this.senderEmail;
    }

    const profile = await this.gmail().users.getProfile({ userId: 'me' });
    this.senderEmail = profile.data.emailAddress || 'royalcarrier3@gmail.com';
    return this.senderEmail;
  }

  static async sendEmail(params: {
    to: string;
    subject: string;
    body: string;
  }): Promise<{ messageId: string; threadId: string | null }> {
    const from = await this.getSenderEmail();
    const lines = [
      `To: ${params.to}`,
      `From: ${from}`,
      `Subject: ${params.subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      params.body,
    ];

    const raw = Buffer.from(lines.join('\r\n')).toString('base64url');

    const result = await this.gmail().users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });

    if (!result.data.id) {
      throw new Error('Gmail send failed: missing message id');
    }

    return {
      messageId: result.data.id,
      threadId: result.data.threadId || null,
    };
  }

  static async getThread(threadId: string): Promise<gmail_v1.Schema$Thread> {
    const result = await this.gmail().users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'full',
    });
    return result.data;
  }
}
