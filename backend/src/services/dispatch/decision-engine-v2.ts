/**
 * decision-engine-v2.ts
 *
 * Single-load ranking engine for pre-filtered candidate loads.
 * Inputs are assumed to have already passed the 7 hard constraint filters
 * (trailer type, deadhead, RPM floor, timing window, state avoidance, etc.).
 *
 * Hard gates (load is rejected before scoring if any fail):
 *   - BELOW_MIN_RPM       effectiveRPM < driver.minEffectiveRPM
 *   - HOME_TIME_EXCEEDED  delivery + transit home > cycleEndDate
 *   - PICKUP_WINDOW_EXPIRED / PICKUP_UNREACHABLE / AVOID_STATE / TRAILER_MISMATCH
 *
 * Scoring dimensions (passing loads only):
 *   netProfitScore    ×0.35  relative net profit vs best load in set (primary economic signal)
 *   dailyRevenueScore ×0.20  gross revenue rate vs survival floor per day
 *   destinationScore  ×0.20  outbound market strength (MCI)
 *   cycleFitScore     ×0.15  blend of market + homeward bias by cycle position
 *   deliveryScore     ×0.10  earlier delivery = more flexibility for next load
 *
 * async — queries MarketSnapshot via Prisma for destination MCI scores.
 * All destination queries are batched before scoring begins.
 */

import { prisma } from '../db';
import { calculateDeadheadMiles } from './load-metrics';
import type { Location } from '../../types/constraint.types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RESULTS              = 10;
const URGENT_CALL_COUNT        = 2;
/** Continental US diagonal (Los Angeles → New York) — denominator for homewardBias */
const MAX_POSSIBLE_DISTANCE_MI = 2_500;
const MS_PER_DAY               = 86_400_000;
/** Buffer applied to avgDailyMiles for transit estimates (home-time check + delivery date inference). */
const DAILY_MILES_BUFFER       = 1.15;
/** Max miles from destination to nearest MarketSnapshot city before proxy falls back to default. */
const MAX_PROXY_DISTANCE_MI    = 300;

// ---------------------------------------------------------------------------
// Nearest-city coordinate lookup
// Used for MCI proxy lookups when the destination city has no exact MarketSnapshot row.
// Key format: "CityName-STATE" (e.g. "Dallas-TX"). City name must match MarketSnapshot exactly.
// ---------------------------------------------------------------------------

