import { Router, Request, Response } from 'express';
import { GmailRuntimeService } from '../services/dispatch/gmail-runtime.service';

const router = Router();

/**
 * POST /api/dev/test-email
 * Dev-only: send a test email via GmailRuntimeService
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { to, subject, body } = req.body;

    if (!to || !subject || !body) {
      return res.status(400).json({ error: 'Missing required fields: to, subject, body' });
    }

    const result = await GmailRuntimeService.sendEmail({ to, subject, body });

    res.json({
      success: true,
      messageId: result.messageId,
      threadId: result.threadId,
    });
  } catch (error) {
    console.error('Test email error:', error);
    res.status(500).json({
      error: 'Failed to send email',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;
