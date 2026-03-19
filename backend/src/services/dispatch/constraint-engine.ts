/**
 * constraint-engine.ts
 *
 * Hard constraint checks for the dispatch engine.
 * A load fails if ANY constraint is violated — all violations are collected
 * but the first by priority order becomes primaryViolationCode.
 *
 * Check order (priority):
 *   1. TRAILER_TYPE_MISMATCH    — wrong equipment
 *   2. DEADHEAD_EXCEEDS_LIMIT   — too far to pickup
 *   3. BELOW_SURVIVAL_RPM       — losing money
 *   4. RATE_BELOW_MINIMUM       — absolute floor
 *   5. HOME_TIME_DEADLINE       — can't get home in time
 *   6. STATE_PREFERENCE_VIOLATION — driver avoids this state
 *   7. EMPTY_TIME_WINDOW_VIOLATION — can't make pickup window (timing check)
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
import type { LoadMetrics } from './load-metrics';
import type { CostModel } from './cycle-profit';
import type { ExecutionTimingConfig } from './execution-timing';
import {
  computeExecutionTiming,
  computeFirstLoadTiming,
  resolvePickupWindow,
} from './execution-timing';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConstraintConfig {
  /** Maximum accepted deadhead miles to load origin */
  maxDeadheadMiles: number;
  /** Hard-reject RPM floor (absolute minimum before truck loses money) */
  survivalRPMFloor: number;
  /** Days of buffer added to transit when checking home time feasibility */
  homeTimeBufferDays: number;
  /** Required trailer type — load must match */
  requiredTrailerType: 'DRY' | 'REEFER';
  /** When true, load destination in driver.avoidStates is a hard reject */
  enforceStatePreferences: boolean;
  /** Absolute minimum total rate — rejects token loads. Omit to skip rate floor check. */
  minimumLoadRate?: number;
  /** When provided, execution timing feasibility check is enabled */
  executionTiming?: ExecutionTimingConfig;
}

/** Alias exported for service-layer consumers */
export type ConstraintEngineConfig = ConstraintConfig;

export interface ConstraintResult {
  passed: boolean;
  violations: ConstraintViolation[];
  /** Code of the first (highest-priority) violation, if any */
  primaryViolationCode?: ConstraintViolationCode;
}

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

/**
 * Run all hard constraint checks for a load.
 *
 * @param load          Candidate load
 * @param metrics       Pre-computed load metrics
 * @param driver        Driver record
 * @param cycleState    Current cycle state
 * @param costModel     Pre-computed cost model (used for context, not re-checking RPM)
 * @param config        Constraint configuration
 * @param debug         When true, logs violations to console
 * @param activeLoad    Currently executing load (used for timing check)
 * @param nowMs         Current time ms (injectable for testing)
 */
export function checkConstraints(
  load: Load,
  metrics: LoadMetrics,
  driver: Driver,
  cycleState: DriverCycleState,
  costModel: CostModel,
  config: ConstraintConfig,
  debug: boolean,
  activeLoad?: ActiveLoadExecution,
  nowMs: number = Date.now(),
): ConstraintResult {
  const violations: ConstraintViolation[] = [];

  // 1. Trailer type mismatch
  if (load.trailerType !== config.requiredTrailerType) {
    violations.push({
      code: 'TRAILER_TYPE_MISMATCH',
      message: `Load requires ${load.trailerType} but driver has ${config.requiredTrailerType}`,
      actual: load.trailerType,
      threshold: config.requiredTrailerType,
    });
  }

  // 2. Deadhead exceeds limit
  if (metrics.deadheadMiles > config.maxDeadheadMiles) {
    violations.push({
      code: 'DEADHEAD_EXCEEDS_LIMIT',
      message: `Deadhead ${metrics.deadheadMiles.toFixed(0)}mi exceeds limit of ${config.maxDeadheadMiles}mi`,
      actual: metrics.deadheadMiles,
      threshold: config.maxDeadheadMiles,
    });
  }

  // 3. RPM below survival floor
  if (metrics.effectiveRPM < config.survivalRPMFloor) {
    violations.push({
      code: 'BELOW_SURVIVAL_RPM',
      message: `Effective RPM $${metrics.effectiveRPM.toFixed(3)} is below survival floor $${config.survivalRPMFloor.toFixed(3)}`,
      actual: metrics.effectiveRPM,
      threshold: config.survivalRPMFloor,
    });
  }

  // 4. Rate below minimum (skip if minimumLoadRate not configured)
  if (config.minimumLoadRate !== undefined && load.rate < config.minimumLoadRate) {
    violations.push({
      code: 'RATE_BELOW_MINIMUM',
      message: `Load rate $${load.rate} is below minimum $${config.minimumLoadRate}`,
      actual: load.rate,
      threshold: config.minimumLoadRate,
    });
  }

  // 5. Home time deadline
  const daysRemainingInCycle = (cycleState.homeDeadline.getTime() - nowMs) / MS_PER_DAY;
  const daysToHome = estimateDaysToHome(load.destination.state, cycleState.homeLocation.state);
  const daysNeeded = metrics.transitDays + daysToHome + config.homeTimeBufferDays;

  if (daysNeeded > daysRemainingInCycle) {
    violations.push({
      code: 'HOME_TIME_DEADLINE',
      message: `Load requires ${daysNeeded.toFixed(1)} days (transit + home) but only ${daysRemainingInCycle.toFixed(1)} days remain in cycle`,
      actual: daysNeeded,
      threshold: daysRemainingInCycle,
    });
  }

  // 6. State preference violation (avoidStates)
  if (
    config.enforceStatePreferences &&
    driver.avoidStates &&
    driver.avoidStates.includes(load.destination.state)
  ) {
    violations.push({
      code: 'STATE_PREFERENCE_VIOLATION',
      message: `Destination state ${load.destination.state} is in driver's avoid list`,
      actual: load.destination.state,
    });
  }

  // 7. Execution timing — can the truck physically make the pickup window?
  if (config.executionTiming) {
    const [windowStart, windowEnd] = resolvePickupWindow(
      load.pickupWindowStart,
      load.pickupWindowEnd,
      load.pickupDate,
    );

    const timingResult = activeLoad
      ? computeExecutionTiming(
          activeLoad,
          load.origin,
          windowStart,
          windowEnd,
          config.executionTiming,
          nowMs,
        )
      : computeFirstLoadTiming(
          driver.currentLocation,
          new Date(nowMs),
          load.origin,
          windowStart,
          windowEnd,
          config.executionTiming,
          nowMs,
        );

    if (!timingResult.canMakePickup) {
      const reason = timingResult.invalidReason
        ? timingResult.invalidReason
        : `Earliest arrival ${timingResult.earliestPickupReadyAt.toISOString()} is after window close ${windowEnd.toISOString()} (${Math.abs(timingResult.slackMinutes).toFixed(0)}min late)`;

      violations.push({
        code: 'EMPTY_TIME_WINDOW_VIOLATION',
        message: reason,
        actual: timingResult.earliestPickupReadyAt.toISOString(),
        threshold: windowEnd.toISOString(),
      });
    }
  }

  if (debug && violations.length > 0) {
    console.log(`[constraint-engine] Load ${load.id} violations:`, violations);
  }

  const passed = violations.length === 0;
  const primaryViolationCode = violations[0]?.code;

  return { passed, violations, primaryViolationCode };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * MVP heuristic: days to get home from a given destination.
 * Same state → 1 day, different state → 2 days.
 */
function estimateDaysToHome(destinationState: string, homeState: string): number {
  return destinationState === homeState ? 1 : 2;
}
