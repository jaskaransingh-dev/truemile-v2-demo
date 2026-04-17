// src/routes/broker-intelligence.routes.ts

import { Router } from 'express';
import { prisma } from '../lib/prisma';

const router = Router();

// GET /api/broker-intelligence/stats - Overall dashboard stats
router.get('/stats', async (req, res) => {
  try {
    const [totalLoads, highPriorityCount, avgRate, topBrokers] = await Promise.all([
      // Total loads
      prisma.load.count(),
      
      // High priority loads (70+)
      prisma.load.count({ where: { priorityScore: { gte: 70 } } }),
      
      // Average rate per mile
      prisma.load.aggregate({ _avg: { ratePerMile: true } }),
      
      // Top 3 brokers
      prisma.brokerStats.findMany({
        orderBy: { relationshipScore: 'desc' },
        take: 3
      })
    ]);

    res.json({
      totalLoads,
      highPriorityCount,
      avgRate: avgRate._avg.ratePerMile?.toFixed(2) || '0.00',
      topBrokers
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// GET /api/broker-intelligence/priority-loads - High priority loads
router.get('/priority-loads', async (req, res) => {
  try {
    const minScore = parseInt(req.query.minScore as string) || 70;

    const loads = await prisma.load.findMany({
      where: { priorityScore: { gte: minScore } },
      orderBy: { priorityScore: 'desc' },
      take: 50,
      include: {
        message: {
          select: {
            id: true,
            subject: true,
            from: true,
            receivedAt: true
          }
        }
      }
    });

    res.json(loads);
  } catch (error) {
    console.error('Error fetching priority loads:', error);
    res.status(500).json({ error: 'Failed to fetch priority loads' });
  }
});

// GET /api/broker-intelligence/brokers - All brokers with stats
router.get('/brokers', async (req, res) => {
  try {
    const brokers = await prisma.brokerStats.findMany({
      orderBy: { relationshipScore: 'desc' }
    });

    res.json(brokers);
  } catch (error) {
    console.error('Error fetching brokers:', error);
    res.status(500).json({ error: 'Failed to fetch brokers' });
  }
});

// GET /api/broker-intelligence/brokers/:broker/loads - Loads from specific broker
router.get('/brokers/:broker/loads', async (req, res) => {
  try {
    const broker = decodeURIComponent(req.params.broker);
    
    const loads = await prisma.load.findMany({
      where: { broker },
      orderBy: { priorityScore: 'desc' },
      include: {
        message: {
          select: {
            id: true,
            subject: true,
            receivedAt: true
          }
        }
      }
    });

    res.json(loads);
  } catch (error) {
    console.error('Error fetching broker loads:', error);
    res.status(500).json({ error: 'Failed to fetch broker loads' });
  }
});

// GET /api/broker-intelligence/loads - All loads with filters
router.get('/loads', async (req, res) => {
  try {
    const {
      minScore,
      maxScore,
      origin,
      destination,
      equipment,
      broker,
      minRate,
      sortBy = 'priorityScore',
      order = 'desc'
    } = req.query;

    const where: any = {};
    
    if (minScore) where.priorityScore = { gte: parseFloat(minScore as string) };
    if (maxScore) where.priorityScore = { ...where.priorityScore, lte: parseFloat(maxScore as string) };
    if (origin) where.origin = { contains: origin as string, mode: 'insensitive' };
    if (destination) where.destination = { contains: destination as string, mode: 'insensitive' };
    if (equipment) where.equipment = { contains: equipment as string, mode: 'insensitive' };
    if (broker) where.broker = { contains: broker as string, mode: 'insensitive' };
    if (minRate) where.ratePerMile = { gte: parseFloat(minRate as string) };

    const loads = await prisma.load.findMany({
      where,
      orderBy: { [sortBy as string]: order },
      take: 100,
      include: {
        message: {
          select: {
            id: true,
            subject: true,
            receivedAt: true
          }
        }
      }
    });

    res.json(loads);
  } catch (error) {
    console.error('Error fetching loads:', error);
    res.status(500).json({ error: 'Failed to fetch loads' });
  }
});

export default router;
