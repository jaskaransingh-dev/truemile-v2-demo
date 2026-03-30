/**
 * dispatch-dev.routes.ts
 *
 * Dev-only unauthenticated routes for local engine testing.
 * Registered ONLY when NODE_ENV !== 'production'.
 *
 * POST /api/dev/dispatch/rank-loads
 *   Single-load scoring with statistical continuation estimates.
 *   Fast, stateless. Returns ranked individual loads.
 *
 * POST /api/dev/dispatch/rank-routes
 *   Full multi-load route sequencing using real timing + real deadhead.
 *   Tries every feasible combination up to maxLoads depth.
 *   Returns ranked RouteSequence[] — each entry is an ordered sequence
 *   of real loads that returns the driver home within the cycle.
 *
 * Both routes:
 *   - No auth / tenant middleware
 *   - Hardcoded seed carrierId
 *   - No DB logging
 *   - CORS: Access-Control-Allow-Origin: * (set by index.ts registration)
 */

import { Router, type Request, type Response } from 'express';
import { validateRankLoadsBody } from '../validation/dispatch.validation';
import {
  runDispatchRanking,
  DriverHomeWindowError,
  type RankLoadsRequest,
} from '../services/dispatch.service';
import { rankRoutes } from '../services/dispatch/route-sequencer';
import { pregeocode } from '../services/dispatch/geocoder';
import { calculateDeadheadMiles } from '../services/dispatch/load-metrics';
import { rankLoads } from '../services/dispatch/decision-engine-v2';
import type { LoadDecision } from '../services/dispatch/decision-engine';
import type { CostModel } from '../services/dispatch/cycle-profit';

const router = Router();

const DEV_CARRIER_ID = '9b7c4f1e-69e8-4d58-b7a4-887a70f48b72'; // Royal Carriers (seed)

// ---------------------------------------------------------------------------
// CORS — allow file:// and localhost origins in dev
// ---------------------------------------------------------------------------

router.use((req: Request, res: Response, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  return next();
});

// ---------------------------------------------------------------------------
// POST /rank-loads
// ---------------------------------------------------------------------------

router.post('/rank-loads', (req: Request, res: Response) => {
  const validationError = validateRankLoadsBody(req.body);
  if (validationError) {
    return res.status(400).json({ success: false, error: validationError });
  }

  const body  = req.body as RankLoadsRequest;
  const nowMs = body.now ? Date.parse(body.now) : Date.now();

  try {
    const result = runDispatchRanking(DEV_CARRIER_ID, body, nowMs);

    const passing        = result.decisions.filter((d) => d.status !== 'REJECTED');
    const rejected       = result.decisions.filter((d) => d.status === 'REJECTED');
    const avgCycleProfit = result.summary.averagePassingCycleProfit;
    const ranked         = applyTieBreaker(passing, result.preferredStates, 0.05);

    return res.status(200).json({
      success:     true,
      carrierId:   result.carrierId,
      processedAt: new Date(result.processedAtMs).toISOString(),
      runId:       null, // dev mode — no DB logging

      summary: {
        loadsReceived: result.decisions.length,
        loadsAnalyzed: passing.length,
        viableCount:   passing.filter((d) => d.status === 'RECOMMENDED' || d.status === 'VIABLE').length,
        marginalCount: passing.filter((d) => d.status === 'MARGINAL').length,
        rejectedCount: rejected.length,
        avgCycleProfit: Math.round(avgCycleProfit),
      },

      topRecommendation: ranked[0]
        ? serializeRanked(ranked[0], result.costModel, avgCycleProfit, result.preferredStates)
        : null,

      rankedLoads:   ranked.map((d) => serializeRanked(d, result.costModel, avgCycleProfit, result.preferredStates)),
      rejectedLoads: rejected.map(serializeRejected),
    });

  } catch (err) {
    if (err instanceof DriverHomeWindowError) {
      return res.status(200).json({
        success:      false,
        error:        err.message,
        isOTR:        false,
        nextOTRStart: err.nextOTRStart,
      });
    }
    console.error('[dev/dispatch/rank-loads] Error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error during dispatch ranking' });
  }
});

