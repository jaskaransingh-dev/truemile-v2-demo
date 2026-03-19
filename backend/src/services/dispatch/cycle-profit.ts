/**
 * cycle-profit.ts
 *
 * Projects total cycle profit from a candidate load + continuation loads.
 *
 * Pipeline:
 *   Actual load contribution (known revenue, real metrics)
 *   + Projected continuation loads (market-derived, discounted by uncertainty)
 *   = Total projected cycle profit
 *
 * Continuation loads are projected forward from destination market data.
 * Each continuation load is discounted by projectionDiscountRate to reflect
 * increasing uncertainty over time.
 *
 * Pure functions. No I/O. All state injected.
 */

import type { Load, Driver, DriverCycleState, ActiveLoadExecution } from '../../types/constraint.types';
import type { LoadMetrics } from './load-metrics';
import { projectMarket, type MarketProjectionConfig, type MarketDataProvider } from './market-projection';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Pre-computed cost model for the dispatch engine.
 * Computed from driver's actual operating expenses and injected here.
 * Decoupled from Driver so costs can be updated without changing the driver record.
 */
export interface CostModel {
  fixedCPM: number;
  variableCPM: number;
  trueCPM: number;
  /** Fixed cost per calendar day (monthly fixed / 30) */
  fixedCostPerDay: number;
  /** Hard-reject RPM floor: trueCPM / (1 - survivalMargin) */
  survivalRPMFloor: number;
  /** Scoring-penalty RPM floor: trueCPM / (1 - targetMargin) */
  targetRPMFloor: number;
}

export interface CycleProfitOptions {
  avgDailyMiles: number;
  /** Discount factor per projected continuation load (e.g. 0.10 = 10% per load) */
  projectionDiscountRate: number;
  /** Maximum number of continuation loads to project */
  maxContinuationLoads: number;
  marketConfig: MarketProjectionConfig;
  marketProvider: MarketDataProvider;
}

export interface LoadContribution {
  sequence: number;
  isActual: boolean;
  destinationState: string;
  revenue: number;
  variableCost: number;
  totalDrivenMiles: number;
  fixedCostTransit: number;
  transitDays: number;
  dwellCost: number;
  dwellDays: number;
  /** Profit after applying uncertainty discount (actual load = no discount) */
  discountedProfit: number;
  /** Market data confidence: 1.0 for actual load, provider confidence for projected */
  marketConfidence: number;
}

export interface CycleProfitResult {
  totalCycleProfit: number;
  actualLoadProfit: number;
  projectedContinuationProfit: number;
  continuationLoadsProjected: number;
  /** Blended revenue per mile across all contributions (revenue / totalMiles) */
  blendedEffectiveRPM: number;
  /** Total days consumed by all projected loads (transit + dwell) */
  totalDaysConsumed: number;
  /** Days remaining in cycle after all projected loads */
  daysRemainingInCycle: number;
  warnings: string[];
  contributions: LoadContribution[];
}

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

/**
 * Project total cycle profit for a candidate load.
 *
 * @param load            Candidate load being evaluated
 * @param metrics         Pre-computed load metrics (deadhead, RPM, transit days)
 * @param driver          Driver record
 * @param cycleState      Current cycle state with homeDeadline
 * @param costModel       Pre-computed cost model
 * @param options         Projection configuration
 * @param activeLoad      Currently executing load (unused in projection, reserved)
 * @param nowMs           Current time in milliseconds (injectable for testing)
 */
