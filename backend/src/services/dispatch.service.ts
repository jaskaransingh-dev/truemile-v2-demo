/**
 * dispatch.service.ts
 *
 * Stateless service layer. No DB reads, no DB writes.
 * Returns rankLoads result + costModel + preferredStates so the
 * route serializer can build context-aware reasons without recomputing.
 */

import { rankLoads } from './dispatch/decision-engine';
import { seedMarketDataProvider } from './dispatch/market-projection';
import type {
  Driver,
  Load,
  ActiveLoadExecution,
  DriverCycleState,
  TrailerType,
} from '../types/constraint.types';
import type { CostModel } from './dispatch/cycle-profit';
import type { DecisionEngineConfig, RankLoadsOutput } from './dispatch/decision-engine';
import type { MarketProjectionConfig } from './dispatch/market-projection';
import type { ConstraintEngineConfig } from './dispatch/constraint-engine';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULTS = {
  avgDailyMiles:            650,
  fixedCostPerMonth:        7050,
  variableCPM:              1.05,
  survivalMarginPercent:    5,
  targetMarginPercent:      15,
  cycleDays:                17,
  homeDays:                 3,
  maxDeadheadMiles:         200,
  minEffectiveRPM:          1.62,
  homeTimeBufferDays:       0.5,
  receiverUnloadHours:      2.5,
  shipperLoadHours:         2.0,
  averageRoadSpeedMph:      47,
  pickupSafetyBufferHours:  0.75,
  projectionDiscountRate:   0.10,
  maxContinuationLoads:     3,
  marketDefaultRPM:                    2.20,
  marketDefaultNextLoadMiles:          550,
  marketDefaultDwellDays:              0.5,
  marketDefaultNextDeadheadMiles:      150,
  marketDataFreshnessThresholdSeconds: 86400,
  hardSurvivalRPMFloor:            1.62,
  targetRPMFloor:                  1.81,
  belowTargetRPMPenaltyPerDollar:  300,
  highDeadheadRatioPenalty:        150,
  highDeadheadRatioThreshold:      0.20,
  shortCycleWindowPenalty:         200,
  lowMarketAvailabilityPenalty:    100,
  multiStopPenaltyPerStop:         75,
  preferredStateBonusAmount:       100,
  recommendedProfitThreshold:      3000,
  viableProfitThreshold:           1500,
} as const;

// ---------------------------------------------------------------------------
// Request body shape (post-validation)
// ---------------------------------------------------------------------------

export interface RankLoadsRequest {
  driverId: string;
  cycleStartDate: string;
  driver: {
    currentLocation: LocationRaw;
    homeLocation: LocationRaw;
    trailerType: TrailerType;
    avgDailyMiles?: number;
    cycleDays?: number;
    homeDays?: number;
    maxDeadheadMiles?: number;
    minEffectiveRPM?: number;
    survivalMarginPercent?: number;
    preferredStates?: string[];
    avoidStates?: string[];
  };
  candidateLoads: CandidateLoadRaw[];
  activeLoad?: ActiveLoadRaw;
  costModel?: CostModelRaw;
  now?: string;
}

interface LocationRaw {
  city: string;
  state: string;
  lat?: number;
  lon?: number;
}

interface CandidateLoadRaw {
  externalId: string;
  origin: LocationRaw;
  destination: LocationRaw;
  rate: number;
  miles: number;
  trailerType: TrailerType;
  pickupDate?: string;
  pickupWindowStart?: string;
  pickupWindowEnd?: string;
  deliveryDate?: string;
  brokerName?: string;
  numberOfStops?: number;
}

interface ActiveLoadRaw {
  source: 'RATE_CON' | 'MANUAL';
  brokerName: string;
  origin: LocationRaw;
  destination: LocationRaw;
  pickupDateTime: string;
  deliveryDateTime: string;
  rate: number;
  trailerType: TrailerType;
  rateConReference?: string;
}

interface CostModelRaw {
  fixedCostPerMonth?: number;
  variableCPM?: number;
  avgDailyMiles?: number;
  survivalMarginPercent?: number;
  targetMarginPercent?: number;
}

// ---------------------------------------------------------------------------
// Return type — extends engine output with context needed for serialization
// ---------------------------------------------------------------------------

export interface DispatchRankingResult extends RankLoadsOutput {
  carrierId: string;
  processedAtMs: number;
  costModel: CostModel;
  preferredStates: string[];
}

// ---------------------------------------------------------------------------
// Error type for home window guard
// ---------------------------------------------------------------------------

export class DriverHomeWindowError extends Error {
  readonly nextOTRStart: string;
  constructor(nextOTRStart: string) {
    super('Driver is currently in home window. No loads to rank.');
    this.name = 'DriverHomeWindowError';
    this.nextOTRStart = nextOTRStart;
  }
}

