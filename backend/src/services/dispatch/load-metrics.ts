import { Load, Location } from '../../types/constraint.types';

const EARTH_RADIUS_MILES = 3959;

// ---------------------------------------------------------------------------
// LoadMetrics — defined here, re-exported for other dispatch modules
// ---------------------------------------------------------------------------

export interface LoadMetrics {
  loadMiles: number;
  deadheadMiles: number;
  totalMiles: number;
  /** rate / totalMiles — deadhead penalizes RPM */
  effectiveRPM: number;
  /** totalMiles / avgDailyMiles */
  transitDays: number;
  /** rate / transitDays */
  loadDailyRevenue: number;
  pickupFeasible?: boolean;
  /** Populated by decision-engine after cycle profit projection */
  continuationLoadsProjected: number;
  /** Days remaining in cycle after this load + all projected continuation loads complete */
  daysRemainingAfterLoad: number;
}

/**
 * Calculate great-circle distance between two points using Haversine formula.
 * Returns distance in miles.
 */
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRadians = (degrees: number) => degrees * (Math.PI / 180);

  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_MILES * c;
}

/**
 * Calculate deadhead miles from driver location to load origin.
 *
 * Returns 0 if either location is missing lat/lon coordinates.
 * This keeps the engine usable while geocoding coverage is incomplete.
 */
export function calculateDeadheadMiles(
  driverLocation: Location,
  loadOrigin: Location
): number {
  if (
    driverLocation.lat == null ||
    driverLocation.lon == null ||
    loadOrigin.lat == null ||
    loadOrigin.lon == null
  ) {
    return 0;
  }

  return calculateDistance(
    driverLocation.lat,
    driverLocation.lon,
    loadOrigin.lat,
    loadOrigin.lon
  );
}

/**
 * Calculate all economic metrics for a load.
 *
 * CRITICAL:
 * - load.rate is TOTAL PAYOUT (not per mile)
 * - effectiveRPM includes deadhead miles (rate / totalMiles)
 * - deadhead calculated from driver's current location to load pickup
 * - missing coordinates → deadhead = 0 (no throw)
 */
export function calculateLoadMetrics(
  load: Load,
  driverLocation: Location,
  avgDailyMiles: number,
  currentDate: Date = new Date()
): LoadMetrics {
  if (avgDailyMiles <= 0) {
    throw new Error('avgDailyMiles must be greater than 0');
  }

  if (load.miles < 0) {
    throw new Error('load.miles cannot be negative');
  }

  if (load.rate < 0) {
    throw new Error('load.rate cannot be negative');
  }

  const deadheadMiles = calculateDeadheadMiles(driverLocation, load.origin);

  const loadMiles = load.miles;
  const totalMiles = deadheadMiles + loadMiles;

  // load.rate is total payout — do NOT multiply by miles
  const loadRevenue = load.rate;

  // Guard against divide-by-zero (e.g. load.miles === 0)
  const effectiveRPM = totalMiles > 0 ? loadRevenue / totalMiles : 0;
  const transitDays = totalMiles > 0 ? totalMiles / avgDailyMiles : 0;
  const loadDailyRevenue = transitDays > 0 ? loadRevenue / transitDays : 0;

  const pickupFeasible = new Date(load.pickupDate) >= currentDate;

  return {
    loadMiles,
    deadheadMiles,
    totalMiles,
    effectiveRPM,
    transitDays,
    loadDailyRevenue,
    pickupFeasible,
    continuationLoadsProjected: 0,
    daysRemainingAfterLoad: 0,
  };
}

/**
 * Helper to get the appropriate avgDailyMiles value.
 * Prefers driver-specific setting, falls back to config default.
 */
export function getAvgDailyMiles(
  driverAvgDailyMiles: number | undefined,
  configDefaultAvgDailyMiles: number
): number {
  const resolvedAvgDailyMiles = driverAvgDailyMiles ?? configDefaultAvgDailyMiles;

  if (resolvedAvgDailyMiles <= 0) {
    throw new Error('avgDailyMiles must be greater than 0');
  }

  return resolvedAvgDailyMiles;
}
