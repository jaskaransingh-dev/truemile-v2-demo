import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { createClient } from '@supabase/supabase-js';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import sharp from 'sharp';

/**
 * Process a captured image into a grayscale high-contrast document "scan" look.
 * Writes to a sibling file with _scanned.jpg suffix and returns its path.
 */
async function processToScanLook(inputPath: string): Promise<string> {
  const outputPath = inputPath.replace(/\.[^.]+$/, '_scanned.jpg');

  await sharp(inputPath)
    .grayscale()
    .normalise()
    .linear(1.5, -(128 * 0.5))  // increase contrast
    .sharpen({ sigma: 1.5 })     // sharpen edges for document look
    .jpeg({ quality: 90 })
    .toFile(outputPath);

  return outputPath;
}

const POD_BOL_RECIPIENT = 'hsdhaliwal144@gmail.com';

/**
 * Send an email with a file attachment using the same Gmail OAuth client
 * pattern as GmailRuntimeService. Builds a multipart/mixed MIME body.
 * Throws on failure — callers decide how to handle.
 */
async function sendEmailWithAttachment(params: {
  to: string;
  subject: string;
  body: string;
  attachment: { filename: string; mimeType: string; data: Buffer };
}): Promise<{ messageId: string; threadId: string | null }> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Gmail OAuth env vars missing (GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN)');
  }

  const oauthClient = new OAuth2Client(clientId, clientSecret, process.env.GOOGLE_REDIRECT_URI);
  oauthClient.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: 'v1', auth: oauthClient });

  // Resolve sender email
  let from = process.env.GMAIL_SENDER_EMAIL;
  if (!from) {
    const profile = await gmail.users.getProfile({ userId: 'me' });
    from = profile.data.emailAddress || 'royalcarrier3@gmail.com';
  }

  const boundary = `tm_boundary_${Date.now()}`;
  const attachmentBase64 = params.attachment.data.toString('base64');
  // Wrap base64 at 76 chars per MIME spec
  const wrappedAttachment = attachmentBase64.match(/.{1,76}/g)?.join('\r\n') || attachmentBase64;

  const mime = [
    `To: ${params.to}`,
    `From: ${from}`,
    `Subject: ${params.subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    params.body,
    '',
    `--${boundary}`,
    `Content-Type: ${params.attachment.mimeType}; name="${params.attachment.filename}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${params.attachment.filename}"`,
    '',
    wrappedAttachment,
    '',
    `--${boundary}--`,
  ].join('\r\n');

  const raw = Buffer.from(mime).toString('base64url');

  const result = await gmail.users.messages.send({
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

const router = Router();

const DOC_DIR = path.join('/tmp', 'driver-docs');
if (!fs.existsSync(DOC_DIR)) fs.mkdirSync(DOC_DIR, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
});

// ---------------------------------------------------------------------------
// POST /api/documents/upload — receive scanned document from driver app
// ---------------------------------------------------------------------------

// Use multer.any() — accepts any file field name AND parses all text fields into req.body.
// More forgiving than .single() if the client ever changes the file field name.
router.post('/upload', upload.any(), async (req: Request, res: Response) => {
  const files = (req.files as Express.Multer.File[]) || [];
  const file = files.find(f => f.fieldname === 'file') || files[0];

  // Accept driverPhone from body, query, or header (mobile can fall back to header if form field fails)
  const driverPhone =
    (req.body.driverPhone && String(req.body.driverPhone).trim()) ||
    (req.body.phone && String(req.body.phone).trim()) ||
    (req.query.driverPhone && String(req.query.driverPhone).trim()) ||
    (typeof req.headers['x-driver-phone'] === 'string' && req.headers['x-driver-phone'].trim()) ||
    '';
  const docType = (req.body.docType || req.query.docType || req.headers['x-doc-type'] || '').toString();

  if (!file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    const filename = `${docType || 'DOC'}-${Date.now()}-${file.originalname || 'scan.jpg'}`;
    const filepath = path.join(DOC_DIR, filename);
    fs.writeFileSync(filepath, file.buffer);

    console.log(`[driver-app] document saved: ${filename} (${file.size} bytes) type=${docType}`);

    // Post-process into scan look (grayscale + contrast + sharpen). Non-blocking on failure.
    let scannedPath: string | null = null;
    try {
      scannedPath = await processToScanLook(filepath);
      console.log('[upload] scan processing complete:', scannedPath);
    } catch (procErr: any) {
      console.warn('[upload] scan processing failed, falling back to original:', procErr.message);
    }

    // Email POD/BOL to dispatch recipient — failure does not block the upload
    if (docType === 'POD' || docType === 'BOL') {
      try {
        const now = new Date();
        const timestamp = now.toLocaleString('en-US', {
          month: 'short', day: 'numeric', year: 'numeric',
          hour: 'numeric', minute: '2-digit', hour12: true,
        });
        // Use ASCII hyphen (not em dash) to avoid MIME encoding issues on some clients
        const subject = `${docType} received from driver - ${timestamp}`;
        const body =
          `A new ${docType} has been uploaded by driver ${driverPhone || '(unknown)'}.\n\n` +
          `Document attached.\n\n` +
          `- TrueMile Dispatch`;

        // Prefer processed scan; fall back to original buffer if processing failed
        let attachmentData: Buffer;
        let attachmentName: string;
        let attachmentMime: string;
        if (scannedPath) {
          attachmentData = fs.readFileSync(scannedPath);
          attachmentName = `${docType}-scanned.jpg`;
          attachmentMime = 'image/jpeg';
        } else {
          attachmentData = file.buffer;
          attachmentName = file.originalname || filename;
          attachmentMime = file.mimetype || 'application/octet-stream';
        }

        const result = await sendEmailWithAttachment({
          to: POD_BOL_RECIPIENT,
          subject,
          body,
          attachment: {
            filename: attachmentName,
            mimeType: attachmentMime,
            data: attachmentData,
          },
        });
        console.log(`[driver-app] ${docType} emailed to ${POD_BOL_RECIPIENT} (message=${result.messageId})`);
      } catch (emailErr: any) {
        console.error(`[driver-app] ${docType} email send failed:`, emailErr.message);
        // Do not fail the upload — driver already sent the file
      }
    }

    return res.json({ success: true, docId: filename });
  } catch (err: any) {
    console.error('[driver-app] document upload error:', err.message);
    return res.status(500).json({ error: 'Failed to save document' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/drivers/messages?phone=X — fetch chat messages
// ---------------------------------------------------------------------------

router.get('/messages', async (req: Request, res: Response) => {
  const phone = req.query.phone as string;
  if (!phone) {
    return res.status(400).json({ error: 'phone query param required' });
  }

  try {
    const messages = await prisma.chatMessage.findMany({
      where: { driverPhone: phone },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });

    // Seed demo messages if none exist
    if (messages.length === 0) {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const seeded = await Promise.all([
        prisma.chatMessage.create({
          data: {
            driverPhone: phone,
            senderType: 'DISPATCHER',
            senderName: 'Dispatch',
            text: 'Hey — just checking in, how\'s the run going?',
            createdAt: yesterday,
          },
        }),
        prisma.chatMessage.create({
          data: {
            driverPhone: phone,
            senderType: 'DRIVER',
            senderName: 'Driver',
            text: 'All good, on track.',
            createdAt: new Date(yesterday.getTime() + 60000),
          },
        }),
      ]);
      return res.json({ messages: seeded });
    }

    return res.json({ messages });
  } catch (err: any) {
    console.error('[driver-app] messages fetch error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/drivers/messages — send a chat message
// ---------------------------------------------------------------------------

router.post('/messages', async (req: Request, res: Response) => {
  const { phone, text, senderType, senderName } = req.body;

  if (!phone || !text) {
    return res.status(400).json({ error: 'phone and text required' });
  }

  try {
    const message = await prisma.chatMessage.create({
      data: {
        driverPhone: phone,
        senderType: senderType || 'DRIVER',
        senderName: senderName || 'Driver',
        text,
      },
    });

    // Broadcast to Supabase Realtime
    try {
      const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
      if (supabaseUrl && supabaseKey) {
        const supabase = createClient(supabaseUrl, supabaseKey);
        await supabase.channel(`chat-${phone}`).send({
          type: 'broadcast',
          event: 'new-message',
          payload: message,
        });
      }
    } catch (rtErr) {
      console.warn('[driver-app] realtime broadcast failed:', rtErr);
    }

    console.log(`[driver-app] message from ${senderType}: ${text.substring(0, 50)}`);
    return res.json({ success: true, message });
  } catch (err: any) {
    console.error('[driver-app] message send error:', err.message);
    return res.status(500).json({ error: 'Failed to send message' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/drivers/status — update driver operational status
// ---------------------------------------------------------------------------

router.put('/status', async (req: Request, res: Response) => {
  const { phone, status } = req.body;

  if (!phone || !status) {
    return res.status(400).json({ error: 'phone and status required' });
  }

  try {
    const driver = await prisma.driver.findFirst({
      where: { phoneNumber: phone },
    });

    if (!driver) {
      return res.status(404).json({ error: 'Driver not found' });
    }

    await prisma.driverOperationalState.upsert({
      where: { driverId: driver.id },
      update: { status },
      create: { driverId: driver.id, status },
    });

    console.log(`[driver-app] status update: ${driver.name} → ${status}`);
    return res.json({ success: true, status });
  } catch (err: any) {
    console.error('[driver-app] status update error:', err.message);
    return res.status(500).json({ error: 'Failed to update status' });
  }
});

export default router;
