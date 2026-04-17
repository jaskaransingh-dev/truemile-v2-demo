import express, { Request, Response } from 'express';
import { prisma } from '../lib/prisma';

const router = express.Router();

// For MVP demo, using hardcoded userId
// In production, get this from auth session
const DEFAULT_USER_ID = 'demo-user';

// GET /api/fleet - Load fleet metrics
router.get('/', async (req: Request, res: Response) => {
  try {
    // Get or create fleet
    let fleet = await prisma.fleet.findUnique({
      where: { userId: DEFAULT_USER_ID },
      include: {
        trucks: true,
        drivers: true,
        expenses: {
          orderBy: { date: 'desc' },
          take: 100
        },
        loads: {
          orderBy: { date: 'desc' },
          take: 100
        }
      }
    });

    if (!fleet) {
      fleet = await prisma.fleet.create({
        data: { userId: DEFAULT_USER_ID },
        include: {
          trucks: true,
          drivers: true,
          expenses: true,
          loads: true
        }
      });
    }

    // Calculate aggregated metrics
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Get recent expenses (last 30 days)
    const recentExpenses = await prisma.expense.groupBy({
      by: ['category'],
      where: {
        fleetId: fleet.id,
        date: { gte: thirtyDaysAgo }
      },
      _sum: { amount: true }
    });

    const expensesByCategory = recentExpenses.reduce((acc: any, exp) => {
      acc[exp.category] = exp._sum.amount || 0;
      return acc;
    }, {});

    // Get recent loads (last 30 days)
    const recentLoads = await prisma.fleetLoad.findMany({
      where: {
        fleetId: fleet.id,
        date: { gte: thirtyDaysAgo }
      }
    });

    const loadsPerMonth = recentLoads.length;
    const milesPerMonth = recentLoads.reduce((sum, load) => sum + load.miles, 0);

    const metrics = {
      trucks: fleet.trucks.length,
      drivers: fleet.drivers.length,
      loadsPerMonth,
      milesPerMonth,
      fuelCost: expensesByCategory.fuel || 0,
      insurance: expensesByCategory.insurance || 0,
      maintenance: expensesByCategory.maintenance || 0,
      otherExpenses: expensesByCategory.other || 0
    };

    return res.json({ success: true, metrics });

  } catch (error: any) {
    console.error('Fleet GET error:', error);
    return res.status(500).json({ 
      error: 'Failed to load fleet data',
      details: error.message 
    });
  }
});

// POST /api/fleet - Save fleet metrics
router.post('/', async (req: Request, res: Response) => {
  try {
    const metrics = req.body;

    // Get or create fleet
    let fleet = await prisma.fleet.findUnique({
      where: { userId: DEFAULT_USER_ID }
    });

    if (!fleet) {
      fleet = await prisma.fleet.create({
        data: { userId: DEFAULT_USER_ID }
      });
    }

    // Update expenses (create new records for the current month)
    const now = new Date();
    
    // Helper function to create unique expense IDs
    const getExpenseId = (category: string) => 
      `${fleet!.id}-${category}-${now.getMonth()}-${now.getFullYear()}`;

    if (metrics.fuelCost > 0) {
      await prisma.expense.upsert({
        where: { id: getExpenseId('fuel') },
        create: {
          id: getExpenseId('fuel'),
          fleetId: fleet.id,
          category: 'fuel',
          amount: metrics.fuelCost,
          date: now
        },
        update: {
          amount: metrics.fuelCost
        }
      });
    }

    if (metrics.insurance > 0) {
      await prisma.expense.upsert({
        where: { id: getExpenseId('insurance') },
        create: {
          id: getExpenseId('insurance'),
          fleetId: fleet.id,
          category: 'insurance',
          amount: metrics.insurance,
          date: now
        },
        update: {
          amount: metrics.insurance
        }
      });
    }

    if (metrics.maintenance > 0) {
      await prisma.expense.upsert({
        where: { id: getExpenseId('maintenance') },
        create: {
          id: getExpenseId('maintenance'),
          fleetId: fleet.id,
          category: 'maintenance',
          amount: metrics.maintenance,
          date: now
        },
        update: {
          amount: metrics.maintenance
        }
      });
    }

    if (metrics.otherExpenses > 0) {
      await prisma.expense.upsert({
        where: { id: getExpenseId('other') },
        create: {
          id: getExpenseId('other'),
          fleetId: fleet.id,
          category: 'other',
          amount: metrics.otherExpenses,
          date: now
        },
        update: {
          amount: metrics.otherExpenses
        }
      });
    }

    return res.json({ success: true });

  } catch (error: any) {
    console.error('Fleet POST error:', error);
    return res.status(500).json({ 
      error: 'Failed to save fleet data',
      details: error.message 
    });
  }
});

// GET /api/fleet/drivers - Get all drivers
router.get('/drivers', async (req: Request, res: Response) => {
  try {
    const fleet = await prisma.fleet.findUnique({
      where: { userId: DEFAULT_USER_ID },
      include: { drivers: { where: { status: 'active' } } }
    });

    if (!fleet) {
      return res.json({ success: true, drivers: [] });
    }

    return res.json({ 
      success: true, 
      drivers: fleet.drivers 
    });

  } catch (error: any) {
    console.error('Drivers GET error:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Failed to load drivers',
      details: error.message 
    });
  }
});

// GET /api/fleet/trucks - Get all trucks
router.get('/trucks', async (req: Request, res: Response) => {
  try {
    const fleet = await prisma.fleet.findUnique({
      where: { userId: DEFAULT_USER_ID },
      include: { trucks: { where: { status: 'active' } } }
    });

    if (!fleet) {
      return res.json({ success: true, trucks: [] });
    }

    return res.json({ 
      success: true, 
      trucks: fleet.trucks 
    });

  } catch (error: any) {
    console.error('Trucks GET error:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Failed to load trucks',
      details: error.message 
    });
  }
});

// GET /api/fleet/trailers - Get all trailers
router.get('/trailers', async (req: Request, res: Response) => {
  try {
    const fleet = await prisma.fleet.findUnique({
      where: { userId: DEFAULT_USER_ID },
      include: { trailers: { where: { status: 'active' } } }
    });

    if (!fleet) {
      return res.json({ success: true, trailers: [] });
    }

    return res.json({ 
      success: true, 
      trailers: fleet.trailers 
    });

  } catch (error: any) {
    console.error('Trailers GET error:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Failed to load trailers',
      details: error.message 
    });
  }
});

export default router;