const CITY_COORDS: Record<string, { lat: number; lon: number }> = {
  'Dallas-TX':         { lat: 32.7767, lon: -96.7970  },
  'Houston-TX':        { lat: 29.7604, lon: -95.3698  },
  'Atlanta-GA':        { lat: 33.7490, lon: -84.3880  },
  'Chicago-IL':        { lat: 41.8781, lon: -87.6298  },
  'Los Angeles-CA':    { lat: 34.0522, lon: -118.2437 },
  'San Francisco-CA':  { lat: 37.7749, lon: -122.4194 },
  'Seattle-WA':        { lat: 47.6062, lon: -122.3321 },
  'Denver-CO':         { lat: 39.7392, lon: -104.9903 },
  'Kansas City-MO':    { lat: 39.0997, lon: -94.5786  },
  'Memphis-TN':        { lat: 35.1495, lon: -90.0490  },
  'Nashville-TN':      { lat: 36.1627, lon: -86.7816  },
  'Charlotte-NC':      { lat: 35.2271, lon: -80.8431  },
  'Miami-FL':          { lat: 25.7617, lon: -80.1918  },
  'Philadelphia-PA':   { lat: 39.9526, lon: -75.1652  },
  'New York-NY':       { lat: 40.7128, lon: -74.0060  },
  'Columbus-OH':       { lat: 39.9612, lon: -82.9988  },
  'Indianapolis-IN':   { lat: 39.7684, lon: -86.1581  },
  'Louisville-KY':     { lat: 38.2527, lon: -85.7585  },
  'St Louis-MO':       { lat: 38.6270, lon: -90.1994  },
  'Phoenix-AZ':        { lat: 33.4484, lon: -112.0740 },
  'San Antonio-TX':    { lat: 29.4241, lon: -98.4936  },
  'Portland-OR':       { lat: 45.5051, lon: -122.6750 },
  'Las Vegas-NV':      { lat: 36.1699, lon: -115.1398 },
  'Minneapolis-MN':    { lat: 44.9778, lon: -93.2650  },
  'Detroit-MI':        { lat: 42.3314, lon: -83.0458  },
  'Pittsburgh-PA':     { lat: 40.4406, lon: -79.9959  },
  'Cincinnati-OH':     { lat: 39.1031, lon: -84.5120  },
  'Cleveland-OH':      { lat: 41.4993, lon: -81.6944  },
  'Baltimore-MD':      { lat: 39.2904, lon: -76.6122  },
  'Allentown-PA':      { lat: 40.6023, lon: -75.4714  },
  'Laredo-TX':         { lat: 27.5306, lon: -99.4803  },
  'El Paso-TX':        { lat: 31.7619, lon: -106.4850 },
  'Albuquerque-NM':    { lat: 35.0844, lon: -106.6504 },
  'Salt Lake City-UT': { lat: 40.7608, lon: -111.8910 },
  'Boise-ID':          { lat: 43.6150, lon: -116.2023 },
  'Oklahoma City-OK':  { lat: 35.4676, lon: -97.5164  },
  'Tulsa-OK':          { lat: 36.1540, lon: -95.9928  },
  'Jacksonville-FL':   { lat: 30.3322, lon: -81.6557  },
  'Tampa-FL':          { lat: 27.9506, lon: -82.4572  },
  'Savannah-GA':       { lat: 32.0835, lon: -81.0998  },
  'Greensboro-NC':     { lat: 36.0726, lon: -79.7920  },
  'Richmond-VA':       { lat: 37.5407, lon: -77.4360  },
  'Buffalo-NY':        { lat: 42.8864, lon: -78.8784  },
  'Albany-NY':         { lat: 42.6526, lon: -73.7562  },
  'Harrisburg-PA':     { lat: 40.2732, lon: -76.8867  },
  'Raleigh-NC':        { lat: 35.7796, lon: -78.6382  },
  'Birmingham-AL':     { lat: 33.5186, lon: -86.8104  },
  'Jackson-MS':        { lat: 32.2988, lon: -90.1848  },
  'Little Rock-AR':    { lat: 34.7465, lon: -92.2896  },
  'Shreveport-LA':     { lat: 32.5252, lon: -93.7502  },
};