// ---------------------------------------------------------------------------
// Main service function
// ---------------------------------------------------------------------------

export function runDispatchRanking(
  carrierId: string,
  body: RankLoadsRequest,
  nowMs: number,
): DispatchRankingResult {
  const costModel  = buildCostModel(body.costModel, body.driver);
  const driver     = buildDriver(carrierId, body.driverId, body.driver);
  const cycleState = buildCycleState(body.cycleStartDate, driver, nowMs);

  if (!cycleState.isOTR) {
    const msPerFullPeriod = (driver.cycleDays + driver.homeDays) * 24 * 60 * 60 * 1000;
    const nextOTRStart = new Date(cycleState.cycleStartDate.getTime() + msPerFullPeriod).toISOString();
    throw new DriverHomeWindowError(nextOTRStart);
  }
  const loads      = body.candidateLoads.map((l) => mapLoad(l, carrierId));
  const activeLoad = body.activeLoad ? mapActiveLoad(body.activeLoad) : undefined;
  const config     = buildEngineConfig(driver, costModel);

  const engineResult = rankLoads({
    loads,
    driver,
    cycleState,
    costModel,
    config,
    carrierId,
    nowMs,
    activeLoad,
  });

  return {
    ...engineResult,
    carrierId,
    processedAtMs: nowMs,
    costModel,
    preferredStates: driver.preferredStates ?? [],
  };
}

// ---------------------------------------------------------------------------
// Cost model builder
// ---------------------------------------------------------------------------

function buildCostModel(cm: CostModelRaw | undefined, driverRaw: RankLoadsRequest['driver']): CostModel {
  const avgDailyMiles     = cm?.avgDailyMiles    ?? driverRaw.avgDailyMiles ?? DEFAULTS.avgDailyMiles;
  const fixedCostPerMonth = cm?.fixedCostPerMonth ?? DEFAULTS.fixedCostPerMonth;
  const variableCPM       = cm?.variableCPM       ?? DEFAULTS.variableCPM;
  const targetMarginPct   = cm?.targetMarginPercent   ?? DEFAULTS.targetMarginPercent;

  const fixedCPM        = fixedCostPerMonth / (avgDailyMiles * 30);
  const trueCPM         = fixedCPM + variableCPM;
  const fixedCostPerDay = fixedCostPerMonth / 30;

  return {
    fixedCPM,
    variableCPM,
    trueCPM,
    fixedCostPerDay,
    survivalRPMFloor: DEFAULTS.hardSurvivalRPMFloor,
    targetRPMFloor:   trueCPM * (1 + targetMarginPct / 100),
  };
}

// ---------------------------------------------------------------------------
// Cycle state builder (inline — driver-cycle.ts has type drift)
// ---------------------------------------------------------------------------

