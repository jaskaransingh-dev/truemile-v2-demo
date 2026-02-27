import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { requireAuth, AuthRequest } from '../middleware/auth';
import {
  ingestDATSnapshot,
  resolveCarrierIdFromExtensionKey,
} from '../services/dispatch/dat-ingest.service';
import { runDispatchForDriver } from '../services/dispatch/dispatch-run.service';
import { applyApprovalActionByToken } from '../services/dispatch/approval.service';
import { prisma } from '../services/db';
import { sha256 } from '../services/dispatch/hash';

const router = Router();

const ROYAL_CARRIERS_FLEET_ID = 'cmhdsm44q001d8ze7ixwu9igs';

function getExtensionKey(req: Request): string {
  const value = req.headers['x-extension-key'];
  if (typeof value === 'string') return value;
  return '';
}

router.post('/integrations/dat/keys', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { name } = req.body as { name?: string };
    const rawKey = crypto.randomBytes(32).toString('hex');

    const created = await prisma.dATIntegrationKey.create({
      data: {
        carrierId: ROYAL_CARRIERS_FLEET_ID,
        name: (name || 'Royal DAT Key').slice(0, 120),
        keyHash: sha256(rawKey),
        isActive: true,
      },
      select: { id: true, name: true, createdAt: true },
    });

    return res.status(201).json({
      success: true,
      key: rawKey,
      meta: created,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create integration key',
    });
  }
});

router.get('/integrations/dat/keys', requireAuth, async (_req: AuthRequest, res: Response) => {
  const keys = await prisma.dATIntegrationKey.findMany({
    where: { carrierId: ROYAL_CARRIERS_FLEET_ID },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, isActive: true, lastUsedAt: true, createdAt: true },
  });
  return res.json({ success: true, keys });
});

router.patch('/integrations/dat/keys/:id/deactivate', requireAuth, async (req: AuthRequest, res: Response) => {
  const id = req.params.id;
  await prisma.dATIntegrationKey.update({
    where: { id },
    data: { isActive: false },
  });
  return res.json({ success: true });
});

router.post('/integrations/dat/ingest', async (req: Request, res: Response) => {
  try {
    const extensionKey = getExtensionKey(req);
    if (!extensionKey) {
      return res.status(401).json({ error: 'Missing extension key' });
    }

    const carrierId = await resolveCarrierIdFromExtensionKey(extensionKey);
    if (!carrierId) {
      return res.status(401).json({ error: 'Invalid extension key' });
    }

    const metrics = await ingestDATSnapshot(carrierId, req.body);
    return res.json({
      success: true,
      carrierId,
      ...metrics,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Ingest failed',
    });
  }
});

router.post('/dispatch/run', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { driverId } = req.body as { driverId?: string };
    if (!driverId) {
      return res.status(400).json({ error: 'driverId is required' });
    }

    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      select: { id: true, fleetId: true },
    });

    if (!driver) {
      return res.status(404).json({ error: 'Driver not found' });
    }

    if (driver.fleetId !== ROYAL_CARRIERS_FLEET_ID) {
      return res.status(403).json({ error: 'Driver not in authorized carrier scope' });
    }

    const result = await runDispatchForDriver({
      fleetId: driver.fleetId,
      driverId: driver.id,
    });

    return res.json({ success: true, ...result });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Dispatch run failed',
    });
  }
});

router.get('/dispatch/approvals/act', async (req: Request, res: Response) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  const action =
    req.query.action === 'approve'
      ? 'approve'
      : req.query.action === 'reject'
      ? 'reject'
      : '';

  if (!token || !action) {
    return res.status(400).send('<h3>Invalid approval link.</h3>');
  }

  const result = await applyApprovalActionByToken(token, action as 'approve' | 'reject');

  if (result === 'invalid') {
    return res.status(404).send('<h3>Invalid or unknown token.</h3>');
  }
  if (result === 'expired') {
    return res.status(410).send('<h3>Link expired.</h3>');
  }
  if (result === 'already_processed') {
    return res.status(200).send('<h3>Action already processed.</h3>');
  }

  return res.status(200).send(`<h3>Dispatch ${action}d successfully.</h3>`);
});

export default router;
