/**
 * verify-dispatch-engine.ts
 *
 * End-to-end verification harness for the TrueMile dispatch engine.
 * Run: npx tsx verify-dispatch-engine.ts
 *
 * Tests:
 *   1. Market projection - TX, CA, unknown state
 *   2. Cycle profit - single load + projected continuation
 *   3. Constraint engine - pass/fail scenarios
 *   4. Decision engine - full ranked output
 *   5. Execution timing - appointment feasibility + defensive validation
 */

import { projectMarket, seedMarketDataProvider } from './market-projection';
import { projectCycleProfit } from './cycle-profit';
import { checkConstraints } from './constraint-engine';
import { rankLoads } from './decision-engine';
import {
  computeExecutionTiming,
  computeFirstLoadTiming,
  resolvePickupWindow,
  buildFacilityKey,
} from './execution-timing';
import type {
  Load,
  Driver,
  DriverCycleState,
  ActiveLoadExecution,
} from '../../types/constraint.types';
import type { LoadMetrics } from './load-metrics';
import type { CostModel } from './cycle-profit';
import type { MarketProjectionConfig } from './market-projection';
import type { DecisionEngineConfig } from './decision-engine';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const NOW_MS = new Date('2026-03-11T08:00:00Z').getTime();

const COST_MODEL: CostModel = {
  fixedCPM: 0.485,
  variableCPM: 1.05,
  trueCPM: 1.535,
  fixedCostPerDay: 235,   // monthlyFixed / 30 → ~$7,050 / 30
  survivalRPMFloor: 1.62,
  targetRPMFloor: 1.81,
};

const MARKET_CONFIG: MarketProjectionConfig = {
  defaultRPM: 2.20,
  defaultNextLoadMiles: 550,
  defaultDwellDays: 0.5,
  defaultNextDeadheadMiles: 150,
  dataFreshnessThresholdSeconds: 86400,
  fixedCostPerDay: COST_MODEL.fixedCostPerDay,
};

// Driver fixture — fields match the current Driver interface exactly
const DRIVER: Driver = {
  id: 'drv_001',
  carrierId: 'carrier_royal',
  name: 'Test Driver',
  currentLocation: { city: 'Dallas', state: 'TX', lat: 32.7767, lon: -96.797 },
  homeLocation:    { city: 'Dallas', state: 'TX', lat: 32.7767, lon: -96.797 },
  trailerType: 'DRY',
  avgDailyMiles: 650,
  cycleDays: 17,
  homeDays: 3,
  maxDeadheadMiles: 200,
  minEffectiveRPM: 1.62,
  preferredStates: ['TX', 'GA', 'TN'],
  avoidStates: ['CA', 'OR', 'WA'],
  survivalMarginPercent: 5,
};

// DriverCycleState fixture — matches the current interface.
// Removed stale fields: daysIntoCurrentCycle, hoursAvailableThisCycle
const CYCLE_STATE: DriverCycleState = {
  cycleStartDate: new Date('2026-03-09T00:00:00Z'),
  homeDeadline:   new Date('2026-03-26T00:00:00Z'), // 15 days from NOW_MS
  homeLocation:   DRIVER.homeLocation,
  isOTR: true,
  isInFinalCycleWindow: false,
};

// ActiveLoadExecution fixture.
// source must be 'RATE_CON' | 'MANUAL' — not 'DAT' (DAT loads become RATE_CON once booked)
const ACTIVE_LOAD: ActiveLoadExecution = {
  source: 'RATE_CON',
  brokerName: 'Coyote Logistics',
  origin:      { city: 'Dallas',  state: 'TX', lat: 32.7767, lon: -96.797  },
  destination: { city: 'Memphis', state: 'TN', lat: 35.1495, lon: -90.0490 },
  pickupDateTime:   '2026-03-11T08:00:00Z',
  deliveryDateTime: '2026-03-12T14:00:00Z',
  rate: 2200,
  trailerType: 'DRY',
  rateConReference: 'COY-123456',
};

