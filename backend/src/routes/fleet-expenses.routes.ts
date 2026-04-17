import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { requireSupabaseAuth } from '../middleware/supabase-auth.middleware';
import multer from 'multer';
import { categorizeExpense } from '../services/categorization-rules';
import { parse as csvParse } from 'csv-parse/sync';
import XLSX from 'xlsx';

const router = Router();

// Multer for expense file uploads (CSV, XLSX, PDF, images)
const upload = multer({ dest: '/tmp/expense-uploads/', limits: { fileSize: 20 * 1024 * 1024 } });

// ---------------------------------------------------------------------------
// Helper: get or create carrier ID from the authenticated user's first driver
// For now, we use a fixed carrier ID until multi-tenant auth is wired
// ---------------------------------------------------------------------------
const ROYAL_CARRIER_ID = '9b7c4f1e-69e8-4d58-b7a4-887a70f48b72';

async function getCarrierId(_req: Request): Promise<string> {
  // TODO: extract from JWT when multi-tenant auth is wired
  return ROYAL_CARRIER_ID;
}

// =====================================================================
// EXPENSE CATEGORIES
// =====================================================================

// GET /api/fleet/expense-categories
router.get('/expense-categories', requireSupabaseAuth, async (req: Request, res: Response) => {
  try {
    const carrierId = await getCarrierId(req);
    const categories = await prisma.expenseCategory.findMany({
      where: { carrierId },
      orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }],
    });
    return res.json({ categories });
  } catch (err: any) {
    console.error('[fleet] expense categories fetch error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch expense categories' });
  }
});

// POST /api/fleet/expense-categories
router.post('/expense-categories', requireSupabaseAuth, async (req: Request, res: Response) => {
  try {
    const carrierId = await getCarrierId(req);
    const { name, type, scope, defaultAmount, sortOrder } = req.body;
    const category = await prisma.expenseCategory.create({
      data: {
        carrierId,
        name,
        type,
        scope: scope || 'PER_DRIVER',
        defaultAmount: defaultAmount ? parseFloat(defaultAmount) : null,
        sortOrder: sortOrder ?? 0,
      },
    });
    return res.json({ category });
  } catch (err: any) {
    console.error('[fleet] create expense category error:', err.message);
    return res.status(500).json({ error: 'Failed to create expense category' });
  }
});

// PUT /api/fleet/expense-categories/:id
router.put('/expense-categories/:id', requireSupabaseAuth, async (req: Request, res: Response) => {
  try {
    const { name, type, scope, defaultAmount, active, sortOrder } = req.body;
    const data: any = {};
    if (name !== undefined) data.name = name;
    if (type !== undefined) data.type = type;
    if (scope !== undefined) data.scope = scope;
    if (defaultAmount !== undefined) data.defaultAmount = defaultAmount !== null ? parseFloat(defaultAmount) : null;
    if (active !== undefined) data.active = active;
    if (sortOrder !== undefined) data.sortOrder = sortOrder;

    const category = await prisma.expenseCategory.update({
      where: { id: req.params.id },
      data,
    });
    return res.json({ category });
  } catch (err: any) {
    console.error('[fleet] update expense category error:', err.message);
    return res.status(500).json({ error: 'Failed to update expense category' });
  }
});

// DELETE /api/fleet/expense-categories/:id
router.delete('/expense-categories/:id', requireSupabaseAuth, async (req: Request, res: Response) => {
  try {
    await prisma.expenseCategory.delete({ where: { id: req.params.id } });
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[fleet] delete expense category error:', err.message);
    return res.status(500).json({ error: 'Failed to delete expense category' });
  }
});

