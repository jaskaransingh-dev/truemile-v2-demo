// src/routes/dat-market-snapshot.routes.ts
// POST /api/integrations/dat/market-snapshot/upload
// Accepts 1-4 DAT iQ MCI screenshots → Vision parse → bulk upsert MarketSnapshot

import { Router, Request, Response } from 'express';
import multer from 'multer';
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../lib/prisma';

const router = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype.startsWith('image/') ||
               /\.(png|jpe?g|webp)$/i.test(file.originalname);
    ok ? cb(null, true) : cb(new Error('Only image files (PNG, JPG, WEBP) are allowed'));
  },
});

const VALID_EQUIPMENT_TYPES = ['DRY_VAN', 'REEFER', 'FLATBED'] as const;

const SYSTEM_PROMPT = `You are extracting freight market MCI values from DAT iQ outbound capacity screenshots.

LEGEND CALIBRATION — do this first:
The first image is the legend strip. It shows 8 color bands left to right:
  Deep navy blue      = -100  (Very Loose)
  Medium blue         = -35   (Loose)
  Light blue/teal     = -30   (Loose)
  Light mint green    = -20   (Neutral)
  Light yellow        = +10   (Neutral)
  Light peach/salmon  = +35   (Tight)
  Medium orange       = +45   (Tight)
  Deep crimson red    = +100  (Very Tight)

MAP EXTRACTION — extract EVERY city label you can read:
The remaining images are map quadrants. For each image, scan every text label visible on the map.

For EVERY city name you can read:
- Find the small dot marker next to that city name
- Look at the color of the filled region touching that dot
- Map it to the closest MCI value using the legend above
- Include it in your output

IMPORTANT RULES:
- Include ALL cities you can read, even partially visible ones at the edges
- Do NOT skip cities because you are uncertain — make your best estimate
- Do NOT limit output to well-known cities — extract every visible label
- If a region is deep blue = -100, medium blue = -35, light blue = -30
- If a region is mixed colors at the dot, pick the dominant color at the dot location
- Plains/midwest states (Kansas, Nebraska, Wyoming, Montana, Dakotas) are typically deep blue = -100 today
- Southeast states (Georgia, Alabama, Carolinas, Tennessee) are typically deep red = +85 to +100 today
- These are hints only — always defer to actual color you see

CAPACITY LABELS:
  +76 to +100  = Very Tight
  +26 to +75   = Tight
  -25 to +25   = Neutral
  -75 to -26   = Loose
  -100 to -76  = Very Loose

OUTPUT — return ONLY this JSON, no markdown, no explanation:
{
  "rows": [
    { "city": "Dallas", "state": "TX", "outbound_mci": 20, "inbound_mci": null, "capacity_label": "Neutral", "lt_ratio": null, "rejection_rate": null }
  ]
}

Extract every city. More rows is better. Aim for 20-40 cities across all quadrant images.`;

router.post('/upload', upload.array('files', 5), async (req: Request, res: Response) => {
  const files = req.files as Express.Multer.File[] | undefined;
  const { equipment_type, valid_date } = req.body;

  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }
  if (!equipment_type) {
    return res.status(400).json({ error: 'equipment_type is required' });
  }
  if (!VALID_EQUIPMENT_TYPES.includes(equipment_type)) {
    return res.status(400).json({ error: `equipment_type must be one of: ${VALID_EQUIPMENT_TYPES.join(', ')}` });
  }
  if (!valid_date) {
    return res.status(400).json({ error: 'valid_date is required (YYYY-MM-DD)' });
  }

  const validDate = new Date(valid_date);
  if (isNaN(validDate.getTime())) {
    return res.status(400).json({ error: 'valid_date must be a valid date (YYYY-MM-DD)' });
  }

  const imageBlocks = files.map(file => ({
    type: 'image' as const,
    source: {
      type: 'base64' as const,
      media_type: file.mimetype as 'image/png' | 'image/jpeg' | 'image/webp',
      data: file.buffer.toString('base64'),
    },
  }));

  let raw = '';
  try {
    const message = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          ...imageBlocks,
          {
            type: 'text',
            text: `Extract all visible city MCI values from these ${files.length} screenshots. Equipment type context: ${equipment_type}. Return only the JSON object with a rows array.`,
          },
        ],
      }],
    });
    raw = message.content
      .filter(b => b.type === 'text')
      .map(b => (b as any).text)
      .join('');
  } catch (err: any) {
    console.error('[dat-market-snapshot] Anthropic Vision error:', err);
    return res.status(502).json({ error: 'Vision API call failed', detail: err.message });
  }

  let parsed: { rows: any[] };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return res.status(422).json({ error: 'Model returned non-JSON response', raw });
  }

  if (!Array.isArray(parsed.rows)) {
    return res.status(422).json({ error: 'Model response missing rows array', raw });
  }

  if (parsed.rows.length === 0) {
    return res.status(422).json({ error: 'Model found no rows in the screenshots', raw });
  }

  // Sequential upserts in batches of 5 to avoid exhausting Supabase connection pool
  const BATCH_SIZE = 5;
  const upsertResults: PromiseSettledResult<any>[] = [];

  for (let i = 0; i < parsed.rows.length; i += BATCH_SIZE) {
    const batch = parsed.rows.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map((row: any) =>
        prisma.marketSnapshot.upsert({
          where: {
            city_state_equipment_type_valid_date: {
              city:           row.city,
              state:          row.state,
              equipment_type: equipment_type,
              valid_date:     validDate,
            },
          },
          create: {
            city:            row.city,
            state:           row.state,
            equipment_type:  equipment_type,
            outbound_mci:    row.outbound_mci   ?? 0,
            inbound_mci:     row.inbound_mci    ?? null,
            capacity_label:  row.capacity_label ?? 'Neutral',
            lt_ratio:        row.lt_ratio       ?? null,
            rejection_rate:  row.rejection_rate ?? null,
            data_source:     'DAT_SCREENSHOT',
            valid_date:      validDate,
          },
          update: {
            outbound_mci:   row.outbound_mci   ?? 0,
            inbound_mci:    row.inbound_mci    ?? null,
            capacity_label: row.capacity_label ?? 'Neutral',
            lt_ratio:       row.lt_ratio       ?? null,
            rejection_rate: row.rejection_rate ?? null,
            data_source:    'DAT_SCREENSHOT',
            updated_at:     new Date(),
          },
        })
      )
    );
    upsertResults.push(...batchResults);
  }

  const succeeded = upsertResults.filter(r => r.status === 'fulfilled').map(r => (r as PromiseFulfilledResult<any>).value);
  const failed    = upsertResults.filter(r => r.status === 'rejected').map(r => (r as PromiseRejectedResult).reason?.message);

  console.log(`[dat-market-snapshot] upserted ${succeeded.length}/${parsed.rows.length} rows for ${equipment_type} ${valid_date}`);
  if (failed.length > 0) {
    console.warn(`[dat-market-snapshot] ${failed.length} upsert failures:`, failed);
  }

  return res.json({
    inserted: succeeded.length,
    failed:   failed.length,
    rows:     succeeded,
    ...(failed.length > 0 ? { errors: failed } : {}),
  });
});

export default router;
