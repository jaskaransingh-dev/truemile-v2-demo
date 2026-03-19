/**
 * market-projection.ts
 *
 * Projects next-load market conditions from a given state/location.
 * Used by cycle-profit.ts to estimate continuation load revenue.
 *
 * MVP: seed data with known state averages.
 * Future: live DAT market data via API.
 *
 * Pure functions. No I/O. All state injected.
 */

import type { Location } from '../../types/constraint.types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MarketProjectionConfig {
  /** Fallback RPM when state has no market data */
  defaultRPM: number;
  /** Default projected load miles when no market data */
  defaultNextLoadMiles: number;
  /** Default projected dwell days at destination before next load */
  defaultDwellDays: number;
  /** Default projected deadhead to next load's origin */
  defaultNextDeadheadMiles: number;
  /** Market data older than this many seconds gets confidence penalty */
  dataFreshnessThresholdSeconds: number;
  /** Fixed cost per day — used to price dwell cost in projections */
  fixedCostPerDay: number;
}

export interface MarketProjection {
  /** Projected average RPM for next load out of this market */
  projectedNextRPM: number;
  /** 0–1 index of how much freight is available (higher = easier to find next load) */
  loadAvailabilityIndex: number;
  /** Expected days waiting for next load (dead time between loads) */
  projectedDwellDays: number;
  /** Expected deadhead miles to next load's origin */
  projectedNextDeadheadMiles: number;
  /** Expected loaded miles for next load from this market */
  projectedNextLoadMiles: number;
  /** 0–1 confidence in this projection. Lower for stale or missing data. */
  confidenceScore: number;
  /** Age of underlying market data in seconds */
  dataAgeSeconds: number;
  /** True if default (fallback) data was used */
  usedDefaultData: boolean;
}

/** Raw market entry stored in the data provider */
export interface MarketEntry {
  state: string;
  avgRPM: number;
  loadAvailabilityIndex: number;
  dwellDays: number;
  nextDeadheadMiles: number;
  nextLoadMiles: number;
  /** Unix timestamp ms when this data was recorded */
  dataTimestampMs: number;
}

/** Data provider interface — injectable for testing and future live data */
export type MarketDataProvider = (state: string) => MarketEntry | null;

// ---------------------------------------------------------------------------
// Seed market data
// ---------------------------------------------------------------------------

// Timestamp: 8 hours before the reference NOW_MS (2026-03-11T08:00:00Z)
const SEED_TIMESTAMP = new Date('2026-03-11T00:00:00Z').getTime();

const SEED_ENTRIES: MarketEntry[] = [
  { state: 'TX', avgRPM: 2.30, loadAvailabilityIndex: 0.80, dwellDays: 0.50, nextDeadheadMiles: 120, nextLoadMiles: 600, dataTimestampMs: SEED_TIMESTAMP },
  { state: 'GA', avgRPM: 2.25, loadAvailabilityIndex: 0.72, dwellDays: 0.50, nextDeadheadMiles: 130, nextLoadMiles: 580, dataTimestampMs: SEED_TIMESTAMP },
  { state: 'TN', avgRPM: 2.15, loadAvailabilityIndex: 0.65, dwellDays: 0.50, nextDeadheadMiles: 140, nextLoadMiles: 540, dataTimestampMs: SEED_TIMESTAMP },
  { state: 'FL', avgRPM: 2.30, loadAvailabilityIndex: 0.70, dwellDays: 0.75, nextDeadheadMiles: 160, nextLoadMiles: 560, dataTimestampMs: SEED_TIMESTAMP },
  { state: 'OH', avgRPM: 2.10, loadAvailabilityIndex: 0.60, dwellDays: 0.50, nextDeadheadMiles: 150, nextLoadMiles: 520, dataTimestampMs: SEED_TIMESTAMP },
  { state: 'CA', avgRPM: 2.45, loadAvailabilityIndex: 0.68, dwellDays: 1.00, nextDeadheadMiles: 200, nextLoadMiles: 700, dataTimestampMs: SEED_TIMESTAMP },
  { state: 'IL', avgRPM: 2.20, loadAvailabilityIndex: 0.70, dwellDays: 0.50, nextDeadheadMiles: 130, nextLoadMiles: 550, dataTimestampMs: SEED_TIMESTAMP },
  { state: 'NC', avgRPM: 2.18, loadAvailabilityIndex: 0.68, dwellDays: 0.50, nextDeadheadMiles: 140, nextLoadMiles: 540, dataTimestampMs: SEED_TIMESTAMP },
  { state: 'PA', avgRPM: 2.15, loadAvailabilityIndex: 0.65, dwellDays: 0.50, nextDeadheadMiles: 145, nextLoadMiles: 530, dataTimestampMs: SEED_TIMESTAMP },
  { state: 'IN', avgRPM: 2.12, loadAvailabilityIndex: 0.65, dwellDays: 0.50, nextDeadheadMiles: 140, nextLoadMiles: 530, dataTimestampMs: SEED_TIMESTAMP },
];

const seedMap = new Map(SEED_ENTRIES.map(e => [e.state, e]));

export const seedMarketDataProvider: MarketDataProvider = (state: string) =>
  seedMap.get(state) ?? null;

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

/**
 * Project market conditions for next load out of a given location.
 *
 * Confidence scoring:
 *   - Known state + fresh data (< dataFreshnessThresholdSeconds): 0.65
 *   - Known state + stale data: 0.40
 *   - Unknown state (defaults used): 0.30
 */
export function projectMarket(
  location: Location,
  config: MarketProjectionConfig,
  provider: MarketDataProvider,
  nowMs: number,
): MarketProjection {
  const entry = provider(location.state);

  if (!entry) {
    return {
      projectedNextRPM: config.defaultRPM,
      loadAvailabilityIndex: 0.50,
      projectedDwellDays: config.defaultDwellDays,
      projectedNextDeadheadMiles: config.defaultNextDeadheadMiles,
      projectedNextLoadMiles: config.defaultNextLoadMiles,
      confidenceScore: 0.30,
      dataAgeSeconds: Infinity,
      usedDefaultData: true,
    };
  }

  const dataAgeSeconds = (nowMs - entry.dataTimestampMs) / 1000;
  const isFresh = dataAgeSeconds < config.dataFreshnessThresholdSeconds;
  const confidenceScore = isFresh ? 0.65 : 0.40;

  return {
    projectedNextRPM: entry.avgRPM,
    loadAvailabilityIndex: entry.loadAvailabilityIndex,
    projectedDwellDays: entry.dwellDays,
    projectedNextDeadheadMiles: entry.nextDeadheadMiles,
    projectedNextLoadMiles: entry.nextLoadMiles,
    confidenceScore,
    dataAgeSeconds,
    usedDefaultData: false,
  };
}
