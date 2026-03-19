/**
 * dispatch.routes.ts
 *
 * POST /api/dispatch/rank-loads     — stateless ranking (unchanged behavior)
 * POST /api/dispatch/decision       — record actual dispatcher choice
 *
 * Auth: authenticateToken + tenantScope. carrierId from (req as any).carrierId.
 *
 * Registration in index.ts:
 *   import rankLoadsRouter from './routes/dispatch.routes';
 *   app.use('/api/dispatch', authenticateToken, tenantScope, rankLoadsRouter);
 */

import { Router, type Request, type Response } from 'express';
import { validateRankLoadsBody } from '../validation/dispatch.validation';
import { runDispatchRanking, DriverHomeWindowError, type RankLoadsRequest } from '../services/dispatch.service';
import { logDispatchRun, recordDispatchDecision, getDispatchRun } from '../services/dispatch.logger';
import type { LoadDecision } from '../services/dispatch/decision-engine';
import type { CostModel } from '../services/dispatch/cycle-profit';

const router = Router();

// ---------------------------------------------------------------------------
// POST /rank-loads
// ---------------------------------------------------------------------------

router.post('/rank-loads', async (req: Request, res: Response) => {
  const carrierId = (req as any).carrierId as string | undefined;
  if (!carrierId) {
    return res.status(401).json({ success: false, error: 'Unauthorized: carrierId not found on request' });
  }

  const validationError = validateRankLoadsBody(req.body);
  if (validationError) {
    return res.status(400).json({ success: false, error: validationError });
  }

  const body = req.body as RankLoadsRequest;
  const nowMs = body.now ? Date.parse(body.now) : Date.now();

  try {
    const result = runDispatchRanking(carrierId, body, nowMs);

    const passing  = result.decisions.filter((d) => d.status !== 'REJECTED');
    const rejected = result.decisions.filter((d) => d.status === 'REJECTED');
    const avgCycleProfit = result.summary.averagePassingCycleProfit;
    const ranked = applyTieBreaker(passing, result.preferredStates, 0.05);
    const topId  = ranked[0]?.load.id ?? null;

    const engineOutput = {
      summary:           result.summary,
      topRecommendation: topId,
      decisions: result.decisions.map((d) => {
        const isRejected = d.status === 'REJECTED';
        return {
          externalId:            d.load.id,
          status:                d.status,
          rank:                  d.rank,
          score:                 d.score,
          rawCycleProfit:        d.rawCycleProfit,
          effectiveRPM:          d.metrics.effectiveRPM,
          daysRemainingAfterLoad: d.metrics.daysRemainingAfterLoad,
          violations:            d.violations.map((v) => v.code),
          confidence:            isRejected ? null : computeConfidence(d, result.costModel),
          tieBreakerScore:       isRejected ? null : tieBreakerScore(d, result.preferredStates),
          reasons:               isRejected
            ? d.violations.map((v) => v.message)
            : buildReasons(d, result.costModel, avgCycleProfit, result.preferredStates),
        };
      }),
    };

    const runId = await logDispatchRun(
      carrierId,
      body.driverId,
      body.candidateLoads,
      body.driver,
      engineOutput,
      topId,
    );

    if (!runId) {
      return res.status(500).json({ success: false, error: 'Failed to log dispatch run' });
    }

    return res.status(200).json({
      success:     true,
      carrierId:   result.carrierId,
      processedAt: new Date(result.processedAtMs).toISOString(),
      runId,

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

      rankedLoads:  ranked.map((d) => serializeRanked(d, result.costModel, avgCycleProfit, result.preferredStates)),
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
    console.error('[dispatch/rank-loads] Error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error during dispatch ranking' });
  }
});

// ---------------------------------------------------------------------------
// POST /decision
// Records what the dispatcher actually chose after reviewing engine output.
//
// Body: { runId: string, selectedLoadId: string }
// ---------------------------------------------------------------------------

router.post('/decision', async (req: Request, res: Response) => {
  const carrierId = (req as any).carrierId as string | undefined;
  if (!carrierId) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const { runId, selectedLoadId } = req.body;

  if (!runId || typeof runId !== 'string') {
    return res.status(400).json({ success: false, error: 'runId is required' });
  }
  if (!selectedLoadId || typeof selectedLoadId !== 'string') {
    return res.status(400).json({ success: false, error: 'selectedLoadId is required' });
  }

  // Fetch the run to verify ownership and get topRecommendationId
  // (we don't trust the client to send topRecommendationId — derive it from the stored run)
  const run = await getDispatchRun(runId, carrierId);
  if (!run) {
    return res.status(404).json({ success: false, error: 'Dispatch run not found' });
  }

  const recorded = await recordDispatchDecision(
    runId,
    selectedLoadId,
    run.topRecommendationId,
  );

  if (recorded === 'duplicate') {
    return res.status(409).json({ success: false, error: 'A decision has already been recorded for this dispatch run' });
  }
  if (recorded === 'error') {
    return res.status(500).json({ success: false, error: 'Failed to record decision' });
  }

  return res.status(200).json({
    success:       true,
    dispatchRunId: runId,
    selectedLoadId,
    matchedEngine: selectedLoadId === run.topRecommendationId,
  });
});

// ---------------------------------------------------------------------------
// Tie-breaker
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
// Confidence score
// ---------------------------------------------------------------------------

function computeConfidence(d: LoadDecision, costModel: CostModel): number {
  const rpmRange    = costModel.targetRPMFloor - costModel.survivalRPMFloor;
  const rpmCushion  = rpmRange > 0 ? Math.min(1, Math.max(0, (d.metrics.effectiveRPM - costModel.survivalRPMFloor) / rpmRange)) : 0.5;
  const projDepth   = Math.min(1, 0.4 + (d.metrics.continuationLoadsProjected * 0.2));
  const timingScore = Math.min(1, Math.max(0, (d.metrics.daysRemainingAfterLoad ?? 0) / 5));
  const totalMiles  = d.metrics.loadMiles + d.metrics.deadheadMiles;
  const deadheadRatio  = totalMiles > 0 ? d.metrics.deadheadMiles / totalMiles : 0;
  const deadheadScore  = Math.max(0, 1 - deadheadRatio / 0.3);
  const raw = (rpmCushion * 0.35) + (projDepth * 0.35) + (timingScore * 0.15) + (deadheadScore * 0.15);
  return Math.round(Math.min(0.95, Math.max(0.20, raw)) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Reasons builder
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
  const totalMiles    = d.metrics.loadMiles + d.metrics.deadheadMiles;
  const deadheadPct   = totalMiles > 0 ? ((d.metrics.deadheadMiles / totalMiles) * 100).toFixed(0) : '0';
  reasons.push(`${d.metrics.deadheadMiles.toFixed(0)}mi deadhead to pickup (${deadheadPct}% of total ${totalMiles.toFixed(0)}mi)`);
  reasons.push(`${d.metrics.continuationLoadsProjected} continuation load(s) projected from destination market`);
  reasons.push(`${(d.metrics.daysRemainingAfterLoad ?? 0).toFixed(1)} days remaining in cycle after delivery`);
  const dest = d.load.destination.state.toUpperCase();
  if (preferredStates.map((s) => s.toUpperCase()).includes(dest)) reasons.push(`Delivers into preferred market (${dest})`);
  for (const p of d.penalties) {
    if (p.penaltyAmount > 0) reasons.push(`Penalty: ${p.description} (-$${fmt(p.penaltyAmount)})`);
    else if (p.penaltyAmount < 0) reasons.push(`Bonus: ${p.description} (+$${fmt(Math.abs(p.penaltyAmount))})`);
  }
  for (const w of d.warnings ?? []) reasons.push(`Note: ${w}`);
  return reasons;
}

// ---------------------------------------------------------------------------
// Serializers
// ---------------------------------------------------------------------------

function laneStr(d: LoadDecision): string {
  const o    = d.load.origin;
  const dest = d.load.destination;
  return `${o.city}, ${o.state} → ${dest.city}, ${dest.state}`;
}

function serializeRanked(d: LoadDecision, costModel: CostModel, avgCycleProfit: number, preferredStates: string[]) {
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