// POST /api/fleet/expense-categories/seed — create default categories
router.post('/expense-categories/seed', requireSupabaseAuth, async (req: Request, res: Response) => {
  try {
    const carrierId = await getCarrierId(req);

    // Check if already seeded
    const existing = await prisma.expenseCategory.count({ where: { carrierId } });
    if (existing > 0) {
      return res.json({ message: 'Categories already seeded', count: existing });
    }

    const defaults = [
      // FIXED (sortOrder 1-14)
      { name: 'Insurance', type: 'FIXED', scope: 'PER_DRIVER', sortOrder: 1 },
      { name: 'Truck Payment', type: 'FIXED', scope: 'PER_DRIVER', sortOrder: 2 },
      { name: 'Trailer Payment', type: 'FIXED', scope: 'PER_DRIVER', sortOrder: 3 },
      { name: 'CPA', type: 'FIXED', scope: 'FLEET', sortOrder: 4 },
      { name: 'Logbook', type: 'FIXED', scope: 'PER_DRIVER', sortOrder: 5 },
      { name: 'Pre-Pass', type: 'FIXED', scope: 'PER_DRIVER', sortOrder: 6 },
      { name: 'Load Board', type: 'FIXED', scope: 'FLEET', sortOrder: 7 },
      { name: 'DAT', type: 'FIXED', scope: 'FLEET', sortOrder: 8 },
      { name: 'IFTA', type: 'FIXED', scope: 'PER_DRIVER', sortOrder: 9 },
      { name: 'Compliance', type: 'FIXED', scope: 'FLEET', sortOrder: 10 },
      { name: 'Payroll Tax', type: 'FIXED', scope: 'FLEET', sortOrder: 11 },
      { name: 'Business Tax', type: 'FIXED', scope: 'FLEET', sortOrder: 12 },
      { name: 'Interest Payment', type: 'FIXED', scope: 'FLEET', sortOrder: 13 },
      { name: 'SBA Payment', type: 'FIXED', scope: 'FLEET', sortOrder: 14 },
      // VARIABLE (sortOrder 15-19)
      { name: 'Repair', type: 'VARIABLE', scope: 'PER_DRIVER', sortOrder: 15 },
      { name: 'Maintenance', type: 'VARIABLE', scope: 'PER_DRIVER', sortOrder: 16 },
      { name: 'CC', type: 'VARIABLE', scope: 'PER_DRIVER', sortOrder: 17 },
      { name: 'Fuel', type: 'VARIABLE', scope: 'PER_DRIVER', sortOrder: 18 },
      { name: 'Misc', type: 'VARIABLE', scope: 'PER_DRIVER', sortOrder: 19 },
      // DRIVER_PAY (sortOrder 20-23)
      { name: 'Driving Fee', type: 'DRIVER_PAY', scope: 'PER_DRIVER', sortOrder: 20 },
      { name: 'Bonus', type: 'DRIVER_PAY', scope: 'PER_DRIVER', sortOrder: 21 },
      { name: 'Layover', type: 'DRIVER_PAY', scope: 'PER_DRIVER', sortOrder: 22 },
      { name: 'Deductions', type: 'DRIVER_PAY', scope: 'PER_DRIVER', sortOrder: 23 },
    ];

    await prisma.expenseCategory.createMany({
      data: defaults.map((d) => ({ ...d, carrierId })),
    });

    return res.json({ message: 'Default categories seeded', count: defaults.length });
  } catch (err: any) {
    console.error('[fleet] seed categories error:', err.message);
    return res.status(500).json({ error: 'Failed to seed categories' });
  }
});

// =====================================================================
// FLEET KPIs
// =====================================================================

