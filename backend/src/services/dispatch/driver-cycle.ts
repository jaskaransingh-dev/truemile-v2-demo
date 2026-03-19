import { Driver, DriverCycleState, Load, Location } from '../../types/constraint.types';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Truncate a Date to the start of its UTC calendar day.
 * Used to make day-level comparisons explicit and timezone-safe.
 */
function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Calculate the driver's current position in their work cycle.
 *
 * Determines:
 * - how many days have elapsed in the current on-road cycle
 * - how many days remain before the driver must be home
 * - whether the driver is currently OTR or at home
 * - whether the driver is in the final cycle window
 */
export function getDriverCycleState(
  driver: Driver,
  currentDate: Date = new Date()
): DriverCycleState {
  const cycleStartDate = new Date(driver.cycleStartDate);

  if (Number.isNaN(cycleStartDate.getTime())) {
    throw new Error('driver.cycleStartDate must be a valid date');
  }

  if (driver.cycleDays <= 0) {
    throw new Error('driver.cycleDays must be greater than 0');
  }

  if (driver.daysOff < 0) {
    throw new Error('driver.daysOff cannot be negative');
  }

  if (currentDate.getTime() < cycleStartDate.getTime()) {
    throw new Error('currentDate cannot be before cycleStartDate');
  }

  const cycleDuration = driver.cycleDays + driver.daysOff;

  if (cycleDuration <= 0) {
    throw new Error('cycle duration must be greater than 0');
  }

  const daysSinceCycleStart = Math.floor(
    (currentDate.getTime() - cycleStartDate.getTime()) / MS_PER_DAY
  );

  const cyclePosition = daysSinceCycleStart % cycleDuration;
  const isOTR = cyclePosition < driver.cycleDays;

  const daysElapsed = isOTR ? cyclePosition : driver.cycleDays;
  const daysRemaining = isOTR ? driver.cycleDays - cyclePosition : 0;

  // Anchor the home deadline to the START of the current active cycle block,
  // not the original cycleStartDate. Without this, deadlines drift across
  // repeated cycles.
  const completedCycles = Math.floor(daysSinceCycleStart / cycleDuration);
  const currentCycleAnchor = new Date(cycleStartDate);
  currentCycleAnchor.setUTCDate(
    currentCycleAnchor.getUTCDate() + completedCycles * cycleDuration
  );

  const homeDeadline = new Date(currentCycleAnchor);
  homeDeadline.setUTCDate(homeDeadline.getUTCDate() + driver.cycleDays);

  const isInFinalCycleWindow = isOTR && daysRemaining <= 3;

  return {
    cycleStartDate,
    cycleDays: driver.cycleDays,
    daysOff: driver.daysOff,
    daysElapsed,
    daysRemaining,
    homeDeadline,
    currentLocation: driver.currentLocation,
    homeLocation: driver.homeLocation,
    isOTR,
    isInFinalCycleWindow,
  };
}

/**
 * Estimate days required for the driver to get home from a destination.
 *
 * MVP heuristic:
 * - same state => 1 day
 * - different state => 2 days
 */
export function estimateDaysToHome(
  destination: Location,
  homeLocation: Location
): number {
  return destination.state === homeLocation.state ? 1 : 2;
}

/**
 * Check whether taking a load would cause the driver to miss home time.
 *
 * Uses day-level (UTC) comparison for MVP determinism:
 * - arriving home ON the deadline day is allowed
 * - arriving home AFTER the deadline day is a violation
 *
 * Transit days from "now" are used rather than load.deliveryDate to avoid
 * mixing booked dates with projected transit time.
 */
export function wouldViolateHomeTime(
  load: Load,
  cycleState: DriverCycleState,
  loadTransitDays: number,
  currentDate: Date = new Date()
): boolean {
  const projectedCompletionDate = new Date(currentDate);
  projectedCompletionDate.setUTCDate(
    projectedCompletionDate.getUTCDate() + Math.ceil(loadTransitDays)
  );

  const daysToHome = estimateDaysToHome(
    load.destination,
    cycleState.homeLocation
  );

  const projectedArrivalHomeDate = new Date(projectedCompletionDate);
  projectedArrivalHomeDate.setUTCDate(
    projectedArrivalHomeDate.getUTCDate() + daysToHome
  );

  // Day-level comparison: arriving on the deadline day is not a violation
  return startOfUtcDay(projectedArrivalHomeDate) > startOfUtcDay(cycleState.homeDeadline);
}

/**
 * Check if the driver is in the final window of their cycle.
 */
export function isInFinalCycleWindow(cycleState: DriverCycleState): boolean {
  return cycleState.isOTR && cycleState.daysRemaining <= 3;
}