// Load factory
const makeLoad = (
  id: string,
  originState: string,
  destState: string,
  rate: number,
  miles: number,
  pickupDate: string,
  extras?: Partial<Load>,
): Load => ({
  id,
  carrierId: 'carrier_royal',
  origin:      { city: 'Origin City', state: originState, lat: 32.7767, lon: -96.797  },
  destination: { city: 'Dest City',   state: destState,   lat: 33.749,  lon: -84.388  },
  pickupDate,
  deliveryDate: pickupDate,
  pickupWindowStart: `${pickupDate}T06:00:00Z`,
  pickupWindowEnd:   `${pickupDate}T20:00:00Z`,
  miles,
  rate,
  brokerName: 'Test Broker',
  trailerType: 'DRY',
  numberOfStops: 1,
  ...extras,
});

// Metrics factory (bypasses load-metrics.ts for unit isolation)
const makeFakeMetrics = (
  loadMiles: number,
  deadheadMiles: number,
  rate: number,
): LoadMetrics => {
  const totalMiles = loadMiles + deadheadMiles;
  const transitDays = loadMiles / 650;
  return {
    deadheadMiles,
    loadMiles,
    totalMiles,
    effectiveRPM: totalMiles > 0 ? rate / totalMiles : 0,
    transitDays,
    loadDailyRevenue: transitDays > 0 ? rate / transitDays : 0,
    pickupFeasible: true,
    continuationLoadsProjected: 0,
    daysRemainingAfterLoad: 0,
  };
};

const CONSTRAINT_CONFIG = {
  maxDeadheadMiles: 200,
  survivalRPMFloor: 1.62,
  homeTimeBufferDays: 0.5,
  requiredTrailerType: 'DRY' as const,
  enforceStatePreferences: true,
  minimumLoadRate: 500,
};

const TIMING_CONFIG = {
  defaultReceiverUnloadHours: 2.5,
  defaultShipperLoadHours: 2.0,
  averageRoadSpeedMph: 47,
  pickupSafetyBufferHours: 0.75,
};

// ---------------------------------------------------------------------------
// TEST 1: Market projection
// ---------------------------------------------------------------------------

console.log('\n=== TEST 1: Market Projection ===\n');

const txMarket = projectMarket({ city: 'Dallas', state: 'TX' }, MARKET_CONFIG, seedMarketDataProvider, NOW_MS);
const caMarket = projectMarket({ city: 'Los Angeles', state: 'CA' }, MARKET_CONFIG, seedMarketDataProvider, NOW_MS);
const unknownMarket = projectMarket({ city: 'Unknown', state: 'ZZ' }, MARKET_CONFIG, seedMarketDataProvider, NOW_MS);

console.log('TX:', { rpm: txMarket.projectedNextRPM, avail: txMarket.loadAvailabilityIndex, dwell: txMarket.projectedDwellDays, conf: txMarket.confidenceScore.toFixed(3) });
console.log('CA:', { rpm: caMarket.projectedNextRPM, avail: caMarket.loadAvailabilityIndex });
console.log('ZZ (defaults):', { rpm: unknownMarket.projectedNextRPM, conf: unknownMarket.confidenceScore.toFixed(3) });

// ---------------------------------------------------------------------------
// TEST 2: Cycle profit
// ---------------------------------------------------------------------------

console.log('\n=== TEST 2: Cycle Profit Projection ===\n');

const goodLoad = makeLoad('L1', 'TX', 'GA', 2800, 790, '2026-03-12');
const goodMetrics = makeFakeMetrics(790, 50, 2800);

const cycleResult = projectCycleProfit(
  goodLoad,
  goodMetrics,
  DRIVER,
  CYCLE_STATE,
  COST_MODEL,
  {
    avgDailyMiles: 650,
    projectionDiscountRate: 0.1,
    maxContinuationLoads: 3,
    marketConfig: MARKET_CONFIG,
    marketProvider: seedMarketDataProvider,
  },
  undefined,
  NOW_MS,
);

