/**
 * decision-engine-v2.ts
 *
 * Single-load ranking engine for pre-filtered candidate loads.
 * Inputs are assumed to have already passed the 7 hard constraint filters
 * (trailer type, deadhead, RPM floor, timing window, state avoidance, etc.).
 *
 * This layer applies five continuous scoring dimensions:
 *   1. Revenue target  (binary gate: does RPM meet driver minimum?)
 *   2. Destination market strength (live MCI from MarketSnapshot)
 *   3. Cycle fit  (early → chase markets; late → chase home)
 *   4. RPM quality  (how far above target RPM?)
 *   5. Delivery timing  (earlier delivery = more flexibility for next load)
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
/** Days window used to normalize deliveryScore. Loads further out score lower. */
const MAX_DELIVERY_WINDOW_DAYS = 14;
const MS_PER_DAY               = 86_400_000;

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
  /** Hard gate: effectiveRPM < minEffectiveRPM → revenueScore = 0 */
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
  marketStrength:   number;
  effectiveRPM:     number;
  revenueScore:     number;
  destinationScore: number;
  cycleFitScore:    number;
  rpmScore:         number;
  deliveryScore:    number;
}

export interface RejectedLoad {
  id:               string;
  /** Original external ID from payload (same as id; surfaced separately for portal display). */
  externalId:       string;
  origin:           Location;
  destination:      Location;
  trailerType:      string;
  violationCode:    'TRAILER_MISMATCH' | 'AVOID_STATE' | 'PICKUP_WINDOW_EXPIRED' | 'PICKUP_UNREACHABLE' | 'HOME_TIME_EXCEEDED';
  violationMessage: string;
}

// ---------------------------------------------------------------------------
// Market snapshot query (Prisma)
// ---------------------------------------------------------------------------

async function getMarketSnapshot(
  city:          string,
  state:         string,
  equipmentType: string,
): Promise<{ outbound_mci: number; capacity_label: string } | null> {
  const snapshot = await prisma.marketSnapshot.findFirst({
    where: {
      city:           { equals: city, mode: 'insensitive' },
      state:          state.toUpperCase(),
      equipment_type: equipmentType,
    },
    orderBy: { valid_date: 'desc' },
    select:  { outbound_mci: true, capacity_label: true },
  });
  return snapshot;
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

/**
 * Earlier delivery → higher score → more flexibility for the next load.
 * Clamps to 0 for deliveries beyond MAX_DELIVERY_WINDOW_DAYS out.
 */
function computeDeliveryScore(deliveryDate: string, now: Date): number {
  const diffDays = (Date.parse(deliveryDate) - now.getTime()) / MS_PER_DAY;
  return Math.max(0, 1 - diffDays / MAX_DELIVERY_WINDOW_DAYS);
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

  // Batch-fetch market data for all unique destination city+state pairs.
  // All queries run in parallel before any scoring begins.
  const destKeys = [...new Set(loads.map((l) => `${l.destination.city}|${l.destination.state}`))];
  const marketCache = new Map<string, { outbound_mci: number; capacity_label: string } | null>();
  await Promise.all(
    destKeys.map(async (key) => {
      const [city, state] = key.split('|');
      marketCache.set(key, await getMarketSnapshot(city, state, driver.trailerType));
    }),
  );

  const scored: RankedLoad[]   = [];
  const rejectedLoads: RejectedLoad[] = [];
  let debuggedFirstLoad = false;

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

    // 1. Hard constraint: home time
    //    Driver must reach home before cycleEndDate after this delivery.
    const transitDays   = Math.ceil(load.miles / driver.avgDailyMiles);
    const arrivalHomeMs = Date.parse(load.deliveryDate) + (transitDays + dwellDays) * MS_PER_DAY;
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

    // 2. Revenue target score (binary)
    const effectiveRPM = computeEffectiveRPM(load);
    const revenueScore = effectiveRPM >= driver.minEffectiveRPM ? 1 : 0;

    // 3. Destination market score
    const marketKey      = `${load.destination.city}|${load.destination.state}`;
    const snapshot       = marketCache.get(marketKey) ?? null;
    const outboundMCI    = snapshot?.outbound_mci  ?? 0;
    const capacityLabel  = snapshot?.capacity_label ?? 'Neutral';
    const marketStrength = (outboundMCI + 100) / 200; // normalizes -100…+100 → 0…1
    const destinationScore = marketStrength;

    // 4. Cycle fit score
    const homewardBias  = computeHomewardBias(load.destination, driver.homeLocation);
    const cycleFitScore = computeCycleFitScore(destinationScore, homewardBias, now, cycleState);

    // 5. RPM score
    // Allows differentiation above targetRPM: score = rpm / (2 × target), capped at 1.0.
    // A load at 1× target scores 0.50; at 2× target scores 1.0.
    const rpmScore = Math.min(effectiveRPM / driver.targetRPM, 2.0) / 2.0;

    // 6. Earliest delivery score
    const deliveryScore = computeDeliveryScore(load.deliveryDate, now);

    const score =
      revenueScore     * 0.30 +
      destinationScore * 0.25 +
      cycleFitScore    * 0.20 +
      rpmScore         * 0.15 +
      deliveryScore    * 0.10;

    if (!debuggedFirstLoad) {
      debuggedFirstLoad = true;
      console.log(
        `[rank-loads-v2] first passing load id=${load.id}` +
        ` | effectiveRPM=${effectiveRPM.toFixed(3)}` +
        ` | revenue=${revenueScore.toFixed(3)}(×0.30)` +
        ` | destination=${destinationScore.toFixed(3)}(×0.25) mci=${outboundMCI}` +
        ` | cycleFit=${cycleFitScore.toFixed(3)}(×0.20)` +
        ` | rpm=${rpmScore.toFixed(3)}(×0.15)` +
        ` | delivery=${deliveryScore.toFixed(3)}(×0.10)` +
        ` | score=${score.toFixed(3)}`,
      );
    }

    scored.push({
      ...load,
      rank:             0,       // assigned after sort
      score:            Math.round(score * 1000) / 1000,
      urgentCall:       false,   // assigned after sort
      destinationMCI:   outboundMCI,
      capacityLabel,
      marketStrength:   Math.round(marketStrength * 1000) / 1000,
      effectiveRPM:     Math.round(effectiveRPM * 1000) / 1000,
      revenueScore,
      destinationScore: Math.round(destinationScore * 1000) / 1000,
      cycleFitScore:    Math.round(cycleFitScore * 1000) / 1000,
      rpmScore:         Math.round(rpmScore * 1000) / 1000,
      deliveryScore:    Math.round(deliveryScore * 1000) / 1000,
    });
  }

  scored.sort((a, b) => b.score - a.score);

  const top = scored.slice(0, MAX_RESULTS);
  top.forEach((load, i) => {
    load.rank       = i + 1;
    load.urgentCall = i < URGENT_CALL_COUNT;
  });

  return { rankedLoads: top, rejectedLoads };
}
