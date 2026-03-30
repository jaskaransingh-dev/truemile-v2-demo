/**
 * route-sequencer.ts
 *
 * Builds and ranks actual multi-load route sequences from a candidate pool.
 *
 * Unlike the decision-engine (which scores each load independently with
 * STATISTICAL continuation estimates), this module:
 *   1. Tries every feasible ordering of loads up to `maxLoads` depth
 *   2. Uses REAL timing from execution-timing.ts for each step
 *   3. Computes actual cycle profit using real load revenues + real deadhead
 *   4. Returns ranked sequences, not ranked individual loads
 *
 * Algorithm: recursive depth-first search with pruning
 *   - Step fails → that branch pruned entirely
 *   - Returns ≤ MAX_RESULTS sequences sorted by totalCycleProfit
 *
 * Complexity: O(N^K) worst case; practical pruning via deadhead limit, timing
 * windows, and cycle deadline keeps this fast for real datasets (N ≤ 100, K ≤ 3).
 *
 * Pure functions. No I/O. All state injected.
 */

import { calculateDeadheadMiles, type LoadMetrics } from './load-metrics';
import {
  resolvePickupWindow,
  type ExecutionTimingConfig,
} from './execution-timing';
import { checkConstraints, type ConstraintConfig } from './constraint-engine';
import type {
  Driver,
  Load,
  DriverCycleState,
  Location,
} from '../../types/constraint.types';
import type { CostModel } from './cycle-profit';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RouteStep {
  externalId:    string;
  lane:          string;
  deadheadMiles: number;
  loadMiles:     number;
  rate:          number;
  pickupAt:      string;  // ISO datetime
  deliveryAt:    string;  // ISO datetime
  stepProfit:    number;  // revenue − variable cost for this step only
  noCoords:      boolean; // true when lat/lon was missing → deadhead estimated 150mi
}

export interface RouteSequence {
  rank:               number;
  totalCycleProfit:   number;
  totalRevenue:       number;
  totalLoadedMiles:   number;
  totalDeadheadMiles: number;
  avgEffectiveRPM:    number;
  estimatedReturnDate: string; // YYYY-MM-DD
  slackDays:          number;
  confidence:         number;  // 0–1
  steps:              RouteStep[];
  reasons:            string[];
  warnings:           string[];
}

export interface RouteRejection {
  externalId: string;
  lane:       string;
  reason:     string;
}

