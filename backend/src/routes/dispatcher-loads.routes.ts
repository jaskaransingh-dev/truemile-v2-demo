/**
 * Dispatcher-scoped load + cycle + document endpoints.
 * All protected by requireSupabaseAuth.
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import OpenAI from 'openai';
import { requireSupabaseAuth } from '../middleware/supabase-auth.middleware';

const execAsync = promisify(exec);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const router = Router();

const DOC_DIR = path.join('/tmp', 'dispatch-docs');
if (!fs.existsSync(DOC_DIR)) fs.mkdirSync(DOC_DIR, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

// ---------------------------------------------------------------------------
// GET /api/drivers/:id/loads — all loads for a driver (most recent first)
// ---------------------------------------------------------------------------
router.get('/drivers/:id/loads', requireSupabaseAuth, async (req: Request, res: Response) => {
  try {
    const where: any = { driverId: req.params.id };

    // Optional month filter: ?month=2026-04
    const month = req.query.month as string | undefined;
    if (month) {
      const [y, m] = month.split('-').map(Number);
      const from = new Date(y, m - 1, 1);
      const to = new Date(y, m, 1);
      where.OR = [
        { pickupTime: { gte: from, lt: to } },
        { pickupTime: null, createdAt: { gte: from, lt: to } },
      ];
    }

    const loads = await prisma.dispatchLoad.findMany({
      where,
      orderBy: [{ pickupTime: 'desc' }, { createdAt: 'desc' }],
    });
    return res.json({ loads });
  } catch (err: any) {
    console.error('[dispatcher-loads] GET loads error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch loads' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/drivers/:id/cycle — create or update the ACTIVE cycle
// Body: { startDate, endDate }
// ---------------------------------------------------------------------------
router.put('/drivers/:id/cycle', requireSupabaseAuth, async (req: Request, res: Response) => {
  const { startDate, endDate } = req.body;
  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'startDate and endDate required' });
  }

  try {
    const active = await prisma.driverCycle.findFirst({
      where: { driverId: req.params.id, status: 'ACTIVE' },
      orderBy: { startDate: 'desc' },
    });

    let cycle;
    if (active) {
      cycle = await prisma.driverCycle.update({
        where: { id: active.id },
        data: {
          startDate: new Date(startDate),
          endDate: new Date(endDate),
        },
      });
    } else {
      cycle = await prisma.driverCycle.create({
        data: {
          driverId: req.params.id,
          startDate: new Date(startDate),
          endDate: new Date(endDate),
          status: 'ACTIVE',
        },
      });
    }
    return res.json({ cycle });
  } catch (err: any) {
    console.error('[dispatcher-loads] PUT cycle error:', err.message);
    return res.status(500).json({ error: 'Failed to save cycle' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/drivers/:id/cycle/start-new
// Archives any active cycle, creates a new ACTIVE one starting today (default 17 days)
// ---------------------------------------------------------------------------
router.post('/drivers/:id/cycle/start-new', requireSupabaseAuth, async (req: Request, res: Response) => {
  const daysOut = req.body.daysOut ?? 17;
  const startDate = new Date();
  const endDate = new Date(startDate.getTime() + daysOut * 86_400_000);

  try {
    await prisma.driverCycle.updateMany({
      where: { driverId: req.params.id, status: 'ACTIVE' },
      data: { status: 'COMPLETED' },
    });
    const cycle = await prisma.driverCycle.create({
      data: {
        driverId: req.params.id,
        startDate,
        endDate,
        status: 'ACTIVE',
      },
    });
    return res.json({ cycle });
  } catch (err: any) {
    console.error('[dispatcher-loads] start-new error:', err.message);
    return res.status(500).json({ error: 'Failed to start new cycle' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/drivers/:id/cycles — full cycle history (for collapsible view)
// ---------------------------------------------------------------------------
router.get('/drivers/:id/cycles', requireSupabaseAuth, async (req: Request, res: Response) => {
  try {
    const cycles = await prisma.driverCycle.findMany({
      where: { driverId: req.params.id },
      orderBy: { startDate: 'desc' },
    });
    return res.json({ cycles });
  } catch (err: any) {
    console.error('[dispatcher-loads] GET cycles error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch cycles' });
  }
});

// DELETE /api/drivers/:id/cycles/:cycleId
router.delete('/drivers/:id/cycles/:cycleId', requireSupabaseAuth, async (req: Request, res: Response) => {
  try {
    await prisma.driverCycle.delete({ where: { id: req.params.cycleId } });
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[dispatcher-loads] DELETE cycle error:', err.message);
    return res.status(500).json({ error: 'Failed to delete cycle' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/loads/:id — single load detail
// ---------------------------------------------------------------------------
router.get('/loads/:id', requireSupabaseAuth, async (req: Request, res: Response) => {
  try {
    const load = await prisma.dispatchLoad.findUnique({ where: { id: req.params.id } });
    if (!load) return res.status(404).json({ error: 'Load not found' });
    return res.json({ load });
  } catch (err: any) {
    console.error('[dispatcher-loads] GET load error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch load' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/loads/:id — update load fields (for post-parse edits + status)
// ---------------------------------------------------------------------------
router.put('/loads/:id', requireSupabaseAuth, async (req: Request, res: Response) => {
  try {
    const allowedFields: Array<keyof typeof req.body> = [
      'loadNumber', 'status', 'stopCount', 'stops',
      'pickupCity', 'pickupState', 'pickupLat', 'pickupLon', 'pickupTime',
      'dropoffCity', 'dropoffState', 'dropoffLat', 'dropoffLon', 'deliveryTime',
      'rate', 'loadedMiles', 'loadedMilesSource', 'deadheadMiles', 'deadheadMilesSource',
      'brokerName', 'brokerAgentName', 'brokerEmail', 'brokerPhone', 'brokerMC',
    ];
    const data: any = {};
    for (const f of allowedFields) {
      if (f in req.body) {
        if (f === 'pickupTime' || f === 'deliveryTime') {
          data[f] = req.body[f] ? new Date(req.body[f] as string) : null;
        } else {
          data[f] = req.body[f];
        }
      }
    }
    const load = await prisma.dispatchLoad.update({
      where: { id: req.params.id },
      data,
    });
    return res.json({ load });
  } catch (err: any) {
    console.error('[dispatcher-loads] PUT load error:', err.message);
    return res.status(500).json({ error: 'Failed to update load' });
  }
});

// DELETE /api/loads/:id
router.delete('/loads/:id', requireSupabaseAuth, async (req: Request, res: Response) => {
  try {
    await prisma.dispatchLoad.delete({ where: { id: req.params.id } });
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[dispatcher-loads] DELETE load error:', err.message);
    return res.status(500).json({ error: 'Failed to delete load' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/loads/:id/documents — document metadata for a load
// ---------------------------------------------------------------------------
router.get('/loads/:id/documents', requireSupabaseAuth, async (req: Request, res: Response) => {
  try {
    const load = await prisma.dispatchLoad.findUnique({
      where: { id: req.params.id },
      select: {
        rateConPath: true, rateConUploadedAt: true,
        bolPath: true, bolUploadedAt: true,
        podPath: true, podUploadedAt: true,
      },
    });
    if (!load) return res.status(404).json({ error: 'Load not found' });
    return res.json({
      rateCon: load.rateConPath ? { path: load.rateConPath, uploadedAt: load.rateConUploadedAt } : null,
      bol:     load.bolPath     ? { path: load.bolPath,     uploadedAt: load.bolUploadedAt     } : null,
      pod:     load.podPath     ? { path: load.podPath,     uploadedAt: load.podUploadedAt     } : null,
    });
  } catch (err: any) {
    console.error('[dispatcher-loads] GET documents error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch documents' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/loads/:id/documents/ratecon — dispatcher uploads rate con
// Accepts multipart file. Saves to /tmp/dispatch-docs/, updates DispatchLoad.
// ---------------------------------------------------------------------------
router.post(
  '/loads/:id/documents/ratecon',
  requireSupabaseAuth,
  upload.single('file'),
  async (req: Request, res: Response) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    try {
      const filename = `RATECON-${req.params.id}-${Date.now()}-${req.file.originalname || 'ratecon'}`;
      const filepath = path.join(DOC_DIR, filename);
      fs.writeFileSync(filepath, req.file.buffer);

      const load = await prisma.dispatchLoad.update({
        where: { id: req.params.id },
        data: { rateConPath: filepath, rateConUploadedAt: new Date() },
      });
      console.log(`[dispatcher-loads] ratecon uploaded for load ${req.params.id} (${req.file.size} bytes)`);
      return res.json({ success: true, load });
    } catch (err: any) {
      console.error('[dispatcher-loads] ratecon upload error:', err.message);
      return res.status(500).json({ error: 'Failed to save rate con' });
    }
  },
);

// GET /api/loads/:id/documents/ratecon/file — serve the actual file
router.get('/loads/:id/documents/ratecon/file', requireSupabaseAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const load = await prisma.dispatchLoad.findUnique({
      where: { id: req.params.id },
      select: { rateConPath: true },
    });
    if (!load?.rateConPath) { res.status(404).json({ error: 'No rate con file' }); return; }
    if (!fs.existsSync(load.rateConPath)) { res.status(404).json({ error: 'File not found on disk' }); return; }

    const ext = path.extname(load.rateConPath).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    };
    res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="ratecon${ext}"`);
    fs.createReadStream(load.rateConPath).pipe(res);
  } catch (err: any) {
    console.error('[dispatcher-loads] serve ratecon error:', err.message);
    res.status(500).json({ error: 'Failed to serve file' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/loads/:id/miles/calculate
// Uses Google Distance Matrix API to fill missing loaded / deadhead miles.
// loadedMiles  = pickup → dropoff
// deadheadMiles = previous load's dropoff → this load's pickup
// ---------------------------------------------------------------------------
router.post('/loads/:id/miles/calculate', requireSupabaseAuth, async (req: Request, res: Response) => {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return res.status(500).json({ error: 'GOOGLE_MAPS_API_KEY not configured' });

  try {
    const load = await prisma.dispatchLoad.findUnique({ where: { id: req.params.id } });
    if (!load) return res.status(404).json({ error: 'Load not found' });

    const updates: any = {};

    // loadedMiles — only calculate if not already set from rate con
    if (load.loadedMiles == null || load.loadedMilesSource !== 'RATECON') {
      if (load.pickupCity && load.pickupState && load.dropoffCity && load.dropoffState) {
        const origin = `${load.pickupCity}, ${load.pickupState}`;
        const dest = `${load.dropoffCity}, ${load.dropoffState}`;
        const miles = await distanceMiles(origin, dest, key);
        if (miles != null) {
          updates.loadedMiles = miles;
          updates.loadedMilesSource = 'CALCULATED';
        }
      }
    }

    // deadheadMiles — find previous load for same driver with pickupTime before this one
    if (load.pickupCity && load.pickupState) {
      const prev = await prisma.dispatchLoad.findFirst({
        where: {
          driverId: load.driverId,
          id: { not: load.id },
          pickupTime: load.pickupTime ? { lte: load.pickupTime } : undefined,
        },
        orderBy: [{ pickupTime: 'desc' }, { createdAt: 'desc' }],
      });
      if (prev?.dropoffCity && prev.dropoffState) {
        const origin = `${prev.dropoffCity}, ${prev.dropoffState}`;
        const dest = `${load.pickupCity}, ${load.pickupState}`;
        const miles = await distanceMiles(origin, dest, key);
        if (miles != null) {
          updates.deadheadMiles = miles;
          updates.deadheadMilesSource = 'CALCULATED';
        }
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.json({ load, updates: null, note: 'No fields to calculate (missing pickup/dropoff)' });
    }

    const updated = await prisma.dispatchLoad.update({
      where: { id: req.params.id },
      data: updates,
    });
    return res.json({ load: updated, updates });
  } catch (err: any) {
    console.error('[dispatcher-loads] miles calculate error:', err.message);
    return res.status(500).json({ error: 'Failed to calculate miles' });
  }
});

async function distanceMiles(origin: string, dest: string, key: string): Promise<number | null> {
  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(origin)}&destinations=${encodeURIComponent(dest)}&units=imperial&key=${key}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data: any = await res.json();
  const meters = data?.rows?.[0]?.elements?.[0]?.distance?.value;
  if (typeof meters !== 'number') return null;
  return Math.round((meters / 1609.344) * 10) / 10;
}

// ---------------------------------------------------------------------------
// POST /api/loads — create a new load linked to a driver (after rate con parse)
// ---------------------------------------------------------------------------
router.post('/loads', requireSupabaseAuth, async (req: Request, res: Response) => {
  const { driverId } = req.body;
  if (!driverId) return res.status(400).json({ error: 'driverId required' });

  try {
    const load = await prisma.dispatchLoad.create({
      data: {
        driverId,
        loadNumber:   req.body.loadNumber   || null,
        pickupCity:   req.body.pickupCity   || null,
        pickupState:  req.body.pickupState  || null,
        pickupLat:    req.body.pickupLat    ?? null,
        pickupLon:    req.body.pickupLon    ?? null,
        pickupTime:   req.body.pickupTime   ? new Date(req.body.pickupTime) : null,
        dropoffCity:  req.body.dropoffCity  || null,
        dropoffState: req.body.dropoffState || null,
        dropoffLat:   req.body.dropoffLat   ?? null,
        dropoffLon:   req.body.dropoffLon   ?? null,
        deliveryTime: req.body.deliveryTime ? new Date(req.body.deliveryTime) : null,
        rate:         req.body.rate         ?? null,
        loadedMiles:  req.body.loadedMiles  ?? null,
        loadedMilesSource: req.body.loadedMilesSource || (req.body.loadedMiles ? 'RATECON' : null),
        deadheadMiles: req.body.deadheadMiles ?? null,
        deadheadMilesSource: req.body.deadheadMilesSource || null,
        stopCount:    req.body.stopCount    ?? null,
        stops:        req.body.stops        ?? null,
        brokerName:   req.body.brokerName   || null,
        brokerAgentName: req.body.brokerAgentName || null,
        brokerEmail:  req.body.brokerEmail  || null,
        brokerPhone:  req.body.brokerPhone  || null,
        brokerMC:     req.body.brokerMC     || null,
      },
    });
    return res.json({ load });
  } catch (err: any) {
    console.error('[dispatcher-loads] POST load error:', err.message);
    return res.status(500).json({ error: 'Failed to create load' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/loads — all loads across drivers (for LoadsScreen)
// ---------------------------------------------------------------------------
router.get('/loads', requireSupabaseAuth, async (req: Request, res: Response) => {
  const driverId = req.query.driverId as string | undefined;
  try {
    const loads = await prisma.dispatchLoad.findMany({
      where: driverId ? { driverId } : undefined,
      orderBy: [{ pickupTime: 'desc' }, { createdAt: 'desc' }],
      include: { driver: { select: { id: true, name: true } } },
      take: 200,
    });
    return res.json({ loads });
  } catch (err: any) {
    console.error('[dispatcher-loads] GET /loads error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch loads' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/loads/parse-ratecon
// Parses a rate con PDF/image with GPT-4o Vision and returns structured fields.
// Mobile's rate con upload flow calls this → gets fields → user confirms → POST /api/loads
// ---------------------------------------------------------------------------
router.post(
  '/loads/parse-ratecon',
  requireSupabaseAuth,
  upload.single('file'),
  async (req: Request, res: Response) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    try {
      const parsed = await parseRateConFast(req.file.buffer, req.file.mimetype);
      return res.json(parsed);
    } catch (err: any) {
      console.error('[dispatcher-loads] parse-ratecon error:', err.message);
      return res.status(500).json({ error: 'Failed to parse rate con' });
    }
  },
);

// ---------------------------------------------------------------------------
// Rate con parser — 2-pass speed optimized
// Pass 1: page 1 only → GPT-4o Vision (OCR) → GPT-4o-mini (extract)
// Pass 2: only if critical fields missing → pages 2-3 → re-extract
// Never reads pages beyond 3
// ---------------------------------------------------------------------------

async function parseRateConFast(buffer: Buffer, mimetype?: string): Promise<any> {
  const t0 = Date.now();
  const isPdf = mimetype === 'application/pdf' || buffer.slice(0, 4).toString() === '%PDF';
  const tempDir = os.tmpdir();
  const srcPath = path.join(tempDir, `rc-${Date.now()}.${isPdf ? 'pdf' : 'jpg'}`);
  fs.writeFileSync(srcPath, buffer);

  let prefix = '';
  const cleanup: string[] = [srcPath];

  try {
    if (isPdf) {
      prefix = path.join(tempDir, `rc-page-${Date.now()}`);
    }

    // --- Pass 1: page 1 only ---
    let page1Text = '';
    if (isPdf) {
      await execAsync(`pdftoppm -png -f 1 -l 1 "${srcPath}" "${prefix}"`);
      console.log(`[parse-ratecon] pdftoppm page 1: ${Date.now() - t0}ms`);
      const page1Path = findPngPages(tempDir, prefix)[0];
      if (page1Path) {
        cleanup.push(page1Path);
        page1Text = await ocrPage(page1Path);
      }
    } else {
      page1Text = await ocrPage(srcPath);
    }
    console.log(`[parse-ratecon] page 1 OCR done: ${Date.now() - t0}ms (${page1Text.length} chars)`);

    if (page1Text.trim().length < 20) {
      throw new Error('No text extracted from page 1');
    }

    const pass1 = await parseRateConWithAI(page1Text);
    console.log(`[parse-ratecon] pass 1 extract done: ${Date.now() - t0}ms`);

    // --- Check critical fields ---
    const missing = [];
    if (!pass1.rate) missing.push('rate');
    if (!pass1.pickupCity) missing.push('pickupCity');
    if (!pass1.dropoffCity) missing.push('dropoffCity');
    if (!pass1.pickupTime) missing.push('pickupTime');
    if (!pass1.deliveryTime) missing.push('deliveryTime');

    if (missing.length === 0) {
      console.log(`[parse-ratecon] FAST PATH complete: ${Date.now() - t0}ms total`);
      return pass1;
    }

    // --- Pass 2: pages 2-3 ---
    if (!isPdf) {
      console.log(`[parse-ratecon] pass 1 missing [${missing.join(',')}] — image file, no more pages. Total: ${Date.now() - t0}ms`);
      return pass1;
    }

    console.log(`[parse-ratecon] pass 1 missing [${missing.join(',')}] — reading pages 2-3`);
    await execAsync(`pdftoppm -png -f 2 -l 3 "${srcPath}" "${prefix}-extra"`);
    console.log(`[parse-ratecon] pdftoppm pages 2-3: ${Date.now() - t0}ms`);
    const extraPages = findPngPages(tempDir, `${path.basename(prefix)}-extra`);
    cleanup.push(...extraPages);

    let extraText = '';
    for (const p of extraPages) {
      extraText += '\n\n' + await ocrPage(p);
    }
    console.log(`[parse-ratecon] pages 2-3 OCR done: ${Date.now() - t0}ms (${extraText.length} chars)`);

    if (extraText.trim().length < 20) {
      console.log(`[parse-ratecon] no useful text from pages 2-3. Total: ${Date.now() - t0}ms`);
      return pass1;
    }

    const pass2 = await parseRateConWithAI(page1Text + extraText);
    console.log(`[parse-ratecon] FALLBACK PATH complete: ${Date.now() - t0}ms total`);
    return pass2;
  } finally {
    for (const f of cleanup) {
      try { fs.unlinkSync(f); } catch { /* noop */ }
    }
  }
}

