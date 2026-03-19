/**
 * decision-engine.ts
 *
 * Scores and ranks candidate loads after constraint filtering.
 *
 * Pipeline:
 *   1. Compute load metrics (deadhead, RPM, transit days)
 *   2. Run constraint checks → reject failures
 *   3. Project cycle profit → base score
 *   4. Apply scoring adjustments (penalties / bonuses)
 *   5. Rank by adjusted score → RECOMMENDED / VIABLE / MARGINAL
 *
 * Pure functions. No I/O. All state injected.
 */

import type {
  Load,
  Driver,
  DriverCycleState,
  ActiveLoadExecution,
  ConstraintViolation,
  ConstraintViolationCode,
} from '../../types/constraint.types';
import { calculateLoadMetrics, getAvgDailyMiles, type LoadMetrics } from './load-metrics';
import { projectCycleProfit, type CostModel, type CycleProfitOptions } from './cycle-profit';
import { checkConstraints, type ConstraintConfig } from './constraint-engine';
import {
  projectMarket,
  type MarketProjectionConfig,
  type MarketDataProvider,
} from './market-projection';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PenaltyConfig {
  /** Penalty per $1 RPM below costModel.targetRPMFloor */
  belowTargetRPMPenaltyPerDollar: number;
  /** Flat penalty when deadhead ratio exceeds highDeadheadRatioThreshold */
  highDeadheadRatioPenalty: number;
  /** Ratio threshold (deadheadMiles / totalMiles) that triggers the penalty */
  highDeadheadRatioThreshold: number;
  /** Flat penalty when cycleState.isInFinalCycleWindow is true */
  shortCycleWindowPenalty: number;
  /** Flat penalty when destination market loadAvailabilityIndex is low (< 0.65) */
  lowMarketAvailabilityPenalty: number;
  /** Penalty per extra stop beyond 1 */
  multiStopPenaltyPerStop: number;
  /** Bonus when destination is in driver.preferredStates */
  preferredStateBonusAmount: number;
}

export interface DecisionEngineConfig {
  constraint: ConstraintConfig;
  cycleProfit: CycleProfitOptions;
  market: MarketProjectionConfig;
  penalties: PenaltyConfig;
  /** Score threshold for RECOMMENDED status */
  recommendedProfitThreshold: number;
  /** Score threshold for VIABLE status */
  viableProfitThreshold: number;
  marketProvider: MarketDataProvider;
}

export interface ScoringAdjustment {
  type: string;
  /** Positive = penalty (subtracted), negative = bonus (added) */
  penaltyAmount: number;
  description: string;
}

export type LoadDecisionStatus = 'RECOMMENDED' | 'VIABLE' | 'MARGINAL' | 'REJECTED';

export interface LoadDecision {
  load: Load;
  status: LoadDecisionStatus;
  violations: ConstraintViolation[];
  primaryViolationCode?: ConstraintViolationCode;
  rank?: number;
  score: number;
  metrics: LoadMetrics;
  rawCycleProfit: number;
  penalties: ScoringAdjustment[];
  warnings: string[];
}

export interface RankLoadsResult {
  summary: {
    total: number;
    passed: number;
    rejected: number;
    /** Average cycle profit across passing (non-rejected) loads */
    averagePassingCycleProfit: number;
  };
  decisions: LoadDecision[];
  topRecommendation?: LoadDecision;
}

/** Alias exported for service-layer consumers */
export type RankLoadsOutput = RankLoadsResult;

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