// ---------------------------------------------------------------------------
// POST /rank-loads-v2
// Single-load MCI-aware ranking via decision-engine-v2.
// ---------------------------------------------------------------------------

router.post('/rank-loads-v2', async (req: Request, res: Response) => {
  const validationError = validateRankLoadsBody(req.body);
  if (validationError) {
    return res.status(400).json({ success: false, error: validationError });
  }

  const body  = req.body as RankLoadsRequest;
  const nowMs = body.now ? Date.parse(body.now) : Date.now();
  const now   = new Date(nowMs);

  try {
    const MS_PER_DAY      = 86_400_000;
    const cycleDays       = body.driver.cycleDays  ?? 17;
    const homeDays        = body.driver.homeDays   ?? 3;
    const cycleStartDate  = new Date(body.cycleStartDate);
    const msPerFullPeriod = (cycleDays + homeDays) * MS_PER_DAY;
    const msSinceStart    = nowMs - cycleStartDate.getTime();
    const completedCycles = Math.max(0, Math.floor(msSinceStart / msPerFullPeriod));
    const anchorMs        = cycleStartDate.getTime() + completedCycles * msPerFullPeriod;
    const cycleEndDate    = new Date(anchorMs + cycleDays * MS_PER_DAY + 12 * 60 * 60 * 1000);

    const currentLocation = body.driver.currentLocation;

    if (body.candidateLoads.length > 0) {
      console.log('[rank-loads-v2] first load deadheadMiles from payload:', (body.candidateLoads[0] as any).deadheadMiles);
    }

    const candidateLoads = body.candidateLoads.map((l) => ({
      id:               l.externalId,
      origin:           l.origin,
      destination:      l.destination,
      miles:            l.miles,
      rate:             l.rate,
      // Use pre-computed deadhead from payload if present (e.g. Excel upload); fall back to haversine.
      deadheadMiles:    (l as any).deadheadMiles ?? calculateDeadheadMiles(currentLocation, l.origin),
      deliveryDate:     (l.deliveryDate   ?? l.pickupWindowEnd   ?? '').substring(0, 10),
      pickupDate:       (l.pickupDate     ?? l.pickupWindowStart ?? '').substring(0, 10),
      // Raw ISO datetimes passed through for display — not truncated.
      pickupWindowStart: l.pickupWindowStart ?? undefined,
      deliveryDeadline:  l.pickupWindowEnd   ?? undefined,
      // Used for PICKUP_WINDOW_EXPIRED check.
      pickupWindowEnd:   l.pickupWindowEnd   ?? undefined,
      trailerType:      l.trailerType,
      brokerName:       l.brokerName,
    }));

    const minEffectiveRPM = body.driver.minEffectiveRPM ?? 1.62;

    const driver = {
      id:              body.driverId,
      homeLocation:    body.driver.homeLocation,
      currentLocation,
      trailerType:     body.driver.trailerType,
      avgDailyMiles:   body.driver.avgDailyMiles ?? 650,
      minEffectiveRPM,
      targetRPM:       minEffectiveRPM * 1.15, // 15% above survival floor
      dwellDays:       0.5,
      avoidStates:     body.driver.avoidStates ?? [],
    };

    const cycleState = {
      cycleStartDate: new Date(anchorMs),
      cycleEndDate,
      totalCycleDays: cycleDays,
    };

    const t0                           = Date.now();
    const { rankedLoads, rejectedLoads } = await rankLoads(candidateLoads, driver, cycleState, now);
    const executionMs                  = Date.now() - t0;

    return res.status(200).json({
      success:      true,
      carrierId:    DEV_CARRIER_ID,
      processedAt:  now.toISOString(),
      engineMode:   'RANK_LOADS_V2',
      executionMs,
      rankedLoads,
      rejectedLoads,
    });

  } catch (err) {
    console.error('[dev/dispatch/rank-loads-v2] Error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error during v2 ranking' });
  }
});