// GET /api/fleet/kpis?month=2026-03
router.get('/kpis', requireSupabaseAuth, async (req: Request, res: Response) => {
  try {
    const carrierId = await getCarrierId(req);
    const month = req.query.month as string | undefined; // "2026-03" or undefined for YTD

    // Get all drivers for this carrier
    const drivers = await prisma.driver.findMany({
      where: { carrierId },
      select: { id: true, name: true, targetRPM: true },
    });
    const driverIds = drivers.map((d) => d.id);

    // Date range
    let dateFrom: Date;
    let dateTo: Date;
    if (month) {
      const [y, m] = month.split('-').map(Number);
      dateFrom = new Date(y, m - 1, 1);
      dateTo = new Date(y, m, 1); // first of next month
    } else {
      // YTD
      dateFrom = new Date(new Date().getFullYear(), 0, 1);
      dateTo = new Date(new Date().getFullYear() + 1, 0, 1);
    }

    // Load aggregation per driver
    const loads = await prisma.dispatchLoad.findMany({
      where: {
        driverId: { in: driverIds },
        createdAt: { gte: dateFrom, lt: dateTo },
      },
      select: {
        driverId: true,
        rate: true,
        loadedMiles: true,
        deadheadMiles: true,
      },
    });

    // Expense month filter
    let expenseMonths: string[];
    if (month) {
      expenseMonths = [month];
    } else {
      // YTD — all months of current year
      const year = new Date().getFullYear();
      expenseMonths = [];
      for (let m = 1; m <= 12; m++) {
        expenseMonths.push(`${year}-${String(m).padStart(2, '0')}`);
      }
    }

    const allExpenses = await prisma.fleetExpense.findMany({
      where: { month: { in: expenseMonths }, category: { carrierId } },
      include: { category: { select: { type: true, scope: true, name: true } } },
    });

    // Fleet settings
    const settings = await prisma.fleetSettings.findFirst({ where: { carrierId } });
    const factoringRate = settings?.factoringRate ?? 0.022;

    // Aggregate
    let totalRevenue = 0;
    let totalLoadedMiles = 0;
    let totalDeadheadMiles = 0;
    let totalLoads = 0;
    const driverMap = new Map<string, { revenue: number; loads: number; loadedMiles: number; deadheadMiles: number }>();

    for (const d of drivers) {
      driverMap.set(d.id, { revenue: 0, loads: 0, loadedMiles: 0, deadheadMiles: 0 });
    }

    for (const l of loads) {
      const rate = l.rate || 0;
      const lm = l.loadedMiles || 0;
      const dh = l.deadheadMiles || 0;
      totalRevenue += rate;
      totalLoadedMiles += lm;
      totalDeadheadMiles += dh;
      totalLoads++;
      const dm = driverMap.get(l.driverId);
      if (dm) {
        dm.revenue += rate;
        dm.loads++;
        dm.loadedMiles += lm;
        dm.deadheadMiles += dh;
      }
    }

    const factoringFee = totalRevenue * factoringRate;
    const netRevenue = totalRevenue - factoringFee;

    let fixedExpenses = 0;
    let variableExpenses = 0;
    let driverPay = 0;
    let fuelExpenses = 0;
    for (const e of allExpenses) {
      const t = e.category.type;
      if (t === 'FIXED') fixedExpenses += e.amount;
      else if (t === 'VARIABLE') variableExpenses += e.amount;
      else if (t === 'DRIVER_PAY') driverPay += e.amount;
      if ((e.category as any).name?.toLowerCase() === 'fuel') fuelExpenses += e.amount;
    }

    const totalExpenses = fixedExpenses + variableExpenses + driverPay;
    const netProfit = netRevenue - totalExpenses;
    const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;
    const avgRPM = totalLoadedMiles > 0 ? totalRevenue / totalLoadedMiles : 0;

    // Per-driver breakdown
    const driverBreakdown = drivers.map((d) => {
      const dm = driverMap.get(d.id)!;
      // Driver-specific expenses
      let driverExpTotal = 0;
      for (const e of allExpenses) {
        if (e.driverId === d.id) {
          driverExpTotal += e.amount;
        } else if (e.category.scope === 'FLEET' && !e.driverId && drivers.length > 0) {
          // Fleet-scope expenses split evenly
          driverExpTotal += e.amount / drivers.length;
        }
      }
      const driverFactoring = dm.revenue * factoringRate;
      const driverNet = dm.revenue - driverFactoring - driverExpTotal;
      const driverMargin = dm.revenue > 0 ? (driverNet / dm.revenue) * 100 : 0;
      const driverRPM = dm.loadedMiles > 0 ? dm.revenue / dm.loadedMiles : 0;
      return {
        driverId: d.id,
        name: d.name,
        targetRPM: d.targetRPM,
        revenue: Math.round(dm.revenue),
        loads: dm.loads,
        avgRPM: Math.round(driverRPM * 100) / 100,
        loadedMiles: Math.round(dm.loadedMiles),
        netProfit: Math.round(driverNet),
        profitMargin: Math.round(driverMargin * 10) / 10,
      };
    });

    const totalMiles = totalLoadedMiles + totalDeadheadMiles;
    const utilization = totalMiles > 0 ? (totalLoadedMiles / totalMiles) * 100 : 0;
    const fuelPercent = totalRevenue > 0 ? (fuelExpenses / totalRevenue) * 100 : 0;
    const cpm = totalMiles > 0 ? totalExpenses / totalMiles : 0;

    return res.json({
      revenue: Math.round(totalRevenue),
      factoringFee: Math.round(factoringFee),
      factoringRate,
      netRevenue: Math.round(netRevenue),
      fixedExpenses: Math.round(fixedExpenses),
      variableExpenses: Math.round(variableExpenses),
      driverPay: Math.round(driverPay),
      fuelExpenses: Math.round(fuelExpenses),
      totalExpenses: Math.round(totalExpenses),
      netProfit: Math.round(netProfit),
      profitMargin: Math.round(profitMargin * 10) / 10,
      avgRPM: Math.round(avgRPM * 100) / 100,
      totalMiles: Math.round(totalMiles),
      loadedMiles: Math.round(totalLoadedMiles),
      deadheadMiles: Math.round(totalDeadheadMiles),
      utilization: Math.round(utilization * 10) / 10,
      fuelPercent: Math.round(fuelPercent * 10) / 10,
      cpm: Math.round(cpm * 100) / 100,
      totalLoads,
      drivers: driverBreakdown,
    });
  } catch (err: any) {
    console.error('[fleet] KPI fetch error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch fleet KPIs' });
  }
});