console.log('Cycle profit:', {
  total:        cycleResult.totalCycleProfit.toFixed(2),
  actualLoad:   cycleResult.actualLoadProfit.toFixed(2),
  continuation: cycleResult.projectedContinuationProfit.toFixed(2),
  loads:        cycleResult.continuationLoadsProjected,
  blendedRPM:   cycleResult.blendedEffectiveRPM.toFixed(3),
  daysUsed:     cycleResult.totalDaysConsumed.toFixed(1),
  daysLeft:     cycleResult.daysRemainingInCycle.toFixed(1),
  warnings:     cycleResult.warnings,
});
console.log('Contributions:');
cycleResult.contributions.forEach((c) => {
  console.log(
    `  [${c.sequence}] ${c.isActual ? 'ACTUAL' : 'PROJ'} → ${c.destinationState}` +
    ` | rev $${c.revenue.toFixed(0)}` +
    ` | varCost $${c.variableCost.toFixed(0)} (${c.totalDrivenMiles.toFixed(0)}mi)` +
    ` | fixedTransit $${c.fixedCostTransit.toFixed(0)} (${c.transitDays.toFixed(2)}d)` +
    ` | dwell $${c.dwellCost.toFixed(0)} (${c.dwellDays.toFixed(2)}d)` +
    ` | profit $${c.discountedProfit.toFixed(0)}` +
    ` | conf ${(c.marketConfidence * 100).toFixed(0)}%`,
  );
});

// ---------------------------------------------------------------------------
// TEST 3: Constraint engine
// ---------------------------------------------------------------------------

console.log('\n=== TEST 3: Constraint Engine ===\n');

// 3a: PASS
const passLoad = makeLoad('L_PASS', 'TX', 'GA', 2800, 790, '2026-03-12');
const passResult = checkConstraints(passLoad, makeFakeMetrics(790, 100, 2800), DRIVER, CYCLE_STATE, COST_MODEL, CONSTRAINT_CONFIG, false);
console.log('3a PASS:', { passed: passResult.passed, violations: passResult.violations.length });

// 3b: REJECT — RPM below survival floor
const rpmResult = checkConstraints(makeLoad('L_RPM', 'TX', 'GA', 900, 790, '2026-03-12'), makeFakeMetrics(790, 100, 900), DRIVER, CYCLE_STATE, COST_MODEL, CONSTRAINT_CONFIG, false);
console.log('3b RPM reject:', { passed: rpmResult.passed, code: rpmResult.primaryViolationCode });

// 3c: REJECT — deadhead exceeds limit
const dhResult = checkConstraints(makeLoad('L_DH', 'TX', 'GA', 2800, 790, '2026-03-12'), makeFakeMetrics(790, 250, 2800), DRIVER, CYCLE_STATE, COST_MODEL, CONSTRAINT_CONFIG, false);
console.log('3c Deadhead reject:', { passed: dhResult.passed, code: dhResult.primaryViolationCode });

// 3d: REJECT — home time deadline (1 day remaining, load takes 1.7 days)
const tightCycle: DriverCycleState = {
  ...CYCLE_STATE,
  homeDeadline: new Date(NOW_MS + 1 * 24 * 60 * 60 * 1000),
};
const timeResult = checkConstraints(makeLoad('L_TIME', 'TX', 'GA', 2800, 790, '2026-03-12'), makeFakeMetrics(790, 50, 2800), DRIVER, tightCycle, COST_MODEL, CONSTRAINT_CONFIG, false, undefined, NOW_MS);
console.log('3d Home time reject:', { passed: timeResult.passed, code: timeResult.primaryViolationCode });

// 3e: REJECT — avoided state (CA)
const avoidResult = checkConstraints(makeLoad('L_CA', 'TX', 'CA', 3500, 1400, '2026-03-12'), makeFakeMetrics(1400, 50, 3500), DRIVER, CYCLE_STATE, COST_MODEL, CONSTRAINT_CONFIG, false);
console.log('3e Avoid state reject:', { passed: avoidResult.passed, code: avoidResult.primaryViolationCode });

// ---------------------------------------------------------------------------
// TEST 4: Decision engine — full rank
// ---------------------------------------------------------------------------

console.log('\n=== TEST 4: Decision Engine — Full Rank ===\n');