// ---------------------------------------------------------------------------
// POST /rank-routes
// Multi-load route sequencer — real timing, real deadhead, real profits.
// ---------------------------------------------------------------------------

router.post('/rank-routes', async (req: Request, res: Response) => {
  console.log('[rank-routes] Content-Type:', req.headers['content-type']);
  console.log('[rank-routes] req.body =', JSON.stringify(req.body, null, 2));
  const validationError = validateRankLoadsBody(req.body);
  if (validationError) {
    return res.status(400).json({ success: false, error: validationError });
  }

  const body  = req.body as RankLoadsRequest;
  const nowMs = body.now ? Date.parse(body.now) : Date.now();

  // Build driver + cycleState via the same service helpers that rank-loads uses,
  // but call rankRoutes directly with the internal objects.
  // We re-use runDispatchRanking's side-effect-free setup by calling it and
  // extracting the cost model, then calling rankRoutes separately.
  try {
    // Run the single-load engine first to obtain costModel + driver + cycleState
    // (runDispatchRanking is pure; it throws DriverHomeWindowError if not OTR)
    const rankResult = runDispatchRanking(DEV_CARRIER_ID, body, nowMs);

    // Re-hydrate loads and driver from the request body (same mapping as dispatch.service)
    const loads  = body.candidateLoads.map((l) => ({
      id:                l.externalId,
      carrierId:         DEV_CARRIER_ID,
      origin:            l.origin,
      destination:       l.destination,
      rate:              l.rate,
      miles:             l.miles,
      trailerType:       l.trailerType,
      pickupDate:        l.pickupDate ?? l.pickupWindowStart?.substring(0, 10) ?? '',
      deliveryDate:      l.deliveryDate ?? '',
      pickupWindowStart: l.pickupWindowStart,
      pickupWindowEnd:   l.pickupWindowEnd,
      brokerName:        l.brokerName ?? 'Unknown',
      numberOfStops:     l.numberOfStops ?? 1,
    }));

    const driver = {
      id:                    body.driverId,
      carrierId:             DEV_CARRIER_ID,
      name:                  body.driverId,
      currentLocation:       body.driver.currentLocation,
      homeLocation:          body.driver.homeLocation,
      trailerType:           body.driver.trailerType,
      avgDailyMiles:         body.driver.avgDailyMiles        ?? 650,
      cycleDays:             body.driver.cycleDays             ?? 17,
      homeDays:              body.driver.homeDays              ?? 3,
      maxDeadheadMiles:      body.driver.maxDeadheadMiles      ?? 200,
      minEffectiveRPM:       body.driver.minEffectiveRPM       ?? 1.62,
      preferredStates:       body.driver.preferredStates       ?? [],
      avoidStates:           body.driver.avoidStates           ?? [],
      survivalMarginPercent: body.driver.survivalMarginPercent ?? 5,
    };

    // Derive cycleState from the rank-loads result (it already computed it)
    // We need it separately — reconstruct from the engine's output decisions
    const MS_PER_DAY      = 86_400_000;
    const cycleStartDate  = new Date(body.cycleStartDate);
    const msPerFullPeriod = (driver.cycleDays + driver.homeDays) * MS_PER_DAY;
    const msSinceStart    = nowMs - cycleStartDate.getTime();
    const completedCycles = Math.max(0, Math.floor(msSinceStart / msPerFullPeriod));
    const anchorMs        = cycleStartDate.getTime() + completedCycles * msPerFullPeriod;
    const homeDeadline    = new Date(anchorMs + driver.cycleDays * MS_PER_DAY + 12 * 60 * 60 * 1000);
    const daysRemaining   = (homeDeadline.getTime() - nowMs) / MS_PER_DAY;

    const cycleState = {
      cycleStartDate:       new Date(anchorMs),
      homeDeadline,
      homeLocation:         driver.homeLocation,
      isOTR:                true, // guaranteed — runDispatchRanking would have thrown
      isInFinalCycleWindow: daysRemaining < driver.cycleDays * 0.25,
    };

    // Pre-geocode all locations so the sequencer uses real haversine distances.
    // Nominatim results are cached in-process; only uncached cities pay the 1.1s delay.
    const allLocations = [
      driver.currentLocation,
      driver.homeLocation,
      ...loads.map((l) => l.origin),
      ...loads.map((l) => l.destination),
    ];
    console.log(`[rank-routes] Pre-geocoding ${allLocations.length} location objects...`);
    await pregeocode(allLocations);
    console.log('[rank-routes] Geocoding complete. Building routes...');

    const result = rankRoutes(loads, driver, cycleState, rankResult.costModel, nowMs);

    return res.status(200).json({
      success:     true,
      carrierId:   DEV_CARRIER_ID,
      processedAt: new Date(nowMs).toISOString(),
      engineMode:  'ROUTE_SEQUENCER',

      summary: {
        totalRoutesEvaluated: result.summary.totalRoutesEvaluated,
        viableRoutes:         result.summary.viableRoutes,
        avgCycleProfit:       result.summary.avgCycleProfit,
        bestCycleProfit:      result.summary.bestCycleProfit,
      },

      rankedRoutes:       result.rankedRoutes,
      firstLegRejections: result.firstLegRejections,
    });

  } catch (err) {
    if (err instanceof DriverHomeWindowError) {
      return res.status(200).json({
        success:      false,
        error:        err.message,
        isOTR:        false,
        nextOTRStart: err.nextOTRStart,
      });
    }
    console.error('[dev/dispatch/rank-routes] Error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error during route ranking' });
  }
});