export function projectCycleProfit(
  load: Load,
  metrics: LoadMetrics,
  driver: Driver,
  cycleState: DriverCycleState,
  costModel: CostModel,
  options: CycleProfitOptions,
  activeLoad?: ActiveLoadExecution,
  nowMs: number = Date.now(),
): CycleProfitResult {
  const warnings: string[] = [];
  const contributions: LoadContribution[] = [];

  const cycleTotalDays = (cycleState.homeDeadline.getTime() - nowMs) / MS_PER_DAY;
  if (cycleTotalDays <= 0) {
    warnings.push('homeDeadline is in the past — cycle profit projection unreliable');
  }

  let daysConsumed = 0;
  let totalRevenue = 0;
  let totalMilesAll = 0;

  // ── Sequence 1: Actual load ──────────────────────────────────────────────

  const destMarket1 = projectMarket(
    load.destination,
    options.marketConfig,
    options.marketProvider,
    nowMs,
  );

  const actualTransitDays = metrics.transitDays;
  const actualDwellDays = destMarket1.projectedDwellDays;
  const actualVariableCost = metrics.totalMiles * costModel.variableCPM;
  const actualFixedCostTransit = actualTransitDays * costModel.fixedCostPerDay;
  const actualDwellCost = actualDwellDays * costModel.fixedCostPerDay;
  const actualRawProfit = load.rate - actualVariableCost - actualFixedCostTransit - actualDwellCost;

  contributions.push({
    sequence: 1,
    isActual: true,
    destinationState: load.destination.state,
    revenue: load.rate,
    variableCost: actualVariableCost,
    totalDrivenMiles: metrics.totalMiles,
    fixedCostTransit: actualFixedCostTransit,
    transitDays: actualTransitDays,
    dwellCost: actualDwellCost,
    dwellDays: actualDwellDays,
    discountedProfit: actualRawProfit,
    marketConfidence: 1.0,
  });

  daysConsumed += actualTransitDays + actualDwellDays;
  totalRevenue += load.rate;
  totalMilesAll += metrics.totalMiles;

  // ── Sequences 2–N: Projected continuation loads ──────────────────────────

  let currentState = load.destination.state;

  for (let i = 0; i < options.maxContinuationLoads; i++) {
    const remainingDays = cycleTotalDays - daysConsumed;

    const market = projectMarket(
      { city: '', state: currentState },
      options.marketConfig,
      options.marketProvider,
      nowMs,
    );

    const contTransitDays = market.projectedNextLoadMiles / options.avgDailyMiles;
    const contDwellDays = market.projectedDwellDays;
    const contTotalDays = contTransitDays + contDwellDays;

    // Stop if next load would push us past the home deadline
    if (daysConsumed + contTotalDays > cycleTotalDays) {
      warnings.push(`Continuation load ${i + 2} would exceed home deadline — stopping at ${i + 1} continuation load(s)`);
      break;
    }

    const contTotalMiles = market.projectedNextLoadMiles + market.projectedNextDeadheadMiles;
    const contRevenue = market.projectedNextLoadMiles * market.projectedNextRPM;
    const contVariableCost = contTotalMiles * costModel.variableCPM;
    const contFixedCostTransit = contTransitDays * costModel.fixedCostPerDay;
    const contDwellCost = contDwellDays * costModel.fixedCostPerDay;
    const contRawProfit = contRevenue - contVariableCost - contFixedCostTransit - contDwellCost;

    // Apply compounding discount: (1 - rate)^sequence_in_continuation
    const discountFactor = Math.pow(1 - options.projectionDiscountRate, i + 1);
    const discountedProfit = contRawProfit * discountFactor;

    contributions.push({
      sequence: i + 2,
      isActual: false,
      destinationState: currentState,
      revenue: contRevenue,
      variableCost: contVariableCost,
      totalDrivenMiles: contTotalMiles,
      fixedCostTransit: contFixedCostTransit,
      transitDays: contTransitDays,
      dwellCost: contDwellCost,
      dwellDays: contDwellDays,
      discountedProfit,
      marketConfidence: market.confidenceScore,
    });

    daysConsumed += contTotalDays;
    totalRevenue += contRevenue;
    totalMilesAll += contTotalMiles;

    // Keep projecting from same market (MVP: no lane-routing logic)
    currentState = currentState;
  }

  // ── Aggregate ─────────────────────────────────────────────────────────────

  const actualLoadProfit = contributions[0].discountedProfit;
  const projectedContinuationProfit = contributions
    .slice(1)
    .reduce((sum, c) => sum + c.discountedProfit, 0);
  const totalCycleProfit = actualLoadProfit + projectedContinuationProfit;
  const continuationLoadsProjected = contributions.length - 1;

  const blendedEffectiveRPM = totalMilesAll > 0 ? totalRevenue / totalMilesAll : 0;
  const daysRemainingInCycle = Math.max(0, cycleTotalDays - daysConsumed);

  return {
    totalCycleProfit,
    actualLoadProfit,
    projectedContinuationProfit,
    continuationLoadsProjected,
    blendedEffectiveRPM,
    totalDaysConsumed: daysConsumed,
    daysRemainingInCycle,
    warnings,
    contributions,
  };
}