export function rankLoads(input: {
  loads: Load[];
  driver: Driver;
  cycleState: DriverCycleState;
  costModel: CostModel;
  config: DecisionEngineConfig;
  carrierId: string;
  nowMs: number;
  activeLoad?: ActiveLoadExecution;
}): RankLoadsResult {
  const { loads, driver, cycleState, costModel, config, nowMs, activeLoad } = input;

  const avgDailyMiles = getAvgDailyMiles(driver.avgDailyMiles, config.cycleProfit.avgDailyMiles);
  const currentDate = new Date(nowMs);

  const decisions: LoadDecision[] = loads.map((load) => {
    // Step 1: compute metrics
    const metrics = calculateLoadMetrics(load, driver.currentLocation, avgDailyMiles, currentDate);

    // Step 2: constraint check
    const constraintResult = checkConstraints(
      load,
      metrics,
      driver,
      cycleState,
      costModel,
      config.constraint,
      false,
      activeLoad,
      nowMs,
    );

    if (!constraintResult.passed) {
      return {
        load,
        status: 'REJECTED' as LoadDecisionStatus,
        violations: constraintResult.violations,
        primaryViolationCode: constraintResult.primaryViolationCode,
        rank: undefined,
        score: 0,
        metrics,
        rawCycleProfit: 0,
        penalties: [],
        warnings: [],
      };
    }

    // Step 3: cycle profit projection
    const cycleProfitResult = projectCycleProfit(
      load,
      metrics,
      driver,
      cycleState,
      costModel,
      config.cycleProfit,
      activeLoad,
      nowMs,
    );

    const rawCycleProfit = cycleProfitResult.totalCycleProfit;

    // Enrich metrics with cycle-level data for dispatcher display
    metrics.continuationLoadsProjected = cycleProfitResult.continuationLoadsProjected;
    metrics.daysRemainingAfterLoad = cycleProfitResult.daysRemainingInCycle;

    // Step 4: scoring adjustments
    const penalties: ScoringAdjustment[] = [];

    // Below target RPM penalty
    if (metrics.effectiveRPM < costModel.targetRPMFloor) {
      const rpmDeficit = costModel.targetRPMFloor - metrics.effectiveRPM;
      const penaltyAmount = rpmDeficit * config.penalties.belowTargetRPMPenaltyPerDollar;
      penalties.push({ type: 'BELOW_TARGET_RPM', penaltyAmount, description: `RPM $${metrics.effectiveRPM.toFixed(2)} below target $${costModel.targetRPMFloor.toFixed(2)}` });
    }

    // High deadhead ratio penalty
    const deadheadRatio = metrics.totalMiles > 0 ? metrics.deadheadMiles / metrics.totalMiles : 0;
    if (deadheadRatio > config.penalties.highDeadheadRatioThreshold) {
      penalties.push({
        type: 'HIGH_DEADHEAD_RATIO',
        penaltyAmount: config.penalties.highDeadheadRatioPenalty,
        description: `Deadhead ratio ${(deadheadRatio * 100).toFixed(0)}% exceeds ${(config.penalties.highDeadheadRatioThreshold * 100).toFixed(0)}% threshold`,
      });
    }

    // Short cycle window penalty
    if (cycleState.isInFinalCycleWindow) {
      penalties.push({
        type: 'SHORT_CYCLE_WINDOW',
        penaltyAmount: config.penalties.shortCycleWindowPenalty,
        description: 'Short cycle window — prefer loads that move toward home',
      });
    }

    // Low market availability penalty at destination
    const destMarket = projectMarket(
      load.destination,
      config.market,
      config.marketProvider,
      nowMs,
    );
    if (destMarket.loadAvailabilityIndex < 0.65) {
      penalties.push({
        type: 'LOW_MARKET_AVAILABILITY',
        penaltyAmount: config.penalties.lowMarketAvailabilityPenalty,
        description: `Low freight availability at ${load.destination.state} (${(destMarket.loadAvailabilityIndex * 100).toFixed(0)}%)`,
      });
    }

    // Multi-stop penalty (extra stops beyond 1)
    if (load.numberOfStops && load.numberOfStops > 1) {
      const extraStops = load.numberOfStops - 1;
      penalties.push({
        type: 'MULTI_STOP',
        penaltyAmount: extraStops * config.penalties.multiStopPenaltyPerStop,
        description: `${load.numberOfStops} stops (extra complexity)`,
      });
    }

    // Preferred state bonus (negative penaltyAmount = bonus)
    if (driver.preferredStates && driver.preferredStates.includes(load.destination.state)) {
      penalties.push({
        type: 'PREFERRED_STATE_BONUS',
        penaltyAmount: -config.penalties.preferredStateBonusAmount,
        description: `Destination ${load.destination.state} is a preferred state`,
      });
    }

    const totalAdjustment = penalties.reduce((sum, p) => sum + p.penaltyAmount, 0);
    const score = rawCycleProfit - totalAdjustment;

    const status: LoadDecisionStatus =
      score >= config.recommendedProfitThreshold
        ? 'RECOMMENDED'
        : score >= config.viableProfitThreshold
        ? 'VIABLE'
        : 'MARGINAL';

    return {
      load,
      status,
      violations: [],
      primaryViolationCode: undefined,
      rank: undefined,
      score,
      metrics,
      rawCycleProfit,
      penalties,
      warnings: cycleProfitResult.warnings,
    };
  });

  // Step 5: rank non-rejected by score descending
  const passed = decisions.filter((d) => d.status !== 'REJECTED');
  const rejected = decisions.filter((d) => d.status === 'REJECTED');

  passed.sort((a, b) => b.score - a.score);
  passed.forEach((d, i) => { d.rank = i + 1; });

  const ranked = [...passed, ...rejected];

  const topRecommendation = passed.length > 0 ? passed[0] : undefined;

  const averagePassingCycleProfit = passed.length > 0
    ? passed.reduce((sum, d) => sum + d.rawCycleProfit, 0) / passed.length
    : 0;

  return {
    summary: {
      total: loads.length,
      passed: passed.length,
      rejected: rejected.length,
      averagePassingCycleProfit,
    },
    decisions: ranked,
    topRecommendation,
  };
}