// =====================================================================
// DRIVER KPIs
// =====================================================================

// GET /api/fleet/drivers/:id/kpis?month=2026-03
router.get('/drivers/:id/kpis', requireSupabaseAuth, async (req: Request, res: Response) => {
  try {
    const driverId = req.params.id;
    const month = req.query.month as string | undefined;
    const carrierId = await getCarrierId(req);

    // Date range
    let dateFrom: Date;
    let dateTo: Date;
    if (month) {
      const [y, m] = month.split('-').map(Number);
      dateFrom = new Date(y, m - 1, 1);
      dateTo = new Date(y, m, 1);
    } else {
      dateFrom = new Date(new Date().getFullYear(), 0, 1);
      dateTo = new Date(new Date().getFullYear() + 1, 0, 1);
    }

    const loads = await prisma.dispatchLoad.findMany({
      where: {
        driverId,
        createdAt: { gte: dateFrom, lt: dateTo },
      },
      select: { rate: true, loadedMiles: true, deadheadMiles: true },
    });

    let revenue = 0, loadedMiles = 0, deadheadMiles = 0, loadCount = 0;
    for (const l of loads) {
      revenue += l.rate || 0;
      loadedMiles += l.loadedMiles || 0;
      deadheadMiles += l.deadheadMiles || 0;
      loadCount++;
    }
    const totalMiles = loadedMiles + deadheadMiles;

    // Expenses for this driver
    let expenseMonths: string[];
    if (month) {
      expenseMonths = [month];
    } else {
      const year = new Date().getFullYear();
      expenseMonths = [];
      for (let m = 1; m <= 12; m++) {
        expenseMonths.push(`${year}-${String(m).padStart(2, '0')}`);
      }
    }

    const driverCount = await prisma.driver.count({ where: { carrierId } });

    const expenses = await prisma.fleetExpense.findMany({
      where: {
        month: { in: expenseMonths },
        category: { carrierId },
        OR: [
          { driverId },
          { driverId: null, category: { scope: 'FLEET' } },
        ],
      },
      include: { category: { select: { type: true, scope: true, name: true } } },
    });

    let totalExpenses = 0;
    let fuelExpenses = 0;
    for (const e of expenses) {
      const amt = e.driverId ? e.amount : e.amount / Math.max(driverCount, 1);
      totalExpenses += amt;
      if (e.category.name.toLowerCase() === 'fuel') fuelExpenses += amt;
    }

    const settings = await prisma.fleetSettings.findFirst({ where: { carrierId } });
    const factoringRate = settings?.factoringRate ?? 0.022;
    const netRevenue = revenue * (1 - factoringRate);
    const netProfit = netRevenue - totalExpenses;

    return res.json({
      revenue: Math.round(revenue),
      avgRPM: loadedMiles > 0 ? Math.round((revenue / loadedMiles) * 100) / 100 : 0,
      loadedMiles: Math.round(loadedMiles),
      deadheadMiles: Math.round(deadheadMiles),
      totalMiles: Math.round(totalMiles),
      utilization: totalMiles > 0 ? Math.round((loadedMiles / totalMiles) * 1000) / 10 : 0,
      fuelPercent: revenue > 0 ? Math.round((fuelExpenses / revenue) * 1000) / 10 : 0,
      cpm: totalMiles > 0 ? Math.round((totalExpenses / totalMiles) * 100) / 100 : 0,
      netProfit: Math.round(netProfit),
      profitMargin: revenue > 0 ? Math.round((netProfit / revenue) * 1000) / 10 : 0,
      loadCount,
    });
  } catch (err: any) {
    console.error('[fleet] driver KPI error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch driver KPIs' });
  }
});