// ---------------------------------------------------------------------------
// Tie-breaker (mirrors dispatch.routes.ts)
// ---------------------------------------------------------------------------

function applyTieBreaker(
  decisions: LoadDecision[],
  preferredStates: string[],
  threshold: number,
): LoadDecision[] {
  if (decisions.length <= 1) return decisions;
  const topScore = decisions[0].score;
  const cutoff   = topScore * (1 - threshold);
  const inTie    = decisions.filter((d) => d.score >= cutoff);
  const outOfTie = decisions.filter((d) => d.score < cutoff);
  inTie.sort((a, b) => tieBreakerScore(b, preferredStates) - tieBreakerScore(a, preferredStates));
  return [...inTie, ...outOfTie];
}

function tieBreakerScore(d: LoadDecision, preferredStates: string[]): number {
  let score = 0;
  const stops = d.load.numberOfStops ?? 1;
  if (stops === 1) score += 25;
  else score += Math.max(0, 25 - (stops - 1) * 10);
  const totalMiles    = d.metrics.loadMiles + d.metrics.deadheadMiles;
  const deadheadRatio = totalMiles > 0 ? d.metrics.deadheadMiles / totalMiles : 0;
  score += Math.round((1 - Math.min(1, deadheadRatio / 0.3)) * 25);
  const dest = d.load.destination.state.toUpperCase();
  if (preferredStates.map((s) => s.toUpperCase()).includes(dest)) score += 25;
  const daysLeft = d.metrics.daysRemainingAfterLoad ?? 0;
  score += Math.min(25, Math.round(daysLeft * 5));
  return score;
}

// ---------------------------------------------------------------------------
// Confidence score (mirrors dispatch.routes.ts)
// ---------------------------------------------------------------------------