const engineConfig: DecisionEngineConfig = {
  constraint: CONSTRAINT_CONFIG,
  cycleProfit: {
    avgDailyMiles: 650,
    projectionDiscountRate: 0.1,
    maxContinuationLoads: 3,
    marketConfig: MARKET_CONFIG,
    marketProvider: seedMarketDataProvider,
  },
  market: MARKET_CONFIG,
  penalties: {
    belowTargetRPMPenaltyPerDollar: 300,
    highDeadheadRatioPenalty: 150,
    highDeadheadRatioThreshold: 0.20,
    shortCycleWindowPenalty: 200,
    lowMarketAvailabilityPenalty: 100,
    multiStopPenaltyPerStop: 75,
    preferredStateBonusAmount: 100,
  },
  recommendedProfitThreshold: 3000,
  viableProfitThreshold: 1500,
  marketProvider: seedMarketDataProvider,
};

const rankResult = rankLoads({
  loads: [
    makeLoad('L_BEST',    'TX', 'GA', 2800, 790,  '2026-03-12'),
    makeLoad('L_OK',      'TX', 'TN', 2200, 620,  '2026-03-12'),
    makeLoad('L_MARG',    'TX', 'OH', 1800, 710,  '2026-03-12'),
    makeLoad('L_MULTI',   'TX', 'FL', 2400, 760,  '2026-03-12', { numberOfStops: 3 }),
    makeLoad('L_LOWRPM',  'TX', 'GA',  800, 790,  '2026-03-12'), // REJECTED
    makeLoad('L_AVOIDED', 'TX', 'CA', 3800, 1450, '2026-03-12'), // REJECTED
  ],
  driver: DRIVER,
  cycleState: CYCLE_STATE,
  costModel: COST_MODEL,
  config: engineConfig,
  carrierId: 'carrier_royal',
  nowMs: NOW_MS,
});

console.log('Summary:', rankResult.summary);
console.log('\nRanked:');
rankResult.decisions.forEach((d) => {
  if (d.status === 'REJECTED') {
    console.log(`  [REJECTED] ${d.load.id} — ${d.violations[0]?.code}`);
  } else {
    console.log(`  [#${d.rank} ${d.status}] ${d.load.id} | score $${d.score.toFixed(0)} | RPM $${d.metrics.effectiveRPM.toFixed(3)} | cycleProfit $${d.rawCycleProfit.toFixed(0)}`);
    d.penalties.forEach((p) => console.log(`    ${p.type}: ${p.penaltyAmount > 0 ? '-' : '+'}$${Math.abs(p.penaltyAmount).toFixed(0)}`));
  }
});
console.log('\nTop recommendation:', rankResult.topRecommendation?.load.id ?? 'NONE');

// ---------------------------------------------------------------------------
// TEST 5: Execution timing
// ---------------------------------------------------------------------------

console.log('\n=== TEST 5: Execution Timing ===\n');

// 5a: Truck delivers 14:00, next shipper ~85mi away, window 06:00–20:00 same day → PASS
const [ws1, we1] = resolvePickupWindow(undefined, undefined, '2026-03-12');
const nextShipperNearby = { city: 'Jackson', state: 'TN', lat: 35.6145, lon: -88.8139 };

const t5a = computeExecutionTiming(ACTIVE_LOAD, nextShipperNearby, ws1, we1, TIMING_CONFIG, NOW_MS);
console.log('5a Active load → nearby shipper (expect canMakePickup: true):');
console.log('  unloadComplete:  ', t5a.unloadCompleteAt.toISOString());
console.log('  repositionMiles: ', t5a.repositionMiles.toFixed(1), 'mi');
console.log('  earliestArrival: ', t5a.earliestPickupReadyAt.toISOString());
console.log('  canMakePickup:   ', t5a.canMakePickup, '| slack:', t5a.slackMinutes.toFixed(0), 'min');

// 5b: Tight window — delivery 17:00, window 19:00–20:00, shipper ~120mi away → FAIL
const activeLoadLate: ActiveLoadExecution = { ...ACTIVE_LOAD, deliveryDateTime: '2026-03-12T17:00:00Z' };
const farShipper = { city: 'Nashville', state: 'TN', lat: 36.1627, lon: -86.7816 };
const [ws2, we2] = resolvePickupWindow('2026-03-12T19:00:00Z', '2026-03-12T20:00:00Z');

