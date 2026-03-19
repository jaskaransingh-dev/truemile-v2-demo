/**
 * constraint.types.ts
 *
 * Authoritative type definitions for the TrueMile dispatch engine.
 * All dispatch modules import from here. No types are defined inline in service files.
 *
 * Multi-tenant note:
 *   Every entity that belongs to a carrier includes carrierId.
 *   The dispatch engine never infers carrier context — it is always injected.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export type TrailerType = 'DRY' | 'REEFER';

export interface Coordinates {
  lat: number;
  lon: number;
}

export interface Location {
  city: string;
  state: string;
  lat?: number;
  lon?: number;
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

export interface Driver {
  id: string;
  carrierId: string;
  name: string;
  currentLocation: Location;
  homeLocation: Location;
  trailerType: TrailerType;
  /** Average loaded miles per driving day for this driver */
  avgDailyMiles?: number;
  /** Length of one OTR cycle in days (e.g. 17) */
  cycleDays: number;
  /** Home days between cycles (e.g. 3) */
  homeDays: number;
  /** Hard constraint: max deadhead miles accepted for any single load */
  maxDeadheadMiles: number;
  /** Hard constraint: minimum daily revenue floor (used for soft filtering upstream) */
  minDailyRevenue?: number;
  /** Hard constraint: minimum effective RPM (includes deadhead) */
  minEffectiveRPM: number;
  /** States driver prefers to deliver into (bonus scoring) */
  preferredStates?: string[];
  /** States driver will not enter (hard reject when enforceStatePreferences = true) */
  avoidStates?: string[];
  /**
   * Survival margin as a percentage above trueCPM.
   * survivalRPMFloor = trueCPM * (1 + survivalMarginPercent / 100)
   * Default: 5 (5% above breakeven)
   */
  survivalMarginPercent: number;
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

export interface Load {
  id: string;
  carrierId: string;
  origin: Location;
  destination: Location;
  /** ISO date string (date-only) — fallback if no pickup window provided */
  pickupDate: string;
  /** ISO date string (date-only) */
  deliveryDate: string;
  /** ISO datetime — window open */
  pickupWindowStart?: string;
  /** ISO datetime — window close */
  pickupWindowEnd?: string;
  /** ISO datetime — delivery appointment or window open */
  deliveryWindowStart?: string;
  /** ISO datetime — delivery window close */
  deliveryWindowEnd?: string;
  /** Loaded miles (origin → destination). Does NOT include deadhead. */
  miles: number;
  /**
   * Total payout for this load.
   * CRITICAL: This is the full dollar amount, NOT a per-mile rate.
   * effectiveRPM = rate / (loadMiles + deadheadMiles)
   */
  rate: number;
  brokerName: string;
  trailerType: TrailerType;
  /** Number of stops including final. 1 = direct. Used for multi-stop penalty. */
  numberOfStops?: number;
}

// ---------------------------------------------------------------------------
// Active Load Execution
// ---------------------------------------------------------------------------

/**
 * Represents a load that has already been booked and is currently executing.
 * Sourced from a parsed rate confirmation or manual entry.
 * Used to determine driver's current position and when they'll be free.
 */
export interface ActiveLoadExecution {
  /**
   * How this load was entered into the system.
   * 'RATE_CON' = parsed from PDF rate confirmation via parseRateConfirmation()
   * 'MANUAL'   = dispatcher entered manually
   */
  source: 'RATE_CON' | 'MANUAL';
  brokerName: string;
  origin: Location;
  destination: Location;
  /** ISO datetime of scheduled or actual pickup */
  pickupDateTime: string;
  /** ISO datetime of scheduled delivery appointment */
  deliveryDateTime: string;
  /** Total payout for this load */
  rate: number;
  trailerType: TrailerType;
  /** Rate confirmation document reference number */
  rateConReference?: string;
}

// ---------------------------------------------------------------------------
// Driver Cycle State
// ---------------------------------------------------------------------------

/**
 * Current operational state of a driver within their active cycle.
 * Computed at runtime from driver config + cycle start date.
 */
export interface DriverCycleState {
  /** Date the current OTR cycle began */
  cycleStartDate: Date;
  /**
   * Hard deadline by which the driver must be home.
   * Computed: cycleStartDate + cycleDays, rolling correctly across repeated cycles.
   */
  homeDeadline: Date;
  /** Driver's home location — used for terminal value and home time feasibility */
  homeLocation: Location;
  /** True if driver is currently OTR (on the road), false if home */
  isOTR: boolean;
  /**
   * True if the remaining cycle window is short enough that the engine should
   * prefer short loads that position the driver toward home.
   * Typically triggered when daysRemaining < cycleDays * 0.25
   */
  isInFinalCycleWindow: boolean;
}

// ---------------------------------------------------------------------------
// Constraint Violations
// ---------------------------------------------------------------------------

/**
 * All codes used by constraint-engine.ts.
 * One canonical list — no parallel naming systems.
 * Add new codes here before using them in constraint checks.
 */
export type ConstraintViolationCode =
  | 'TRAILER_TYPE_MISMATCH'
  | 'DEADHEAD_EXCEEDS_LIMIT'
  | 'BELOW_SURVIVAL_RPM'
  | 'HOME_TIME_DEADLINE'
  /** Replaces old PICKUP_NOT_FEASIBLE — full timing pipeline check */
  | 'EMPTY_TIME_WINDOW_VIOLATION'
  | 'STATE_PREFERENCE_VIOLATION'
  | 'RATE_BELOW_MINIMUM'
  | 'EXCEEDS_MAX_MILES';

export interface ConstraintViolation {
  code: ConstraintViolationCode;
  message: string;
  /** Actual value that triggered the violation (for dispatcher UI) */
  actual?: number | string;
  /** Threshold or required value (for dispatcher UI) */
  threshold?: number | string;
}

// ---------------------------------------------------------------------------
// Engine Config + Input Envelope
// ---------------------------------------------------------------------------

export interface DispatchEngineConfig {
  /** Scoring weights and defaults for the decision engine */
  scoringWeights?: Record<string, number>;
  /** Default average daily miles if driver record lacks one */
  defaultAvgDailyMiles: number;
  /** Default survival margin percent if driver record lacks one */
  defaultSurvivalMarginPercent: number;
}

/**
 * Single input envelope for a dispatch engine call.
 * Carries all context needed to score one batch of candidate loads for one driver.
 */
export interface DispatchEngineInput {
  carrierId: string;
  driver: Driver;
  cycleState: DriverCycleState;
  /** Candidate loads pulled from DAT board or other source */
  candidateLoads: Load[];
  /** Currently executing load, if any. Shifts driver position to delivery point. */
  activeLoad?: ActiveLoadExecution;
  /** ISO datetime string of current time — injectable for deterministic testing */
  now: string;
}
