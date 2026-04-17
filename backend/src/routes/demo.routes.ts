import { Router, Request, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';

const router = Router();
const RATECON_PATH = path.join('/tmp', 'latest-ratecon.pdf');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname);
    ok ? cb(null, true) : cb(new Error('Only PDF files are accepted'));
  },
});

// POST /api/demo/ratecon — receive rate con PDF from Gmail extension
router.post('/ratecon', upload.single('file'), (req: Request, res: Response) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ success: false, error: 'No PDF file uploaded' });
  }

  try {
    fs.writeFileSync(RATECON_PATH, file.buffer);
    console.log(`[demo] rate con saved: ${file.originalname} (${file.size} bytes)`);
    return res.json({ success: true, size: file.size, timestamp: Date.now() });
  } catch (err: any) {
    console.error('[demo] failed to save rate con:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to save file' });
  }
});

// GET /api/demo/ratecon/latest — poll endpoint for demo UI
router.get('/ratecon/latest', (_req: Request, res: Response) => {
  try {
    if (!fs.existsSync(RATECON_PATH)) {
      return res.json({ available: false });
    }
    const stat = fs.statSync(RATECON_PATH);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs > 60_000) {
      return res.json({ available: false });
    }
    return res.json({ available: true, timestamp: Math.round(stat.mtimeMs) });
  } catch {
    return res.json({ available: false });
  }
});

export default router;