// =====================================================================
// EXPENSES CRUD
// =====================================================================

// GET /api/fleet/expenses?month=2026-03
router.get('/expenses', requireSupabaseAuth, async (req: Request, res: Response) => {
  try {
    const carrierId = await getCarrierId(req);
    const month = req.query.month as string | undefined;
    const driverId = req.query.driverId as string | undefined;

    const where: any = { category: { carrierId } };
    if (month) where.month = month;
    if (driverId) where.driverId = driverId;

    const expenses = await prisma.fleetExpense.findMany({
      where,
      include: { category: { select: { id: true, name: true, type: true, scope: true } }, driver: { select: { id: true, name: true } } },
      orderBy: [{ category: { type: 'asc' } }, { category: { sortOrder: 'asc' } }],
    });

    return res.json({ expenses });
  } catch (err: any) {
    console.error('[fleet] expenses fetch error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch expenses' });
  }
});

// POST /api/fleet/expenses — create single expense
router.post('/expenses', requireSupabaseAuth, async (req: Request, res: Response) => {
  try {
    const { categoryId, driverId, month, amount, notes, source } = req.body;
    const expense = await prisma.fleetExpense.create({
      data: {
        categoryId,
        driverId: driverId || null,
        month: month || new Date().toISOString().slice(0, 7),
        amount: parseFloat(amount),
        notes: notes || null,
        source: source || 'MANUAL',
      },
    });
    return res.json({ expense });
  } catch (err: any) {
    console.error('[fleet] create expense error:', err.message);
    return res.status(500).json({ error: 'Failed to create expense' });
  }
});

// POST /api/fleet/expenses/bulk-create
router.post('/expenses/bulk-create', requireSupabaseAuth, async (req: Request, res: Response) => {
  try {
    const { expenses: items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'expenses array required' });
    }

    const created = await prisma.fleetExpense.createMany({
      data: items.map((item: any) => ({
        categoryId: item.categoryId,
        driverId: item.driverId || null,
        month: item.month || new Date().toISOString().slice(0, 7),
        amount: parseFloat(item.amount),
        notes: item.notes || null,
        source: item.source || 'MANUAL',
      })),
    });

    return res.json({ created: created.count });
  } catch (err: any) {
    console.error('[fleet] bulk create expenses error:', err.message);
    return res.status(500).json({ error: 'Failed to bulk create expenses' });
  }
});

// PUT /api/fleet/expenses/:id
router.put('/expenses/:id', requireSupabaseAuth, async (req: Request, res: Response) => {
  try {
    const { categoryId, driverId, month, amount, notes } = req.body;
    const data: any = {};
    if (categoryId !== undefined) data.categoryId = categoryId;
    if (driverId !== undefined) data.driverId = driverId || null;
    if (month !== undefined) data.month = month;
    if (amount !== undefined) data.amount = parseFloat(amount);
    if (notes !== undefined) data.notes = notes || null;

    const expense = await prisma.fleetExpense.update({ where: { id: req.params.id }, data });
    return res.json({ expense });
  } catch (err: any) {
    console.error('[fleet] update expense error:', err.message);
    return res.status(500).json({ error: 'Failed to update expense' });
  }
});

// DELETE /api/fleet/expenses/:id
router.delete('/expenses/:id', requireSupabaseAuth, async (req: Request, res: Response) => {
  try {
    await prisma.fleetExpense.delete({ where: { id: req.params.id } });
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[fleet] delete expense error:', err.message);
    return res.status(500).json({ error: 'Failed to delete expense' });
  }
});

// =====================================================================
// EXPENSE UPLOAD — parse CC/fuel statement
// =====================================================================