/** Return type for market snapshot queries — includes nearest-city proxy fallback metadata. */
interface MarketSnapshotResult {
  outbound_mci:          number;
  capacity_label:        string;
  /** True when exact city had no MarketSnapshot row and a nearby proxy city was used. */
  mciProxy:              boolean;
  mciProxyCity:          string | null;
  mciProxyState:         string | null;
  mciProxyDistanceMiles: number | null;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CandidateLoad {
  id:            string;
  origin:        Location;
  destination:   Location;
  /** Loaded miles origin → destination. Does not include deadhead. */
  miles:         number;
  /** Total payout (NOT per-mile). effectiveRPM = rate / (miles + deadheadMiles). */
  rate:          number;
  /** Pre-computed deadhead from driver's current position to load origin. */
  deadheadMiles: number;
  /** ISO date string 'YYYY-MM-DD' */
  deliveryDate:      string;
  /** ISO date string 'YYYY-MM-DD' */
  pickupDate:        string;
  /** Full ISO datetime from payload (e.g. '2026-03-29T14:00:00.000Z'). Passed through to RankedLoad for display. */
  pickupWindowStart?: string;
  /** Full ISO datetime of drop-off deadline from payload. Passed through to RankedLoad for display. */
  deliveryDeadline?:   string;
  /** Full ISO datetime of the end of the pickup window. Used for PICKUP_WINDOW_EXPIRED check. */
  pickupWindowEnd?:    string;
  /** Must match MarketSnapshot equipment_type: 'REEFER' | 'DRY_VAN' | 'FLATBED' */
  trailerType:        string;
  brokerName?:        string;
}

export interface DriverProfile {
  id:              string;
  homeLocation:    Location;
  currentLocation: Location;
  /** Must match MarketSnapshot equipment_type: 'REEFER' | 'DRY_VAN' | 'FLATBED' */
  trailerType:     string;
  avgDailyMiles:   number;
  /** Hard gate: effectiveRPM < minEffectiveRPM → BELOW_MIN_RPM rejection (excluded from scoring) */
  minEffectiveRPM: number;
  /** RPM normalizer for rpmScore. Typically driver's target margin RPM. */
  targetRPM:       number;
  /** Expected idle days between loads (default 0.5) — used in home-time check. */
  dwellDays?:      number;
  /** State codes to avoid (e.g. ['CA', 'OR']). Loads dropping in these states are rejected. */
  avoidStates?:    string[];
}

export interface CycleState {
  cycleStartDate: Date;
  /** Hard deadline: driver must be home by this datetime. */
  cycleEndDate:   Date;
  totalCycleDays: number;
}

export interface RankedLoad extends CandidateLoad {
  rank:             number;
  score:            number;
  urgentCall:       boolean;
  /** Raw MCI value from MarketSnapshot (-100 to +100). Defaults to 0 (Neutral) when no data. */
  destinationMCI:   number;
  /** Capacity label from MarketSnapshot ('Very Tight', 'Neutral', etc.). */
  capacityLabel:    string;
  /** Normalized market strength 0–1. (MCI + 100) / 200. */
  marketStrength:        number;
  /** True when no MarketSnapshot row exists for this city and a nearby proxy city was used instead. */
  mciProxy:              boolean;
  /** City name of the proxy market used when mciProxy = true. Null when exact match found. */
  mciProxyCity:          string | null;
  /** State of the proxy market. Null when exact match found. */
  mciProxyState:         string | null;
  /** Distance in miles from destination to proxy city. Null when exact match found. */
  mciProxyDistanceMiles: number | null;
  effectiveRPM:          number;
  revenueScore:      number;
  destinationScore:  number;
  cycleFitScore:     number;
  dailyRevenueScore: number;
  /** Load gross rate divided by estimated transit days. For display only. */
  revenuePerDay:     number;
  deliveryScore:          number;
  /** False when both deliveryDate and deliveryDeadline were absent/empty — 0.10 weight redistributed to other dimensions. */
  deliveryScoreAvailable: boolean;
  /** True when deliveryDate was absent on input and was inferred from pickupDate + buffered transit. */
  inferredDelivery:  boolean;
  /** Normalized net profit score 0–1. Relative to best load in set: netProfit / maxNetProfit. Best load = 1.0, others scale proportionally. */
  netProfitScore:    number;
  /** Estimated net profit in dollars: rate − (totalMiles × variableCPM) − (rate × factoringRate) */
  netProfit:         number;
  /** Estimated cost in dollars: (totalMiles × variableCPM) + (rate × factoringRate) */
  estCost:           number;
}

export interface RejectedLoad {
  id:               string;
  /** Original external ID from payload (same as id; surfaced separately for portal display). */
  externalId:       string;
  origin:           Location;
  destination:      Location;
  trailerType:      string;
  violationCode:    'TRAILER_MISMATCH' | 'AVOID_STATE' | 'PICKUP_WINDOW_EXPIRED' | 'PICKUP_UNREACHABLE' | 'HOME_TIME_EXCEEDED' | 'BELOW_MIN_RPM';
  violationMessage: string;
}

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

function computeEffectiveRPM(load: CandidateLoad): number {
  const totalMiles = load.miles + load.deadheadMiles;
  return totalMiles > 0 ? load.rate / totalMiles : 0;
}

/**
 * 0 = far from home, 1 = at home.
 * Falls back to a state-level heuristic when coordinates are unavailable.
 */
function computeHomewardBias(destination: Location, homeLocation: Location): number {
  if (
    destination.lat  != null && destination.lon  != null &&
    homeLocation.lat != null && homeLocation.lon != null
  ) {
    const dist = calculateDeadheadMiles(destination, homeLocation);
    return Math.max(0, 1 - dist / MAX_POSSIBLE_DISTANCE_MI);
  }
  // No coords: same-state is close, different-state is middle-of-the-road
  return destination.state.toUpperCase() === homeLocation.state.toUpperCase() ? 0.9 : 0.4;
}

/**
 * Three-band cycle position scoring:
 *   < 0.4  (early cycle)  → reward strong outbound markets
 *   0.4–0.7 (mid cycle)  → blend market strength and homeward pull
 *   > 0.7  (late cycle)  → prioritize positioning toward home
 */
function computeCycleFitScore(
  destinationScore: number,
  homewardBias:     number,
  now:              Date,
  cycleState:       CycleState,
): number {
  const daysElapsed   = (now.getTime() - cycleState.cycleStartDate.getTime()) / MS_PER_DAY;
  const cyclePosition = Math.min(1, Math.max(0, daysElapsed / cycleState.totalCycleDays));

  if (cyclePosition < 0.4) {
    return destinationScore;
  }
  if (cyclePosition <= 0.7) {
    return destinationScore * 0.7 + homewardBias * 0.3;
  }
  return homewardBias;
}

// HACK — Phase 6 target: replace with full continuation value model.
// Current logic scores delivery based on how many usable business hours (05:00–20:00)
// remain after the driver empties. Exponential decay (^1.8) penalizes late-day deliveries
// steeply. A 21:00 delivery rolls to next morning — treated as equivalent to 05:00 next day.
// What this does NOT capture: destination market strength for the next load, actual reload
// time at that facility, or multi-hop continuation value. Phase 6 should model expected
// revenue from the next leg using MarketSnapshot + avg reload dwell time per city.
function computeDeliveryScore(load: CandidateLoad): number {
  // Get delivery datetime — prefer deliveryDeadline (full ISO), fall back to deliveryDate
  const deliveryStr = (load as any).deliveryDeadline || load.deliveryDate;
  if (!deliveryStr) return 0.5; // no delivery info — neutral

  const BUSINESS_START_HOUR = 5;  // 05:00
  const BUSINESS_END_HOUR   = 20; // 20:00
  const USABLE_HOURS        = BUSINESS_END_HOUR - BUSINESS_START_HOUR; // 15

  const deliveryDT  = new Date(deliveryStr);
  const deliveryHour = deliveryDT.getHours() + deliveryDT.getMinutes() / 60;

  let effectiveStart: Date;

  if (deliveryHour >= BUSINESS_END_HOUR) {
    // Too late — no usable hours today, roll to next day's business start
    const nextDay = new Date(deliveryDT);
    nextDay.setDate(nextDay.getDate() + 1);
    nextDay.setHours(BUSINESS_START_HOUR, 0, 0, 0);
    effectiveStart = nextDay;
  } else if (deliveryHour < BUSINESS_START_HOUR) {
    // Early delivery — full day available, snap to business start same day
    const sameDay = new Date(deliveryDT);
    sameDay.setHours(BUSINESS_START_HOUR, 0, 0, 0);
    effectiveStart = sameDay;
  } else {
    // Within business window — use actual delivery time
    effectiveStart = deliveryDT;
  }

  // Business end on the same day as effectiveStart
  const businessEnd = new Date(effectiveStart);
  businessEnd.setHours(BUSINESS_END_HOUR, 0, 0, 0);

  const remainingHours = Math.max(0, (businessEnd.getTime() - effectiveStart.getTime()) / (1000 * 60 * 60));
  const rawUtilization = remainingHours / USABLE_HOURS; // 0–1

  // Exponential decay — penalizes later deliveries steeply
  const score = Math.pow(rawUtilization, 1.8);

  return Math.min(1, Math.max(0, score));
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function rankLoads(
  loads:      CandidateLoad[],
  driver:     DriverProfile,
  cycleState: CycleState,
  now:        Date,
): Promise<{ rankedLoads: RankedLoad[]; rejectedLoads: RejectedLoad[] }> {
  const dwellDays = driver.dwellDays ?? 0.5;

  // ---------------------------------------------------------------------------
  // Market data — two-pass lookup
  // Pass A: exact city+state+equipment_type match (parallel)
  // Pass B: nearest-city proxy within MAX_PROXY_DISTANCE_MI for any misses
  // ---------------------------------------------------------------------------

  // Collect unique destination city|state keys and their coordinates from the load payloads.
  const destInfos = new Map<string, { lat?: number; lon?: number }>();
  for (const load of loads) {
    const key = `${load.destination.city}|${load.destination.state}`;
    if (!destInfos.has(key)) {
      destInfos.set(key, { lat: load.destination.lat, lon: load.destination.lon });
    }
  }

  // Pass A: exact matches in sequential batches of 5 to avoid exhausting the connection pool.
  const marketCache = new Map<string, MarketSnapshotResult>();
  const keys = [...destInfos.keys()];
  const exactResults: { key: string; row: { outbound_mci: number; capacity_label: string } | null }[] = [];
  const MCI_BATCH_SIZE = 5;
  for (let i = 0; i < keys.length; i += MCI_BATCH_SIZE) {
    const batch = keys.slice(i, i + MCI_BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (key) => {
        const [city, state] = key.split('|');
        const row = await prisma.marketSnapshot.findFirst({
          where: {
            city:           { equals: city, mode: 'insensitive' },
            state:          state.toUpperCase(),
            equipment_type: driver.trailerType,
          },
          orderBy: { valid_date: 'desc' },
          select:  { outbound_mci: true, capacity_label: true },
        });
        return { key, row };
      }),
    );
    exactResults.push(...batchResults);
  }

  const missedKeys: string[] = [];
  for (const { key, row } of exactResults) {
    if (row) {
      console.log(`[MCI] Pass A exact match: ${key} → mci=${row.outbound_mci} (${row.capacity_label})`);
      marketCache.set(key, {
        outbound_mci:          row.outbound_mci,
        capacity_label:        row.capacity_label,
        mciProxy:              false,
        mciProxyCity:          null,
        mciProxyState:         null,
        mciProxyDistanceMiles: null,
      });
    } else {
      console.log(`[MCI] Pass A miss: ${key} — no MarketSnapshot row, will try proxy`);
      missedKeys.push(key);
    }
  }

  // Pass B: nearest-city proxy for unmatched destinations.
  console.log(`[MCI] Pass A done: ${exactResults.length - missedKeys.length} exact, ${missedKeys.length} misses`);
  if (missedKeys.length > 0) {
    // Fetch all rows at the most recent valid_date for this equipment type (one query covers all misses).
    const latestDate = await prisma.marketSnapshot.findFirst({
      where:   { equipment_type: driver.trailerType },
      orderBy: { valid_date: 'desc' },
      select:  { valid_date: true },
    });
    const allRows = latestDate
      ? await prisma.marketSnapshot.findMany({
          where:  { equipment_type: driver.trailerType, valid_date: latestDate.valid_date },
          select: { city: true, state: true, outbound_mci: true, capacity_label: true },
        })
      : [];

    for (const key of missedKeys) {
      const [city, state] = key.split('|');
      const destInfo      = destInfos.get(key)!;

      // Resolve destination coordinates: prefer load lat/lon, fall back to CITY_COORDS lookup.
      let resolvedLat = destInfo.lat;
      let resolvedLon = destInfo.lon;
      if (resolvedLat == null || resolvedLon == null) {
        const coords = CITY_COORDS[`${city}-${state.toUpperCase()}`];
        if (coords) { resolvedLat = coords.lat; resolvedLon = coords.lon; }
      }

      if (resolvedLat == null || resolvedLon == null) {
        // No coordinates — default Neutral.
        console.log(`[MCI-proxy] ${city}, ${state}: NO COORDS — defaulting to Neutral (0)`);
        marketCache.set(key, { outbound_mci: 0, capacity_label: 'Neutral', mciProxy: false, mciProxyCity: null, mciProxyState: null, mciProxyDistanceMiles: null });
        continue;
      }

      let bestRow: { city: string; state: string; outbound_mci: number; capacity_label: string } | null = null;
      let bestDist = Infinity;

      for (const candidate of allRows) {
        const coords = CITY_COORDS[`${candidate.city}-${candidate.state}`];
        if (!coords) continue;
        const dist = calculateDeadheadMiles(
          { city, state: state.toUpperCase(), lat: resolvedLat,  lon: resolvedLon },
          { city: candidate.city, state: candidate.state, lat: coords.lat, lon: coords.lon },
        );
        if (dist < bestDist && dist <= MAX_PROXY_DISTANCE_MI) {
          bestDist = dist;
          bestRow  = candidate;
        }
      }

      if (bestRow) {
        console.log(`[MCI-proxy] ${city}, ${state} → proxy: ${bestRow.city}, ${bestRow.state} (${Math.round(bestDist)}mi) mci=${bestRow.outbound_mci} (${bestRow.capacity_label})`);
      } else {
        console.log(`[MCI-proxy] ${city}, ${state}: no proxy within ${MAX_PROXY_DISTANCE_MI}mi — defaulting to Neutral (0)`);
      }
      marketCache.set(key, bestRow
        ? {
            outbound_mci:          bestRow.outbound_mci,
            capacity_label:        bestRow.capacity_label,
            mciProxy:              true,
            mciProxyCity:          bestRow.city,
            mciProxyState:         bestRow.state,
            mciProxyDistanceMiles: Math.round(bestDist),
          }
        : { outbound_mci: 0, capacity_label: 'Neutral', mciProxy: false, mciProxyCity: null, mciProxyState: null, mciProxyDistanceMiles: null },
      );
    }
  }

  const scored: RankedLoad[]   = [];
  const rejectedLoads: RejectedLoad[] = [];

  if (loads.length > 0) {
    console.log(`[rank-loads-v2] first load deliveryDeadline: ${loads[0].deliveryDeadline ?? '(none)'}`);
  }

  for (const load of loads) {
    // 0. Trailer compatibility
    //    FLEX loads are accepted by REEFER and DRY_VAN drivers.
    //    All other loads must exactly match the driver's trailer type.
    const trailerOk =
      (load.trailerType === 'FLEX' && (driver.trailerType === 'REEFER' || driver.trailerType === 'DRY_VAN')) ||
      load.trailerType === driver.trailerType;
    if (!trailerOk) {
      rejectedLoads.push({
        id:               load.id,
        externalId:       load.id,
        origin:           load.origin,
        destination:      load.destination,
        trailerType:      load.trailerType,
        violationCode:    'TRAILER_MISMATCH',
        violationMessage: `Load requires ${load.trailerType}, driver has ${driver.trailerType}`,
      });
      continue;
    }

    // 0b. State avoidance
    const avoidStates = (driver.avoidStates ?? []).map((s) => s.toUpperCase());
    if (avoidStates.includes(load.destination.state.toUpperCase())) {
      rejectedLoads.push({
        id:               load.id,
        externalId:       load.id,
        origin:           load.origin,
        destination:      load.destination,
        trailerType:      load.trailerType,
        violationCode:    'AVOID_STATE',
        violationMessage: `Driver avoids ${load.destination.state}`,
      });
      continue;
    }

    // 0c. Pickup window checks
    if (load.pickupWindowEnd) {
      const windowEndMs = new Date(load.pickupWindowEnd).getTime();
      if (windowEndMs < now.getTime()) {
        // Window already closed.
        rejectedLoads.push({
          id:               load.id,
          externalId:       load.id,
          origin:           load.origin,
          destination:      load.destination,
          trailerType:      load.trailerType,
          violationCode:    'PICKUP_WINDOW_EXPIRED',
          violationMessage: `Pickup window closed at ${load.pickupWindowEnd}`,
        });
        continue;
      }
      // Window is open but check if driver can physically arrive before it closes.
      const daysUntilWindowEnd  = (windowEndMs - now.getTime()) / MS_PER_DAY;
      const daysToReachOrigin   = load.deadheadMiles / driver.avgDailyMiles;
      if (daysToReachOrigin > daysUntilWindowEnd) {
        rejectedLoads.push({
          id:               load.id,
          externalId:       load.id,
          origin:           load.origin,
          destination:      load.destination,
          trailerType:      load.trailerType,
          violationCode:    'PICKUP_UNREACHABLE',
          violationMessage: `Driver needs ${daysToReachOrigin.toFixed(1)}d to reach origin; pickup window closes in ${daysUntilWindowEnd.toFixed(1)}d`,
        });
        continue;
      }
    }

    // 1a. Infer delivery date when absent.
    //     Uses avgDailyMiles × DAILY_MILES_BUFFER so the estimate is slightly
    //     conservative (assumes driver moves a bit faster than average).
    const effectiveDailyMiles = driver.avgDailyMiles * DAILY_MILES_BUFFER;
    let deliveryDateStr: string;
    let inferredDelivery: boolean;
    if (load.deliveryDate && load.deliveryDate.trim().length > 0) {
      deliveryDateStr  = load.deliveryDate;
      inferredDelivery = false;
    } else {
      const inferredTransitDays    = Math.ceil(load.miles / effectiveDailyMiles);
      const inferredDeliveryDateMs = Date.parse(load.pickupDate) + inferredTransitDays * MS_PER_DAY;
      deliveryDateStr  = new Date(inferredDeliveryDateMs).toISOString().substring(0, 10);
      inferredDelivery = true;
    }

    // 1b. Hard constraint: home time
    //     Driver must reach home before cycleEndDate after this delivery.
    //     If load drops at home base, transit home = 0.
    //     Otherwise, compute driving time from destination to home using haversine deadhead.
    const isHomeDestination =
      load.destination.city.toLowerCase()  === driver.homeLocation.city.toLowerCase() &&
      load.destination.state.toUpperCase() === driver.homeLocation.state.toUpperCase();
    const transitDaysHome = isHomeDestination
      ? 0
      : Math.ceil(calculateDeadheadMiles(load.destination, driver.homeLocation) / effectiveDailyMiles);
    const arrivalHomeMs = Date.parse(deliveryDateStr) + (transitDaysHome + dwellDays) * MS_PER_DAY;
    if (arrivalHomeMs > cycleState.cycleEndDate.getTime()) {
      rejectedLoads.push({
        id:               load.id,
        externalId:       load.id,
        origin:           load.origin,
        destination:      load.destination,
        trailerType:      load.trailerType,
        violationCode:    'HOME_TIME_EXCEEDED',
        violationMessage: `Est. home arrival ${new Date(arrivalHomeMs).toISOString().substring(0, 10)} exceeds cycle deadline ${cycleState.cycleEndDate.toISOString().substring(0, 10)}`,
      });
      continue;
    }

    // 2. Revenue floor (hard gate)
    //    Loads below minEffectiveRPM are rejected outright — not scored.
    const effectiveRPM = computeEffectiveRPM(load);
    if (effectiveRPM < driver.minEffectiveRPM) {
      rejectedLoads.push({
        id:               load.id,
        externalId:       load.id,
        origin:           load.origin,
        destination:      load.destination,
        trailerType:      load.trailerType,
        violationCode:    'BELOW_MIN_RPM',
        violationMessage: `Effective RPM $${effectiveRPM.toFixed(2)} below minimum floor $${driver.minEffectiveRPM.toFixed(2)}`,
      });
      continue;
    }

    // 2b. Net profit — raw dollar value; normalized in Pass 2 (relative to best load in set).
    //     variableCPM and factoringRate are not yet persisted per-carrier in DB —
    //     passed via request body for now (Phase 5 deliverable).
    //     Falls back to minEffectiveRPM × 0.85 as a cost proxy when variableCPM is absent.
    const totalMiles    = load.miles + (load.deadheadMiles ?? 0);
    const variableCPM   = (driver as any).variableCPM   ?? (driver.minEffectiveRPM * 0.85);
    const factoringRate = (driver as any).factoringRate ?? 0.018;
    const estCost       = (totalMiles * variableCPM) + (load.rate * factoringRate);
    const netProfit     = load.rate - estCost;

    // 3. Destination market score
    const marketKey    = `${load.destination.city}|${load.destination.state}`;
    const snapshot     = marketCache.get(marketKey)!;  // always present — set in batch prefetch
    const outboundMCI  = snapshot.outbound_mci;
    const capacityLabel = snapshot.capacity_label;
    const marketStrength = (outboundMCI + 100) / 200; // normalizes -100…+100 → 0…1
    const destinationScore = marketStrength;

    // 4. Cycle fit score
    const homewardBias  = computeHomewardBias(load.destination, driver.homeLocation);
    const cycleFitScore = computeCycleFitScore(destinationScore, homewardBias, now, cycleState);

    // 5. Daily revenue score
    // Ceiling = minEffectiveRPM × avgDailyMiles × 2.5 so loads must be meaningfully
    // above the survival floor to score high. Loads at 2.5× floor rev/day score 1.0.
    const loadDays          = Math.max(load.miles / driver.avgDailyMiles, 0.5);
    const revenuePerDay     = load.rate / loadDays;
    const dailyCeiling      = driver.minEffectiveRPM * driver.avgDailyMiles * 2.5;
    const dailyRevenueScore = Math.min(revenuePerDay / dailyCeiling, 1.0);

    // 6. Earliest delivery score
    // Only computed when a delivery datetime is present on the load.
    // When absent, deliveryScore is excluded from the weighted sum and its 0.10
    // weight is redistributed proportionally to the remaining four dimensions in Pass 2.
    const deliveryScoreAvailable = !!(
      (load.deliveryDeadline && load.deliveryDeadline.trim().length > 0) ||
      (load.deliveryDate     && load.deliveryDate.trim().length > 0)
    );
    const deliveryScore = deliveryScoreAvailable ? computeDeliveryScore(load) : 0;

    scored.push({
      ...load,
      deliveryDate:     deliveryDateStr,   // override empty load.deliveryDate when inferred
      rank:             0,       // assigned after sort
      score:            0,       // recomputed in Pass 2 after netProfitScore is normalized
      urgentCall:       false,   // assigned after sort
      destinationMCI:   outboundMCI,
      capacityLabel,
      marketStrength:        Math.round(marketStrength * 1000) / 1000,
      mciProxy:              snapshot.mciProxy,
      mciProxyCity:          snapshot.mciProxyCity,
      mciProxyState:         snapshot.mciProxyState,
      mciProxyDistanceMiles: snapshot.mciProxyDistanceMiles,
      effectiveRPM:          Math.round(effectiveRPM * 1000) / 1000,
      revenueScore:     1,   // load reached scoring — hard gate already passed
      destinationScore: Math.round(destinationScore * 1000) / 1000,
      cycleFitScore:     Math.round(cycleFitScore * 1000) / 1000,
      dailyRevenueScore: Math.round(dailyRevenueScore * 1000) / 1000,
      revenuePerDay:     Math.round(revenuePerDay * 100) / 100,
      deliveryScore:          Math.round(deliveryScore * 1000) / 1000,
      deliveryScoreAvailable,
      inferredDelivery,
      netProfitScore:    0,  // placeholder — set in Pass 2
      netProfit:         Math.round(netProfit * 100) / 100,
      estCost:           Math.round(estCost * 100) / 100,
    });
  }

  // Pass 2: relative netProfitScore normalization.
  // Best load in the set scores 1.0; all others scale proportionally.
  // This avoids any absolute ceiling — the winner always dominates on this dimension.
  const maxNetProfit = scored.reduce((max, l) => Math.max(max, l.netProfit), 0);
  for (const l of scored) {
    const netProfitScore = maxNetProfit > 0 && l.netProfit > 0
      ? Math.max(l.netProfit / maxNetProfit, 0)
      : 0;
    // When deliveryScore is unavailable, redistribute its 0.10 weight proportionally:
    // 0.35/0.90≈0.389, 0.20/0.90≈0.222, 0.20/0.90≈0.222, 0.15/0.90≈0.167
    const score = l.deliveryScoreAvailable
      ? netProfitScore      * 0.35 +
        l.dailyRevenueScore * 0.20 +
        l.destinationScore  * 0.20 +
        l.cycleFitScore     * 0.15 +
        l.deliveryScore     * 0.10
      : netProfitScore      * 0.389 +
        l.dailyRevenueScore * 0.222 +
        l.destinationScore  * 0.222 +
        l.cycleFitScore     * 0.167;
    l.netProfitScore = Math.round(netProfitScore * 1000) / 1000;
    l.score          = Math.round(score          * 1000) / 1000;

    const mciCity = l.mciProxy && l.mciProxyCity && l.mciProxyState
      ? `${l.mciProxyCity}-${l.mciProxyState}`
      : `${l.destination.city}-${l.destination.state}`;
    console.log(
      `[rank-loads-v2] scored id=${l.id}` +
      ` | effectiveRPM=${l.effectiveRPM.toFixed(3)}` +
      ` | netProfit=$${l.netProfit.toFixed(0)} netProfitScore=${netProfitScore.toFixed(3)}(×0.35)` +
      ` | daily=${l.dailyRevenueScore.toFixed(3)}(×0.20) rpd=$${l.revenuePerDay.toFixed(0)}` +
      ` | destination=${l.destinationScore.toFixed(3)}(×0.20) mci=${l.destinationMCI} mciCity=${mciCity} proxy=${l.mciProxy}` +
      ` | cycleFit=${l.cycleFitScore.toFixed(3)}(×0.15)` +
      ` | delivery=${l.deliveryScoreAvailable ? l.deliveryScore.toFixed(3) : 'N/A'}(×${l.deliveryScoreAvailable ? '0.10' : 'skip'})` +
      ` | score=${score.toFixed(3)}`,
    );
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Tiebreaker 1: earlier delivery wins
    const aDelivery = Date.parse(a.deliveryDeadline || a.deliveryDate || '9999');
    const bDelivery = Date.parse(b.deliveryDeadline || b.deliveryDate || '9999');
    if (aDelivery !== bDelivery) return aDelivery - bDelivery;
    // Tiebreaker 2: earlier pickup wins
    const aPickup = Date.parse(a.pickupWindowStart || a.pickupDate || '9999');
    const bPickup = Date.parse(b.pickupWindowStart || b.pickupDate || '9999');
    return aPickup - bPickup;
  });

  const top = scored.slice(0, MAX_RESULTS);
  top.forEach((load, i) => {
    load.rank       = i + 1;
    load.urgentCall = i < URGENT_CALL_COUNT;
  });

  return { rankedLoads: top, rejectedLoads };
}