function computeConfidence(d: LoadDecision, costModel: CostModel): number {
  const rpmRange      = costModel.targetRPMFloor - costModel.survivalRPMFloor;
  const rpmCushion    = rpmRange > 0 ? Math.min(1, Math.max(0, (d.metrics.effectiveRPM - costModel.survivalRPMFloor) / rpmRange)) : 0.5;
  const projDepth     = Math.min(1, 0.4 + (d.metrics.continuationLoadsProjected * 0.2));
  const timingScore   = Math.min(1, Math.max(0, (d.metrics.daysRemainingAfterLoad ?? 0) / 5));
  const totalMiles    = d.metrics.loadMiles + d.metrics.deadheadMiles;
  const deadheadRatio = totalMiles > 0 ? d.metrics.deadheadMiles / totalMiles : 0;
  const deadheadScore = Math.max(0, 1 - deadheadRatio / 0.3);
  const raw = (rpmCushion * 0.35) + (projDepth * 0.35) + (timingScore * 0.15) + (deadheadScore * 0.15);
  return Math.round(Math.min(0.95, Math.max(0.20, raw)) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Reasons builder (mirrors dispatch.routes.ts)
// ---------------------------------------------------------------------------

function buildReasons(
  d: LoadDecision,
  costModel: CostModel,
  avgCycleProfit: number,
  preferredStates: string[],
): string[] {
  const reasons: string[] = [];
  const profitDelta = d.rawCycleProfit - avgCycleProfit;
  const profitSign  = profitDelta >= 0 ? '+' : '-';
  reasons.push(`Projected cycle profit $${fmt(d.rawCycleProfit)} (pool avg $${fmt(avgCycleProfit)}, ${profitSign}$${fmt(Math.abs(profitDelta))})`);
  const rpmStatus = d.metrics.effectiveRPM >= costModel.targetRPMFloor ? 'above target'
    : d.metrics.effectiveRPM >= costModel.survivalRPMFloor ? 'below target, above survival floor'
    : 'below survival floor';
  reasons.push(`Effective RPM $${d.metrics.effectiveRPM.toFixed(2)} (target $${costModel.targetRPMFloor.toFixed(2)}, floor $${costModel.survivalRPMFloor.toFixed(2)}) — ${rpmStatus}`);
  const totalMiles  = d.metrics.loadMiles + d.metrics.deadheadMiles;
  const deadheadPct = totalMiles > 0 ? ((d.metrics.deadheadMiles / totalMiles) * 100).toFixed(0) : '0';
  reasons.push(`${d.metrics.deadheadMiles.toFixed(0)}mi deadhead to pickup (${deadheadPct}% of total ${totalMiles.toFixed(0)}mi)`);
  reasons.push(`${d.metrics.continuationLoadsProjected} continuation load(s) projected from destination market`);
  reasons.push(`${(d.metrics.daysRemainingAfterLoad ?? 0).toFixed(1)} days remaining in cycle after delivery`);
  const dest = d.load.destination.state.toUpperCase();
  if (preferredStates.map((s) => s.toUpperCase()).includes(dest)) reasons.push(`Delivers into preferred market (${dest})`);
  for (const p of d.penalties) {
    if (p.penaltyAmount > 0)      reasons.push(`Penalty: ${p.description} (-$${fmt(p.penaltyAmount)})`);
    else if (p.penaltyAmount < 0) reasons.push(`Bonus: ${p.description} (+$${fmt(Math.abs(p.penaltyAmount))})`);
  }
  for (const w of d.warnings ?? []) reasons.push(`Note: ${w}`);
  return reasons;
}

// ---------------------------------------------------------------------------
// Serializers
// ---------------------------------------------------------------------------

function laneStr(d: LoadDecision): string {
  return `${d.load.origin.city}, ${d.load.origin.state} → ${d.load.destination.city}, ${d.load.destination.state}`;
}

function serializeRanked(
  d: LoadDecision,
  costModel: CostModel,
  avgCycleProfit: number,
  preferredStates: string[],
) {
  return {
    externalId:    d.load.id,
    lane:          laneStr(d),
    rate:          d.load.rate,
    loadMiles:     d.metrics.loadMiles,
    deadheadMiles: d.metrics.deadheadMiles,
    effectiveRPM:  parseFloat(d.metrics.effectiveRPM.toFixed(3)),
    score:         Math.round(d.score),
    status:        d.status,
    rank:          d.rank,
    confidence:    computeConfidence(d, costModel),
    tieBreaker:    tieBreakerScore(d, preferredStates),
    reasons:       buildReasons(d, costModel, avgCycleProfit, preferredStates),
  };
}

function serializeRejected(d: LoadDecision) {
  return {
    externalId: d.load.id,
    lane:       laneStr(d),
    violations: d.violations.map((v) => ({ code: v.code, message: v.message })),
  };
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export default router;