// POST /api/fleet/expenses/upload
router.post('/expenses/upload', requireSupabaseAuth, upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const carrierId = await getCarrierId(req);
    const categories = await prisma.expenseCategory.findMany({
      where: { carrierId, active: true },
      orderBy: { sortOrder: 'asc' },
    });
    const drivers = await prisma.driver.findMany({
      where: { carrierId },
      select: { id: true, name: true },
    });

    const ext = req.file.originalname?.toLowerCase() || '';
    let parsedItems: Array<{ date: string; description: string; amount: number; cardMember?: string }> = [];

    if (ext.endsWith('.csv')) {
      const fs = require('fs');
      const raw = fs.readFileSync(req.file.path, 'utf8');
      const records = csvParse(raw, { columns: true, skip_empty_lines: true, trim: true });
      parsedItems = records.map((r: any) => ({
        date: r.Date || r.date || r['Transaction Date'] || '',
        description: r.Description || r.description || r.Merchant || '',
        amount: Math.abs(parseFloat(r.Amount || r.amount || r.Debit || '0')),
        cardMember: r['Card Member'] || r['Card Holder'] || r.Name || '',
      }));
    } else if (ext.endsWith('.xlsx') || ext.endsWith('.xls')) {
      const workbook = XLSX.readFile(req.file.path);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(sheet);
      parsedItems = rows.map((r: any) => ({
        date: String(r.Date || r.date || r['Transaction Date'] || ''),
        description: String(r.Description || r.description || r.Merchant || ''),
        amount: Math.abs(parseFloat(String(r.Amount || r.amount || r.Debit || '0'))),
        cardMember: String(r['Card Member'] || r['Card Holder'] || r.Name || ''),
      }));
    } else {
      // PDF or image — would need OCR. Return empty for now with a message.
      return res.json({
        items: [],
        message: 'PDF/image parsing not yet supported for expense uploads. Use CSV or XLSX.',
      });
    }

    // Auto-categorize and match drivers
    const result = parsedItems.map((item) => {
      // Try to categorize
      const catResult = categorizeExpense(item.description);
      let matchedCategoryId: string | null = null;
      if (catResult) {
        const found = categories.find((c: any) => c.name.toLowerCase() === catResult.toLowerCase());
        if (found) matchedCategoryId = found.id;
      }

      // Try to match driver by card member name
      let matchedDriverId: string | null = null;
      if (item.cardMember) {
        const lower = item.cardMember.toLowerCase();
        const found = drivers.find((d) => d.name.toLowerCase().includes(lower) || lower.includes(d.name.toLowerCase()));
        if (found) matchedDriverId = found.id;
      }

      return {
        date: item.date,
        description: item.description,
        amount: item.amount,
        cardMember: item.cardMember || null,
        categoryId: matchedCategoryId,
        driverId: matchedDriverId,
      };
    });

    // Cleanup temp file
    try { require('fs').unlinkSync(req.file.path); } catch {}

    return res.json({
      items: result,
      categories: categories.map((c: any) => ({ id: c.id, name: c.name, type: c.type })),
      drivers: drivers.map((d: any) => ({ id: d.id, name: d.name })),
    });
  } catch (err: any) {
    console.error('[fleet] expense upload error:', err.message);
    return res.status(500).json({ error: 'Failed to parse expense file' });
  }
});

// =====================================================================
// FLEET SETTINGS
// =====================================================================

// GET /api/fleet/settings
router.get('/settings', requireSupabaseAuth, async (req: Request, res: Response) => {
  try {
    const carrierId = await getCarrierId(req);
    let settings = await prisma.fleetSettings.findFirst({ where: { carrierId } });
    if (!settings) {
      settings = await prisma.fleetSettings.create({
        data: { carrierId, factoringRate: 0.022 },
      });
    }
    return res.json({ settings });
  } catch (err: any) {
    console.error('[fleet] settings fetch error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch fleet settings' });
  }
});

// PUT /api/fleet/settings
router.put('/settings', requireSupabaseAuth, async (req: Request, res: Response) => {
  try {
    const carrierId = await getCarrierId(req);
    const { factoringRate } = req.body;
    const settings = await prisma.fleetSettings.upsert({
      where: { carrierId },
      update: { factoringRate: parseFloat(factoringRate) },
      create: { carrierId, factoringRate: parseFloat(factoringRate) },
    });
    return res.json({ settings });
  } catch (err: any) {
    console.error('[fleet] settings update error:', err.message);
    return res.status(500).json({ error: 'Failed to update fleet settings' });
  }
});

export default router;
