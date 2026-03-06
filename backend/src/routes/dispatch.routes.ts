import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import OpenAI from 'openai';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth.middleware';
import { tenantScope } from '../middleware/tenant.middleware';

const router = Router();

const globalForPrisma = global as unknown as { prisma: PrismaClient };
const prisma = globalForPrisma.prisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface DispatchPlan {
  driverName: string;
  daysOTR: number;
  daysOff: number;
  totalWorkingDays: number;
  milesNeeded: number;
  avgRPMNeeded: number;
  targetRevenue: number;
  estimatedExpenses: number;
  targetProfit: number;
  profitMargin: number;
  milesPerDay: number;
  milesPerTrip: number;
  revenuePerTrip: number;
}

/**
 * POST /api/dispatch/calculate
 * Calculate dispatch plan for a driver
 */
router.post('/calculate',
  authenticateToken,
  tenantScope,
  async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user!.id;
      const carrierId = (req as any).carrierId;

      const { driverName, daysOTR, daysOff } = req.body;

      if (!driverName || !daysOTR) {
        return res.status(400).json({
          success: false,
          error: 'driverName and daysOTR are required'
        });
      }

      const daysOffCalculated = daysOff || Math.round(daysOTR * 0.25);
      const cyclesIn30Days = Math.floor(30 / (daysOTR + daysOffCalculated));
      const totalWorkingDays = cyclesIn30Days * daysOTR;

      console.log(`📊 Calculating dispatch plan for ${driverName}`);
      console.log(`   Work cycle: ${daysOTR} days on, ${daysOffCalculated} days off`);
      console.log(`   In 30 days: ${totalWorkingDays} working days (${cyclesIn30Days} complete cycles)`);

      const fleet = await prisma.fleet.findFirst({
        where: { userId, carrierId },
        include: {
          expenses: {
            where: {
              carrierId,
              date: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) }
            }
          },
          loads: {
            where: {
              carrierId,
              date: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) }
            }
          }
        }
      });

      if (!fleet) {
        return res.status(404).json({
          success: false,
          error: 'Fleet data not found'
        });
      }

      const insuranceExpenses = fleet.expenses
        .filter(e => e.category === 'insurance')
        .reduce((sum, e) => sum + parseFloat(e.amount.toString()), 0);

      const fixedExpensesMonthly = insuranceExpenses || 2500;

      const totalMiles = fleet.loads.reduce((sum, l) => sum + l.miles, 0);
      const fuelExpenses = fleet.expenses
        .filter(e => e.category === 'fuel')
        .reduce((sum, e) => sum + parseFloat(e.amount.toString()), 0);
      const maintenanceExpenses = fleet.expenses
        .filter(e => e.category === 'maintenance')
        .reduce((sum, e) => sum + parseFloat(e.amount.toString()), 0);

      const variableExpensesPerMile = totalMiles > 0
        ? (fuelExpenses + maintenanceExpenses) / totalMiles
        : 0.85;

      const driver = await prisma.driver.findFirst({
        where: {
          name: { equals: driverName, mode: 'insensitive' },
          carrierId,
          fleetId: fleet.id
        }
      });

      let driverPayRate = driver?.payRate ? parseFloat(driver.payRate.toString()) : 0.5;
      if (driverPayRate > 1) {
        driverPayRate = driverPayRate / 100;
      }

      console.log(`   Driver pay rate: ${(driverPayRate * 100).toFixed(0)}%`);

      const avgMilesPerDay = 400;
      const estimatedMiles = totalWorkingDays * avgMilesPerDay;

      const desiredProfitMargin = 0.30;
      const revenueMultiplier = 1 - driverPayRate - desiredProfitMargin;

      if (revenueMultiplier <= 0 || isNaN(revenueMultiplier)) {
        return res.status(400).json({
          success: false,
          error: `Invalid margin settings: Driver pay (${(driverPayRate * 100).toFixed(0)}%) + Target profit (30%) exceeds 100%. Please adjust driver pay rate.`
        });
      }

      const variableCosts = estimatedMiles * variableExpensesPerMile;
      const targetRevenue = (fixedExpensesMonthly + variableCosts) / revenueMultiplier;

      if (isNaN(targetRevenue) || targetRevenue <= 0) {
        return res.status(400).json({
          success: false,
          error: 'Unable to calculate valid targets. Please check fleet expense data.'
        });
      }

      const avgRPMNeeded = targetRevenue / estimatedMiles;
      const driverPay = targetRevenue * driverPayRate;
      const totalExpenses = fixedExpensesMonthly + variableCosts;
      const targetProfit = targetRevenue - driverPay - totalExpenses;
      const profitMargin = (targetProfit / targetRevenue) * 100;

      const milesPerTrip = Math.round((estimatedMiles / cyclesIn30Days));
      const revenuePerTrip = Math.round((targetRevenue / cyclesIn30Days));

      const plan: DispatchPlan = {
        driverName,
        daysOTR,
        daysOff: daysOffCalculated,
        totalWorkingDays,
        milesNeeded: Math.round(estimatedMiles),
        avgRPMNeeded: parseFloat(avgRPMNeeded.toFixed(2)),
        targetRevenue: Math.round(targetRevenue),
        estimatedExpenses: Math.round(totalExpenses),
        targetProfit: Math.round(targetProfit),
        profitMargin: parseFloat(profitMargin.toFixed(1)),
        milesPerDay: Math.round(avgMilesPerDay),
        milesPerTrip,
        revenuePerTrip
      };

      console.log(`   ✅ Plan: ${plan.milesNeeded} mi @ $${plan.avgRPMNeeded}/mi`);

      res.json({
        success: true,
        plan
      });

    } catch (error: any) {
      console.error('Dispatch calculation error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/**
 * POST /api/dispatch/chat
 * AI-powered dispatch planning conversation
 */
router.post('/chat',
  authenticateToken,
  tenantScope,
  async (req: AuthenticatedRequest, res) => {
    console.log('🔵 Dispatch chat started');

    try {
      const userId = req.user!.id;
      const carrierId = (req as any).carrierId;

      const { messages } = req.body;
      console.log('🔵 Messages received:', messages?.length);

      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({
          success: false,
          error: 'messages array is required'
        });
      }

      const fleet = await prisma.fleet.findFirst({
        where: { userId, carrierId },
        include: {
          drivers: {
            where: {
              carrierId,
              status: 'active'
            }
          },
          expenses: {
            where: {
              carrierId,
              date: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) }
            }
          },
          loads: {
            where: {
              carrierId,
              date: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) }
            }
          }
        }
      });

      const driverNames = fleet?.drivers.map(d => d.name).join(', ') || 'No drivers';

      const systemPrompt = `You are a dispatch planning assistant for Royal Carriers Inc.

AVAILABLE DRIVERS: ${driverNames}

CONVERSATION FLOW:
1. Ask: "Which driver are we planning routes for?"
2. Ask: "How many days will [driver] be OTR (on the road)?"
3. Ask: "After [driver] is home, how many days off before going back on the road?"
4. Once you have all 3 answers, say: "Got it! Let me calculate the optimal plan..."

Keep responses SHORT - one question at a time.`;

      console.log('🔵 Calling OpenAI...');

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages
        ],
        temperature: 0.7,
        max_tokens: 500
      });

      let reply = completion.choices[0].message.content || '';

      const userMessages = messages.filter(m => m.role === 'user');
      const allUserText = userMessages.map(m => m.content).join(' ').toLowerCase();

      const driverMatch = allUserText.match(/\b(max|parvinder|rajinder|paul)\b/i);
      const daysOTRMatch = userMessages.length >= 2 ? userMessages[1].content.match(/\d+/) : null;
      const daysOffMatch = userMessages.length >= 3 ? userMessages[2].content.match(/\d+/) : null;

      if (userMessages.length >= 3 && driverMatch && daysOTRMatch && daysOffMatch && fleet) {
        console.log('🔵 Calculating plan...');

        const driverName = driverMatch[1];
        const daysOTR = parseInt(daysOTRMatch[0]);
        const daysOff = parseInt(daysOffMatch[0]);

        const daysOffCalculated = daysOff;
        const cyclesIn30Days = Math.floor(30 / (daysOTR + daysOffCalculated));
        const totalWorkingDays = cyclesIn30Days * daysOTR;

        const driver = await prisma.driver.findFirst({
          where: {
            name: { equals: driverName, mode: 'insensitive' },
            carrierId,
            fleetId: fleet.id
          }
        });

        let driverPayRate = driver?.payRate ? parseFloat(driver.payRate.toString()) : 0.5;
        if (driverPayRate > 1) {
          driverPayRate = driverPayRate / 100;
        }

        console.log(`   Driver pay rate: ${(driverPayRate * 100).toFixed(0)}%`);

        const insuranceExpenses = fleet.expenses
          .filter(e => e.category === 'insurance')
          .reduce((sum, e) => sum + parseFloat(e.amount.toString()), 0);
        const fixedExpensesMonthly = insuranceExpenses || 2500;

        const totalMiles = fleet.loads.reduce((sum, l) => sum + l.miles, 0);
        const fuelExpenses = fleet.expenses
          .filter(e => e.category === 'fuel')
          .reduce((sum, e) => sum + parseFloat(e.amount.toString()), 0);
        const maintenanceExpenses = fleet.expenses
          .filter(e => e.category === 'maintenance')
          .reduce((sum, e) => sum + parseFloat(e.amount.toString()), 0);

        const variableExpensesPerMile = totalMiles > 0
          ? (fuelExpenses + maintenanceExpenses) / totalMiles
          : 0.85;

        const avgMilesPerDay = 500;
        const estimatedMiles = totalWorkingDays * avgMilesPerDay;

        const marketRPM = 3;
        const targetRevenue = estimatedMiles * marketRPM;

        const variableCosts = estimatedMiles * variableExpensesPerMile;
        const totalExpenses = fixedExpensesMonthly + variableCosts;
        const driverPay = targetRevenue * driverPayRate;
        const targetProfit = targetRevenue - driverPay - totalExpenses;
        const profitMargin = (targetProfit / targetRevenue) * 100;

        const avgRPMNeeded = marketRPM;

        const milesPerTrip = Math.round(estimatedMiles / cyclesIn30Days);
        const revenuePerTrip = Math.round(targetRevenue / cyclesIn30Days);

        reply = `Perfect! Here's the 30-day dispatch plan for ${driverName}:

**Work Schedule**
- ${daysOTR} days OTR → ${daysOff} days off (${cyclesIn30Days} cycles)
- Total working days: ${totalWorkingDays} days

 **Monthly Targets (30 days)**
- Miles needed: ${estimatedMiles.toLocaleString()} miles
- Required rate: $${avgRPMNeeded.toFixed(2)}/mile
- Target revenue: $${Math.round(targetRevenue).toLocaleString()}
- Net profit: $${Math.round(targetProfit).toLocaleString()} (${profitMargin.toFixed(1)}%)

 **Per-Trip Breakdown (${daysOTR}-day trip)**
- Miles per trip: ${milesPerTrip.toLocaleString()} miles
- Revenue per trip: $${revenuePerTrip.toLocaleString()}
- Daily average: ${avgMilesPerDay} miles/day @ $${avgRPMNeeded.toFixed(2)}/mile`;

        try {
          console.log('💾 Saving dispatch plan to database...');

          await prisma.dispatch_plans.create({
            data: {
              carrier_id: carrierId,
              driver_name: driverName,
              days_otr: daysOTR,
              days_off: daysOff,
              total_working_days: totalWorkingDays,
              miles_needed: estimatedMiles,
              avg_rpm_needed: avgRPMNeeded,
              target_revenue: Math.round(targetRevenue),
              miles_per_trip: milesPerTrip,
              revenue_per_trip: revenuePerTrip
            }
          });

          console.log('✅ Dispatch plan saved to database');
        } catch (err) {
          console.log('⚠️ Failed to save dispatch plan:', err);
        }
      }

      console.log('✅ Response ready');

      res.json({
        success: true,
        reply
      });

    } catch (error: any) {
      console.error('❌ Dispatch chat error:', error.message);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

export default router;