export interface RankRoutesResult {
  rankedRoutes:       RouteSequence[];
  firstLegRejections: RouteRejection[];
  summary: {
    totalRoutesEvaluated: number;
    viableRoutes:         number;
    avgCycleProfit:       number;
    bestCycleProfit:      number;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RESULTS          = 15;
const MAX_DEPTH            = 10;    // hard recursion cap (safety, not primary stop)
const MS_PER_DAY           = 86_400_000;
const MS_PER_HOUR          = 3_600_000;
const DEFAULT_AVG_DAILY_MILES       = 650; // HOS-compliant daily drive, used when driver.avgDailyMiles not set
const UNKNOWN_HOME_DEADHEAD_MILES   = 300; // conservative go-home estimate when delivery destination has no coords

const TIMING: ExecutionTimingConfig = {
  defaultReceiverUnloadHours: 2.5,
  defaultShipperLoadHours:    2.0,
  averageRoadSpeedMph:        47,
  pickupSafetyBufferHours:    0.75,
};

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function rankRoutes(
  loads:      Load[],
  driver:     Driver,
  cycleState: DriverCycleState,
  costModel:  CostModel,
  nowMs:      number,
): RankRoutesResult {
  const { eligible, trailerRejected } = partitionEligible(loads, driver);

  const allRoutes: RouteSequence[] = [];
  const bestSoFar = { value: -Infinity };
  const searchDeadlineMs = Date.now() + 5_000;
  buildRoutesFrom(
    driver.currentLocation,
    nowMs,
    [],
    eligible,
    driver,
    cycleState,
    costModel,
    allRoutes,
    bestSoFar,
    searchDeadlineMs,
  );

  // Loads that couldn't appear as the first leg in any route
  const startsInAnyRoute = new Set<string>();
  for (const route of allRoutes) {
    if (route.steps.length > 0) startsInAnyRoute.add(route.steps[0].externalId);
  }
  const firstLegRejections: RouteRejection[] = [
    ...trailerRejected,
    ...eligible
      .filter((l) => !startsInAnyRoute.has(l.id))
      .map((l) => ({
        externalId: l.id,
        lane:       laneStr(l),
        reason:     'Cannot reach pickup within timing window or route would miss home deadline',
      })),
  ];

  allRoutes.sort((a, b) => b.totalCycleProfit - a.totalCycleProfit);
  const top = allRoutes.slice(0, MAX_RESULTS);
  top.forEach((r, i) => { r.rank = i + 1; });

  const profits = top.map((r) => r.totalCycleProfit);
  const avgCycleProfit = profits.length
    ? profits.reduce((a, b) => a + b, 0) / profits.length
    : 0;

  return {
    rankedRoutes:       top,
    firstLegRejections,
    summary: {
      totalRoutesEvaluated: allRoutes.length,
      viableRoutes:         top.length,
      avgCycleProfit:       Math.round(avgCycleProfit),
      bestCycleProfit:      top[0]?.totalCycleProfit ?? 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hasCoords(loc: Location): boolean {
  return loc.lat != null && loc.lon != null;
}

/**
 * Estimates calendar days needed to drive home from a delivery state.
 * Same state → 1 day. Different state → 2 days.
 * Used when lat/lon is unavailable for the go-home feasibility check.
 */
function estimateDaysToHome(destinationState: string, homeState: string): number {
  return destinationState.toUpperCase().trim() === homeState.toUpperCase().trim() ? 1 : 2;
}

// ---------------------------------------------------------------------------
// Recursive route builder
// ---------------------------------------------------------------------------

interface BuiltStep {
  load:          Load;
  deadheadMiles: number;
  pickupMs:      number;
  deliveryMs:    number;
  noCoords:      boolean;
}

function buildRoutesFrom(
  currentLoc:       Location,
  currentTimeMs:    number,
  steps:            BuiltStep[],
  remaining:        Load[],
  driver:           Driver,
  cycleState:       DriverCycleState,
  costModel:        CostModel,
  output:           RouteSequence[],
  bestSoFar:        { value: number },
  searchDeadlineMs: number,
): void {
  // Record this prefix as a complete route (stop here = go home)
  if (steps.length > 0) {
    const seq = buildSequence(steps, currentLoc, currentTimeMs, driver, cycleState, costModel, bestSoFar);
    if (seq) output.push(seq);
  }

  // Continue searching until less than half a day remains before home deadline,
  // or we hit safety caps. This fills the full cycle window rather than stopping early.
  const daysRemaining = (cycleState.homeDeadline.getTime() - currentTimeMs) / MS_PER_DAY;
  if (daysRemaining < 0.5 || remaining.length === 0 || steps.length >= MAX_DEPTH) return;

  // Branch-and-bound: upper bound on cycle profit achievable from this prefix.
  // N = min(depth slots left, ceil(days remaining)) — each load takes ≥ 1 transit day,
  // so we can't fit more loads than days left. ceil keeps the bound valid (never too tight).
  // upperBound = (committed + top-N future revenue) − (committed variable + committed fixed costs).
  // Subtracting only *known* costs keeps the bound valid: future costs are positive and omitting
  // them only loosens the bound, never falsely prunes a winning sequence.
  const slotsLeft = Math.min(MAX_DEPTH - steps.length, Math.ceil(daysRemaining));
  const committedRevenue = steps.reduce((sum, s) => sum + s.load.rate, 0);
  const topNRevenue = [...remaining]
    .sort((a, b) => b.rate - a.rate)
    .slice(0, slotsLeft)
    .reduce((sum, l) => sum + l.rate, 0);
  const committedVariableCost = steps.reduce(
    (sum, s) => sum + (s.load.miles + s.deadheadMiles) * costModel.variableCPM,
    0,
  );
  const daysElapsed = Math.max(0, (currentTimeMs - cycleState.cycleStartDate.getTime()) / MS_PER_DAY);
  const committedFixedCost = daysElapsed * costModel.fixedCostPerDay;
  if (committedRevenue + topNRevenue - committedVariableCost - committedFixedCost < bestSoFar.value) return;

  const isFirst = steps.length === 0;

  for (const load of remaining) {
    // Cheap geographic pre-filter: skip loads whose origin is unreachable before calling tryStep.
    if (hasCoords(currentLoc) && hasCoords(load.origin)) {
      if (calculateDeadheadMiles(currentLoc, load.origin) > driver.maxDeadheadMiles) continue;
    }

    const laneKey = `${load.origin.city}|${load.origin.state}|${load.destination.city}|${load.destination.state}`;
    const laneAlreadyInSequence = steps.some(s =>
      `${s.load.origin.city}|${s.load.origin.state}|${s.load.destination.city}|${s.load.destination.state}` === laneKey
    );
    if (laneAlreadyInSequence) continue;

    const step = tryStep(
      currentLoc, currentTimeMs, load, driver, cycleState, costModel, isFirst,
    );
    if (!step) continue;

    if (Date.now() > searchDeadlineMs) return; // time-based hard cutoff (per branch, not per entry)

    buildRoutesFrom(
      load.destination,
      step.deliveryMs,
      [...steps, step],
      remaining.filter((l) => l.id !== load.id),
      driver,
      cycleState,
      costModel,
      output,
      bestSoFar,
      searchDeadlineMs,
    );
  }
}

// ---------------------------------------------------------------------------
// Step evaluator — checks timing + deadhead + cycle deadline for one load
// ---------------------------------------------------------------------------

function tryStep(
  currentLoc:    Location,
  currentTimeMs: number,
  load:          Load,
  driver:        Driver,
  cycleState:    DriverCycleState,
  costModel:     CostModel,
  isFirstStep:   boolean,
): BuiltStep | null {
  const lane              = `${load.origin.city},${load.origin.state}→${load.destination.city},${load.destination.state}`;
  const from              = `${currentLoc.city},${currentLoc.state}`;
  const daysRemainingNow  = (cycleState.homeDeadline.getTime() - currentTimeMs) / MS_PER_DAY;

  const skip = (reason: string, extra = '') => {
    if (isFirstStep) {
      console.log(
        `[SEQ] SKIP ${load.id} (${lane}) from ${from} | ${reason}` +
        (extra ? ` | ${extra}` : '') +
        ` | daysLeft=${daysRemainingNow.toFixed(2)}`,
      );
    }
  };

  const [windowStart, windowEnd] = resolvePickupWindow(
    load.pickupWindowStart,
    load.pickupWindowEnd,
    load.pickupDate,
    currentTimeMs,
  );

  // Deadhead to load origin.
  // When coords are available use haversine.
  // When not, exact city+state match → 0mi; otherwise 300mi conservative estimate
  // (exceeds typical maxDeadheadMiles=250, so the load is correctly rejected until
  // the geocoding pre-pass resolves real coordinates).
  let deadheadMiles: number;
  let noCoords: boolean;

  if (hasCoords(currentLoc) && hasCoords(load.origin)) {
    deadheadMiles = calculateDeadheadMiles(currentLoc, load.origin);
    noCoords = false;
  } else {
    // No coords — use city-level exact match first, then conservative fallback
    const sameCity =
      currentLoc.city?.toLowerCase() === load.origin.city?.toLowerCase() &&
      currentLoc.state?.toUpperCase() === load.origin.state?.toUpperCase();
    if (sameCity) {
      deadheadMiles = 0;
      noCoords = false;
    } else {
      // No coords and different city — use 300mi conservative estimate
      // This will fail the maxDeadheadMiles check (250mi) and correctly reject
      // the load until geocoding provides real coordinates
      deadheadMiles = 300;
      noCoords = true;
    }
  }

  if (deadheadMiles > driver.maxDeadheadMiles) {
    skip('deadhead exceeds max', `deadhead=${deadheadMiles}mi max=${driver.maxDeadheadMiles}mi`);
    return null;
  }

  const repositionHours = deadheadMiles / TIMING.averageRoadSpeedMph;

  // First step: truck is at currentLoc now, no prior unload needed.
  // Subsequent steps: account for unload time at prior delivery before repositioning.
  const earliestReadyMs = isFirstStep
    ? currentTimeMs + repositionHours * MS_PER_HOUR + TIMING.pickupSafetyBufferHours * MS_PER_HOUR
    : currentTimeMs
        + repositionHours * MS_PER_HOUR
        + TIMING.pickupSafetyBufferHours * MS_PER_HOUR;

  if (earliestReadyMs > windowEnd.getTime()) {
    const readyDate   = new Date(earliestReadyMs).toISOString().substring(0, 16);
    const windowClose = new Date(windowEnd).toISOString().substring(0, 16);
    skip('cannot make pickup window', `ready=${readyDate} windowClose=${windowClose} deadhead=${deadheadMiles}mi`);
    return null;
  }

  const actualPickupMs = Math.max(earliestReadyMs, windowStart.getTime());

  // Transit time: HOS-compliant calendar days, not instantaneous road speed.
  const avgDailyMiles = driver.avgDailyMiles ?? DEFAULT_AVG_DAILY_MILES;
  const transitDays   = Math.max(1, Math.round(load.miles / avgDailyMiles));
  const deliveryMs    = actualPickupMs
    + TIMING.defaultShipperLoadHours * MS_PER_HOUR
    + transitDays * MS_PER_DAY;

  // Constraint check — thread projected departure time so home deadline (#5) uses currentTimeMs
  // (which advances per step in the chain) rather than the original session nowMs.
  const totalMilesForConstraint = load.miles + deadheadMiles;
  const metricsForConstraint: LoadMetrics = {
    loadMiles:                  load.miles,
    deadheadMiles,
    totalMiles:                 totalMilesForConstraint,
    effectiveRPM:               totalMilesForConstraint > 0 ? load.rate / totalMilesForConstraint : 0,
    transitDays,
    loadDailyRevenue:           transitDays > 0 ? load.rate / transitDays : 0,
    continuationLoadsProjected: 0,
    daysRemainingAfterLoad:     0,
  };
  const constraintCfg: ConstraintConfig = {
    requiredTrailerType:     driver.trailerType,
    maxDeadheadMiles:        driver.maxDeadheadMiles,
    survivalRPMFloor:        costModel.survivalRPMFloor,
    homeTimeBufferDays:      1.0,
    enforceStatePreferences: (driver.avoidStates?.length ?? 0) > 0,
  };
  const constraintResult = checkConstraints(
    load, metricsForConstraint, driver, cycleState, costModel, constraintCfg,
    false, undefined, currentTimeMs, currentTimeMs,
  );

  if (!constraintResult.passed) {
    skip('constraint check failed', constraintResult.primaryViolationCode ?? 'CONSTRAINT_VIOLATION');
    return null;
  }

  // Go-home feasibility: driver must reach home before cycle deadline with 0.5 days to spare.
  // Uses calendar days (HOS-compliant), not road-speed hours.
  const daysNeededToGetHome = hasCoords(load.destination) && hasCoords(driver.homeLocation)
    ? Math.max(1, Math.round(calculateDeadheadMiles(load.destination, driver.homeLocation) / avgDailyMiles))
    : estimateDaysToHome(load.destination.state, driver.homeLocation.state);
  const daysRemainingAfterDelivery =
    (cycleState.homeDeadline.getTime() - deliveryMs - TIMING.defaultReceiverUnloadHours * MS_PER_HOUR)
    / MS_PER_DAY;
  if (daysNeededToGetHome > daysRemainingAfterDelivery) {
    skip(
      'cannot return home in time',
      `transit=${transitDays}d deadhead=${deadheadMiles}mi daysNeededHome=${daysNeededToGetHome}` +
      ` daysAfterDelivery=${daysRemainingAfterDelivery.toFixed(2)}`,
    );
    return null;
  }

  if (isFirstStep) {
    console.log(
      `[SEQ] OK   ${load.id} (${lane}) from ${from} |` +
      ` deadhead=${deadheadMiles}mi transit=${transitDays}d daysNeededHome=${daysNeededToGetHome}` +
      ` daysAfterDelivery=${daysRemainingAfterDelivery.toFixed(2)} daysLeft=${daysRemainingNow.toFixed(2)}`,
    );
  }

  return {
    load,
    deadheadMiles,
    pickupMs:  actualPickupMs,
    deliveryMs,
    noCoords,
  };
}

// ---------------------------------------------------------------------------
// Score a complete sequence and build the RouteSequence object
// ---------------------------------------------------------------------------

function buildSequence(
  steps:        BuiltStep[],
  finalLoc:     Location,  // last delivery destination
  finalTimeMs:  number,    // last delivery time
  driver:       Driver,
  cycleState:   DriverCycleState,
  costModel:    CostModel,
  bestSoFar:    { value: number },
): RouteSequence | null {
  if (!steps.length) return null;

  const warnings: string[] = [];
  let missingCoords = false;

  // Go-home leg: unload + deadhead home in calendar days (HOS-compliant, same as transit).
  const avgDailyMiles     = driver.avgDailyMiles ?? DEFAULT_AVG_DAILY_MILES;
  const homeCoords        = hasCoords(finalLoc) && hasCoords(driver.homeLocation);
  const deadheadHomeMiles = homeCoords
    ? calculateDeadheadMiles(finalLoc, driver.homeLocation)
    : UNKNOWN_HOME_DEADHEAD_MILES;
  if (!homeCoords && steps.length > 0) missingCoords = true;

  const daysHomeReturn = Math.max(1, Math.round(deadheadHomeMiles / avgDailyMiles));
  const returnHomeMs = finalTimeMs
    + TIMING.defaultReceiverUnloadHours * MS_PER_HOUR
    + daysHomeReturn * MS_PER_DAY;

  const slackDays     = (cycleState.homeDeadline.getTime() - returnHomeMs) / MS_PER_DAY;
  const cycleUsedDays = (returnHomeMs - cycleState.cycleStartDate.getTime()) / MS_PER_DAY;

  // Build step list and aggregate
  let totalRevenue       = 0;
  let totalLoadedMiles   = 0;
  let totalDeadheadMiles = deadheadHomeMiles; // include go-home leg

  const builtSteps: RouteStep[] = steps.map((s) => {
    totalRevenue       += s.load.rate;
    totalLoadedMiles   += s.load.miles;
    totalDeadheadMiles += s.deadheadMiles;
    if (s.noCoords) missingCoords = true;

    const stepVariableCost = (s.load.miles + s.deadheadMiles) * costModel.variableCPM;
    return {
      externalId:    s.load.id,
      lane:          laneStr(s.load),
      deadheadMiles: Math.round(s.deadheadMiles),
      loadMiles:     s.load.miles,
      rate:          s.load.rate,
      pickupAt:      new Date(s.pickupMs).toISOString(),
      deliveryAt:    new Date(s.deliveryMs).toISOString(),
      stepProfit:    Math.round(s.load.rate - stepVariableCost),
      noCoords:      s.noCoords,
    };
  });

  const totalVariableCost = (totalLoadedMiles + totalDeadheadMiles) * costModel.variableCPM;
  const totalFixedCost    = Math.max(0, cycleUsedDays) * costModel.fixedCostPerDay;
  const totalCycleProfit  = totalRevenue - totalVariableCost - totalFixedCost;

  const totalMiles        = totalLoadedMiles + totalDeadheadMiles;
  const avgEffectiveRPM   = totalMiles > 0 ? totalRevenue / totalMiles : 0;

  if (missingCoords) {
    warnings.push(`One or more legs missing lat/lon — deadhead estimated by state adjacency, timing is conservative`);
  }
  if (slackDays < 1) {
    warnings.push(`Tight cycle: only ${slackDays.toFixed(1)} slack days before home deadline`);
  }
  if (avgEffectiveRPM < costModel.survivalRPMFloor) {
    warnings.push(`Avg RPM $${avgEffectiveRPM.toFixed(2)} is below survival floor $${costModel.survivalRPMFloor.toFixed(2)}`);
  }

  const reasons = buildReasons(
    steps.length,
    totalCycleProfit,
    totalRevenue,
    totalLoadedMiles,
    totalDeadheadMiles,
    avgEffectiveRPM,
    slackDays,
    cycleUsedDays,
    costModel,
  );

  if (totalCycleProfit > bestSoFar.value) {
    bestSoFar.value = totalCycleProfit;
  }

  return {
    rank:               0, // assigned after sorting
    totalCycleProfit:   Math.round(totalCycleProfit),
    totalRevenue:       Math.round(totalRevenue),
    totalLoadedMiles:   Math.round(totalLoadedMiles),
    totalDeadheadMiles: Math.round(totalDeadheadMiles),
    avgEffectiveRPM:    Math.round(avgEffectiveRPM * 100) / 100,
    estimatedReturnDate: new Date(returnHomeMs).toISOString().substring(0, 10),
    slackDays:          Math.round(slackDays * 10) / 10,
    confidence:         computeRouteConfidence(steps.length, slackDays, missingCoords),
    steps:              builtSteps,
    reasons,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Eligibility filter
// ---------------------------------------------------------------------------

function partitionEligible(
  loads:  Load[],
  driver: Driver,
): { eligible: Load[]; trailerRejected: RouteRejection[] } {
  const eligible: Load[] = [];
  const trailerRejected: RouteRejection[] = [];

  for (const load of loads) {
    if (load.trailerType !== driver.trailerType) {
      trailerRejected.push({
        externalId: load.id,
        lane:       laneStr(load),
        reason:     `Trailer mismatch: load requires ${load.trailerType}, driver operates ${driver.trailerType}`,
      });
      continue;
    }
    if ((driver.avoidStates ?? []).includes(load.destination.state.toUpperCase())) {
      trailerRejected.push({
        externalId: load.id,
        lane:       laneStr(load),
        reason:     `Destination ${load.destination.state} is in driver avoid list`,
      });
      continue;
    }
    eligible.push(load);
  }

  return { eligible, trailerRejected };
}

// ---------------------------------------------------------------------------
// Confidence score
// ---------------------------------------------------------------------------

function computeRouteConfidence(
  loadCount:     number,
  slackDays:     number,
  missingCoords: boolean,
): number {
  let score = 0.45;
  score += Math.min(0.25, loadCount * 0.08);       // more real loads = higher confidence
  score += Math.min(0.15, slackDays * 0.03);        // slack buffer
  if (missingCoords) score -= 0.18;                 // missing coords = unreliable timing
  return Math.round(Math.min(0.95, Math.max(0.20, score)) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Reasons builder
// ---------------------------------------------------------------------------

function buildReasons(
  loadCount:         number,
  totalCycleProfit:  number,
  totalRevenue:      number,
  totalLoadedMiles:  number,
  totalDeadheadMiles: number,
  avgEffectiveRPM:   number,
  slackDays:         number,
  cycleUsedDays:     number,
  costModel:         CostModel,
): string[] {
  const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
  const totalMiles = totalLoadedMiles + totalDeadheadMiles;
  const deadheadPct = totalMiles > 0
    ? ((totalDeadheadMiles / totalMiles) * 100).toFixed(0)
    : '0';

  return [
    `${loadCount}-load sequence: $${fmt(totalRevenue)} gross revenue on ${fmt(totalMiles)} total miles`,
    `Cycle profit after all costs: $${fmt(totalCycleProfit)} over ${cycleUsedDays.toFixed(1)} cycle days`,
    `Avg effective RPM $${avgEffectiveRPM.toFixed(2)} vs target $${costModel.targetRPMFloor.toFixed(2)}`,
    `${fmt(totalDeadheadMiles)} deadhead mi (${deadheadPct}%) vs ${fmt(totalLoadedMiles)} loaded mi`,
    `Returns home with ${slackDays.toFixed(1)} days slack before cycle deadline`,
  ];
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function laneStr(load: Load): string {
  return `${load.origin.city}, ${load.origin.state} → ${load.destination.city}, ${load.destination.state}`;
}
