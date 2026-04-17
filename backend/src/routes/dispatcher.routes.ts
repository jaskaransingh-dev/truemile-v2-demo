import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireSupabaseAuth } from '../middleware/supabase-auth.middleware';

const router = Router();
const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// GET /api/dispatcher/drivers
// All drivers + operational state + active cycle + latest load's dropoff info
// Drivers without a DriverOperationalState row → null location fields
// ---------------------------------------------------------------------------

router.get('/drivers', requireSupabaseAuth, async (_req: Request, res: Response) => {
  try {
    const drivers = await prisma.driver.findMany({
      include: {
        operationalState: true,
        cycles: { where: { status: 'ACTIVE' }, orderBy: { startDate: 'desc' }, take: 1 },
        dispatchLoads: { orderBy: [{ pickupTime: 'desc' }, { createdAt: 'desc' }], take: 1 },
      },
      orderBy: { name: 'asc' },
    });

    const now = Date.now();
    const DAY = 86_400_000;

    const out = drivers.map((d) => {
      const op = d.operationalState;
      const cycle = d.cycles[0];
      const latestLoad = d.dispatchLoads[0];

      // Days remaining in current cycle (null if no cycle)
      let daysRemaining: number | null = null;
      if (cycle) {
        const endMs = cycle.endDate.getTime();
        const remMs = endMs - now;
        daysRemaining = Math.max(0, Math.ceil(remMs / DAY));
      }

      return {
        id: d.id,
        name: d.name,
        driverId: null,
        phoneNumber: d.phoneNumber || null,
        truckNumber: d.truckNumber || null,
        trailerNumber: d.trailerNumber || null,
        homeBase: d.homeBase || null,
        trailerType: d.trailerType || null,
        targetRPM: d.targetRPM,
        status: op?.status || null,
        currentLocation: op?.currentLocation || null,
        currentLat: op?.currentLat ?? null,
        currentLon: op?.currentLon ?? null,
        // Empty location/time derived from the driver's most recent load delivery
        emptyLocation: latestLoad && latestLoad.dropoffCity && latestLoad.dropoffState
          ? `${latestLoad.dropoffCity}, ${latestLoad.dropoffState}`
          : null,
        emptyTime: latestLoad?.deliveryTime ? latestLoad.deliveryTime.toISOString() : null,
        cycle: cycle ? {
          id: cycle.id,
          startDate: cycle.startDate.toISOString(),
          endDate: cycle.endDate.toISOString(),
          totalDays: Math.ceil((cycle.endDate.getTime() - cycle.startDate.getTime()) / DAY),
          daysRemaining,
        } : null,
      };
    });

    console.log(`[dispatcher] GET /drivers returned ${out.length} drivers`);
    return res.json({ drivers: out });
  } catch (err: any) {
    console.error('[dispatcher] drivers fetch error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch drivers' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/dispatcher/drivers/:id — single driver detail (for detail screen)
// ---------------------------------------------------------------------------
router.get('/drivers/:id', requireSupabaseAuth, async (req: Request, res: Response) => {
  try {
    const driver = await prisma.driver.findUnique({
      where: { id: req.params.id },
      include: {
        operationalState: true,
        cycles: { where: { status: 'ACTIVE' }, orderBy: { startDate: 'desc' }, take: 1 },
      },
    });
    if (!driver) return res.status(404).json({ error: 'Driver not found' });

    const op = driver.operationalState;
    const cycle = driver.cycles[0];

    return res.json({
      driver: {
        id: driver.id,
        name: driver.name,
        phoneNumber: driver.phoneNumber || null,
        truckNumber: driver.truckNumber || null,
        homeBase: driver.homeBase || null,
        trailerType: driver.trailerType || null,
        targetRPM: driver.targetRPM,
        status: op?.status || null,
        currentLocation: op?.currentLocation || null,
        currentLat: op?.currentLat ?? null,
        currentLon: op?.currentLon ?? null,
        cycle: cycle ? {
          id: cycle.id,
          startDate: cycle.startDate.toISOString(),
          endDate: cycle.endDate.toISOString(),
        } : null,
      },
    });
  } catch (err: any) {
    console.error('[dispatcher] driver detail error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch driver' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/dispatcher/drivers/:id — update driver identity fields
// ---------------------------------------------------------------------------
router.put('/drivers/:id', requireSupabaseAuth, async (req: Request, res: Response) => {
  const { name, truckNumber, trailerNumber, homeBase, targetRPM, trailerType } = req.body;
  try {
    const data: any = {};
    if (name !== undefined)          data.name = name;
    if (truckNumber !== undefined)   data.truckNumber = truckNumber || null;
    if (trailerNumber !== undefined) data.trailerNumber = trailerNumber || null;
    if (homeBase !== undefined)      data.homeBase = homeBase || null;
    if (targetRPM !== undefined)     data.targetRPM = parseFloat(targetRPM) || 1.86;
    if (trailerType !== undefined)   data.trailerType = trailerType || null;

    const driver = await prisma.driver.update({
      where: { id: req.params.id },
      data,
    });
    return res.json({ driver });
  } catch (err: any) {
    console.error('[dispatcher] PUT driver error:', err.message);
    return res.status(500).json({ error: 'Failed to update driver' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/dispatcher/drivers — create a new driver
// ---------------------------------------------------------------------------
const ROYAL_CARRIER_ID = '9b7c4f1e-69e8-4d58-b7a4-887a70f48b72';
const ROYAL_FLEET_ID = 'cmhdsm44q001d8ze7ixwu9igs';

router.post('/drivers', requireSupabaseAuth, async (req: Request, res: Response) => {
  const { name, phoneNumber, truckNumber, trailerNumber, trailerType, homeBase, targetRPM } = req.body;

  if (!name || !phoneNumber) {
    return res.status(400).json({ error: 'name and phoneNumber are required' });
  }

  try {
    const driver = await prisma.driver.create({
      data: {
        fleetId: ROYAL_FLEET_ID,
        carrierId: ROYAL_CARRIER_ID,
        name,
        phoneNumber,
        truckNumber: truckNumber || null,
        trailerNumber: trailerNumber || null,
        trailerType: trailerType || null,
        homeBase: homeBase || null,
        targetRPM: parseFloat(targetRPM) || 1.86,
        payStructure: 'percentage',
        payRate: 0.30,
      },
    });

    // Attempt SMS via Twilio if configured
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER) {
      try {
        const twilio = require('twilio');
        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        await client.messages.create({
          body: `Welcome to TrueMile! Download the app to get started: https://testflight.apple.com/join/TrueMile`,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: phoneNumber.startsWith('+') ? phoneNumber : `+1${phoneNumber.replace(/\D/g, '')}`,
        });
        console.log(`[dispatcher] SMS sent to ${phoneNumber}`);
      } catch (smsErr: any) {
        // Don't block driver creation if SMS fails
        console.warn(`[dispatcher] SMS send failed (Twilio may not be verified): ${smsErr.message}`);
      }
    } else {
      console.log('[dispatcher] Twilio not configured — skipping SMS');
    }

    return res.json({ driver });
  } catch (err: any) {
    console.error('[dispatcher] POST driver error:', err.message);
    return res.status(500).json({ error: 'Failed to create driver' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/dispatcher/drivers/:id/cycle-end — quick update cycle endDate
// ---------------------------------------------------------------------------
router.patch('/drivers/:id/cycle-end', requireSupabaseAuth, async (req: Request, res: Response) => {
  const { endDate } = req.body;
  if (!endDate) return res.status(400).json({ error: 'endDate required' });

  try {
    // Find the active cycle
    const activeCycle = await prisma.driverCycle.findFirst({
      where: { driverId: req.params.id, status: 'ACTIVE' },
      orderBy: { startDate: 'desc' },
    });
    if (!activeCycle) return res.status(404).json({ error: 'No active cycle found' });

    const updated = await prisma.driverCycle.update({
      where: { id: activeCycle.id },
      data: { endDate: new Date(endDate) },
    });

    return res.json({
      cycle: {
        id: updated.id,
        startDate: updated.startDate.toISOString(),
        endDate: updated.endDate.toISOString(),
      },
    });
  } catch (err: any) {
    console.error('[dispatcher] PATCH cycle-end error:', err.message);
    return res.status(500).json({ error: 'Failed to update cycle end date' });
  }
});

export default router;