const t5b = computeExecutionTiming(activeLoadLate, farShipper, ws2, we2, TIMING_CONFIG, NOW_MS);
console.log('\n5b Tight window (expect canMakePickup: false):');
console.log('  earliestArrival: ', t5b.earliestPickupReadyAt.toISOString());
console.log('  windowEnd:       ', t5b.pickupWindowEnd.toISOString());
console.log('  canMakePickup:   ', t5b.canMakePickup, '| missed by:', Math.abs(t5b.slackMinutes).toFixed(0), 'min');

// 5c: Free truck (no active load)
const [ws3, we3] = resolvePickupWindow('2026-03-12T14:00:00Z', '2026-03-12T18:00:00Z');
const t5c = computeFirstLoadTiming(DRIVER.currentLocation, new Date(NOW_MS), nextShipperNearby, ws3, we3, TIMING_CONFIG, NOW_MS);
console.log('\n5c Free truck (expect canMakePickup: true):');
console.log('  canMakePickup:', t5c.canMakePickup, '| slack:', t5c.slackMinutes.toFixed(0), 'min');

// 5d: buildFacilityKey
console.log('\n5d buildFacilityKey:', buildFacilityKey({ city: 'Memphis', state: 'TN' }), '(expect: memphis_tn)');

// 5e: Defensive validation — invalid road speed
const badConfig = { ...TIMING_CONFIG, averageRoadSpeedMph: 0 };
const t5e = computeExecutionTiming(ACTIVE_LOAD, nextShipperNearby, ws1, we1, badConfig, NOW_MS);
console.log('\n5e Invalid road speed (expect canMakePickup: false, invalidReason set):');
console.log('  canMakePickup:', t5e.canMakePickup, '| reason:', t5e.invalidReason);

// 5f: Defensive validation — inverted pickup window
const [ws5f] = resolvePickupWindow('2026-03-12T20:00:00Z'); // start only → 4h window, valid
const invertedEnd = new Date('2026-03-12T06:00:00Z');         // end before start
const invertedStart = new Date('2026-03-12T20:00:00Z');
const t5f = computeExecutionTiming(ACTIVE_LOAD, nextShipperNearby, invertedStart, invertedEnd, TIMING_CONFIG, NOW_MS);
console.log('\n5f Inverted pickup window (expect canMakePickup: false, invalidReason set):');
console.log('  canMakePickup:', t5f.canMakePickup, '| reason:', t5f.invalidReason);

// 5g: Constraint engine — EMPTY_TIME_WINDOW_VIOLATION via stale pickup date
const constraintWithTiming = { ...CONSTRAINT_CONFIG, executionTiming: TIMING_CONFIG };

const staleLoad = {
  ...makeLoad('L_STALE', 'TX', 'GA', 2800, 790, '2026-03-10'),
  pickupWindowStart: '2026-03-10T06:00:00Z',
  pickupWindowEnd:   '2026-03-10T20:00:00Z',
};
const staleResult = checkConstraints(staleLoad, makeFakeMetrics(790, 100, 2800), DRIVER, CYCLE_STATE, COST_MODEL, constraintWithTiming, false, ACTIVE_LOAD, NOW_MS);
console.log('\n5g Stale pickup window (expect EMPTY_TIME_WINDOW_VIOLATION):');
console.log('  passed:', staleResult.passed, '| code:', staleResult.primaryViolationCode);

// 5h: Future pickup window — should pass timing
const futureLoad = {
  ...makeLoad('L_FUTURE', 'TX', 'GA', 2800, 790, '2026-03-14'),
  pickupWindowStart: '2026-03-14T10:00:00Z',
  pickupWindowEnd:   '2026-03-14T18:00:00Z',
};
const futureResult = checkConstraints(futureLoad, makeFakeMetrics(790, 100, 2800), DRIVER, CYCLE_STATE, COST_MODEL, constraintWithTiming, false, ACTIVE_LOAD, NOW_MS);
console.log('\n5h Future pickup window (expect pass):');
console.log('  passed:', futureResult.passed, '| code:', futureResult.primaryViolationCode ?? 'none');

console.log('\n=== All tests complete ===\n');