function buildCycleState(
  cycleStartDateStr: string,
  driver: Driver,
  nowMs: number,
): DriverCycleState {
  const MS_PER_DAY      = 24 * 60 * 60 * 1000;
  const cycleStartDate  = new Date(cycleStartDateStr);
  // Bug 1 fix: full period = driving days + home days (not just driving days)
  const msPerFullPeriod = (driver.cycleDays + driver.homeDays) * MS_PER_DAY;
  const msSinceStart    = nowMs - cycleStartDate.getTime();
  const completedCycles = Math.max(0, Math.floor(msSinceStart / msPerFullPeriod));
  const currentAnchorMs = cycleStartDate.getTime() + completedCycles * msPerFullPeriod;
  const homeDeadline    = new Date(currentAnchorMs + driver.cycleDays * MS_PER_DAY + 12 * 60 * 60 * 1000);
  const daysRemaining   = (homeDeadline.getTime() - nowMs) / MS_PER_DAY;
  // Bug 2 fix: isOTR false when driver is in the home window (msIntoCurrentPeriod >= cycleDays)
  const msIntoCurrentPeriod = nowMs - currentAnchorMs;
  const isOTR = msIntoCurrentPeriod >= 0 &&
                msIntoCurrentPeriod < driver.cycleDays * MS_PER_DAY;

  return {
    cycleStartDate:       new Date(currentAnchorMs),
    homeDeadline,
    homeLocation:         driver.homeLocation,
    isOTR,
    isInFinalCycleWindow: daysRemaining < driver.cycleDays * 0.25,
  };
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function buildDriver(carrierId: string, driverId: string, raw: RankLoadsRequest['driver']): Driver {
  return {
    id:                    driverId,
    carrierId,
    name:                  driverId,
    currentLocation:       raw.currentLocation,
    homeLocation:          raw.homeLocation,
    trailerType:           raw.trailerType,
    avgDailyMiles:         raw.avgDailyMiles        ?? DEFAULTS.avgDailyMiles,
    cycleDays:             raw.cycleDays             ?? DEFAULTS.cycleDays,
    homeDays:              raw.homeDays              ?? DEFAULTS.homeDays,
    maxDeadheadMiles:      raw.maxDeadheadMiles      ?? DEFAULTS.maxDeadheadMiles,
    minEffectiveRPM:       raw.minEffectiveRPM       ?? DEFAULTS.minEffectiveRPM,
    preferredStates:       raw.preferredStates       ?? [],
    avoidStates:           raw.avoidStates           ?? [],
    survivalMarginPercent: raw.survivalMarginPercent ?? DEFAULTS.survivalMarginPercent,
  };
}

function mapLoad(raw: CandidateLoadRaw, carrierId: string): Load {
  return {
    id:                raw.externalId,
    carrierId,
    origin:            raw.origin,
    destination:       raw.destination,
    rate:              raw.rate,
    miles:             raw.miles,
    trailerType:       raw.trailerType,
    pickupDate:        raw.pickupDate ?? raw.pickupWindowStart?.substring(0, 10) ?? '',
    deliveryDate:      raw.deliveryDate ?? '',
    pickupWindowStart: raw.pickupWindowStart,
    pickupWindowEnd:   raw.pickupWindowEnd,
    brokerName:        raw.brokerName ?? 'Unknown',
    numberOfStops:     raw.numberOfStops ?? 1,
  };
}

function mapActiveLoad(raw: ActiveLoadRaw): ActiveLoadExecution {
  return {
    source:           raw.source,
    brokerName:       raw.brokerName,
    origin:           raw.origin,
    destination:      raw.destination,
    pickupDateTime:   raw.pickupDateTime,
    deliveryDateTime: raw.deliveryDateTime,
    rate:             raw.rate,
    trailerType:      raw.trailerType,
    rateConReference: raw.rateConReference,
  };
}

// ---------------------------------------------------------------------------
// Engine config builder
// ---------------------------------------------------------------------------

function buildEngineConfig(driver: Driver, costModel: CostModel): DecisionEngineConfig {
  const avgDailyMiles = driver.avgDailyMiles ?? DEFAULTS.avgDailyMiles;

  const marketConfig: MarketProjectionConfig = {
    defaultRPM:                    DEFAULTS.marketDefaultRPM,
    defaultNextLoadMiles:          DEFAULTS.marketDefaultNextLoadMiles,
    defaultDwellDays:              DEFAULTS.marketDefaultDwellDays,
    defaultNextDeadheadMiles:      DEFAULTS.marketDefaultNextDeadheadMiles,
    dataFreshnessThresholdSeconds: DEFAULTS.marketDataFreshnessThresholdSeconds,
    fixedCostPerDay:               costModel.fixedCostPerDay,
  };

  const constraint: ConstraintEngineConfig = {
    maxDeadheadMiles:        driver.maxDeadheadMiles,
    survivalRPMFloor:        costModel.survivalRPMFloor,
    homeTimeBufferDays:      DEFAULTS.homeTimeBufferDays,
    requiredTrailerType:     driver.trailerType,
    enforceStatePreferences: (driver.avoidStates?.length ?? 0) > 0,
    executionTiming: {
      defaultReceiverUnloadHours: DEFAULTS.receiverUnloadHours,
      defaultShipperLoadHours:    DEFAULTS.shipperLoadHours,
      averageRoadSpeedMph:        DEFAULTS.averageRoadSpeedMph,
      pickupSafetyBufferHours:    DEFAULTS.pickupSafetyBufferHours,
    },
  };

  return {
    constraint,
    cycleProfit: {
      avgDailyMiles,
      projectionDiscountRate: DEFAULTS.projectionDiscountRate,
      maxContinuationLoads:   DEFAULTS.maxContinuationLoads,
      marketConfig,
      marketProvider: seedMarketDataProvider,
    },
    market: marketConfig,
    penalties: {
      belowTargetRPMPenaltyPerDollar: DEFAULTS.belowTargetRPMPenaltyPerDollar,
      highDeadheadRatioPenalty:       DEFAULTS.highDeadheadRatioPenalty,
      highDeadheadRatioThreshold:     DEFAULTS.highDeadheadRatioThreshold,
      shortCycleWindowPenalty:        DEFAULTS.shortCycleWindowPenalty,
      lowMarketAvailabilityPenalty:   DEFAULTS.lowMarketAvailabilityPenalty,
      multiStopPenaltyPerStop:        DEFAULTS.multiStopPenaltyPerStop,
      preferredStateBonusAmount:      DEFAULTS.preferredStateBonusAmount,
    },
    recommendedProfitThreshold: DEFAULTS.recommendedProfitThreshold,
    viableProfitThreshold:      DEFAULTS.viableProfitThreshold,
    marketProvider: seedMarketDataProvider,
  };
}