/** OCR a single page image with GPT-4o Vision. Resizes to max 1500px first. Returns raw text. */
async function ocrPage(pngPath: string): Promise<string> {
  // Resize to max 1500px width to reduce payload and speed up Vision
  const sharp = (await import('sharp')).default;
  const resized = await sharp(pngPath).resize({ width: 1500, withoutEnlargement: true }).png().toBuffer();
  const b64 = resized.toString('base64');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'Extract ALL text from this rate confirmation page verbatim. Preserve layout.' },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
      ],
    }],
    max_tokens: 800,
  });
  return response.choices[0].message.content || '';
}

/** Find all PNG files matching a pdftoppm prefix in a directory. */
function findPngPages(dir: string, prefix: string): string[] {
  return fs.readdirSync(dir)
    .filter(f => f.startsWith(path.basename(prefix)) && f.endsWith('.png'))
    .sort()
    .map(f => path.join(dir, f));
}

async function parseRateConWithAI(text: string) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{
      role: 'user',
      content: `Extract rate confirmation data from this text. This may be a multi-stop load.

Return ONLY valid JSON matching this shape, with null for missing fields:

{
  "loadNumber": string | null,
  "pickupCity": string | null,
  "pickupState": string | null,
  "dropoffCity": string | null,
  "dropoffState": string | null,
  "pickupTime": ISO string | null,
  "deliveryTime": ISO string | null,
  "rate": number | null,
  "loadedMiles": number | null,
  "stopCount": number | null,
  "stops": [
    { "type": "PICKUP" | "DROP", "city": string, "state": string, "address": string | null, "appointment": ISO string | null, "sequence": number }
  ] | null,
  "brokerName": string | null,
  "brokerAgentName": string | null,
  "brokerEmail": string | null,
  "brokerPhone": string | null,
  "brokerMC": string | null
}

Rules:
- rate is total payout in dollars (not per-mile)
- loadedMiles is an integer/float (total for the entire route)
- States are 2-letter codes
- Times must be naive local datetime WITHOUT timezone suffix: "YYYY-MM-DDTHH:MM:SS" (no Z, no offset). Use the time exactly as written on the document — do NOT convert to UTC.
- pickupCity/State = first PICKUP, dropoffCity/State = last DROP
- stops: include ALL locations listed on the rate con in sequence order
  - The first location is usually type "PICKUP", remaining are "DROP"
  - Sequence starts at 1
  - "appointment" is the scheduled time for that stop if available
- stopCount = total number of entries in the stops array
- brokerName = the broker/freight company name (e.g. "FREIGHT TEC", "RICK'S LOGISTICS")
- brokerAgentName = the individual agent/rep at the BROKER company, NOT the carrier contact. The CARRIER section lists the carrier's rep — ignore that for broker fields. If no individual broker agent name is found, set brokerAgentName to null.
- brokerEmail = the broker's email (NOT the carrier's email)
- brokerPhone = the broker's phone (NOT the carrier's phone)

Rate con text:
${text.substring(0, 8000)}`,
    }],
    temperature: 0,
    max_tokens: 1500,
  });

  const content = response.choices[0].message.content || '{}';
  const jsonText = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try {
    return JSON.parse(jsonText);
  } catch {
    return {};
  }
}

export default router;
