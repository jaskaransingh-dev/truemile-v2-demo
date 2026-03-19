/**
 * execution-timing.ts
 *
 * Deterministic execution timing layer.
 * Answers: "Given the truck's current situation, can it physically make the next pickup?"
 *
 * Pipeline:
 *   currentDeliveryDateTime
 *   + receiverUnloadBuffer      (default hours, optional facility override)
 *   + repositionDriveTime       (receiver → next shipper, miles / avgRoadSpeedMph)
 *   + pickupSafetyBuffer        (30–60 min operational pad)
 *   = earliestPickupReadyAt
 *
 *   Compare to: nextLoad.pickupWindowStart / pickupWindowEnd / pickupDate
 *
 * MVP 1: deterministic assumptions — default buffers, haversine-derived drive time.
 * MVP 1.5: per-facility overrides from a seed table.
 * MVP 2: learned facility dwell from parsed rate con check-in/check-out timestamps.
 *
 * Pure functions. No I/O. All state injected.
 * Never throws from top-level evaluators — returns structured infeasible result instead.
 */

import type { Location, ActiveLoadExecution } from '../../types/constraint.types';
import { calculateDistance } from './load-metrics';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecutionTimingConfig {
  /**
   * Default hours truck is detained at receiver waiting for unload.
   * Real-world dry van average: 2–3 hours.
   */
  defaultReceiverUnloadHours: number;
  /**
   * Default hours truck waits at shipper during loading.
   * Used for cycle timing projections, not for next-load feasibility check.
   */
  defaultShipperLoadHours: number;
  /**
   * Average over-road speed in mph for reposition legs.
   * Use ~45–50 mph to account for traffic, stops, HOS compliance.
   * Must be > 0.
   */
  averageRoadSpeedMph: number;
  /**
   * Safety buffer added to earliestPickupReadyAt before comparing to pickup window.
   * Absorbs minor delays: fuel stop, inspection, HOS micro-break.
   * Recommended: 0.5–1.0 hours.
   */
  pickupSafetyBufferHours: number;
  /**
   * Per-facility overrides. Key = buildFacilityKey(location) → "city_state".
   * Populated manually in v1, learned from rate con timestamps in v2.
   */
  facilityOverrides?: Record<string, FacilityProfile>;
}

export interface FacilityProfile {
  facilityId: string;
  unloadHours?: number;
  loadHours?: number;
  notes?: string;
}

export interface ExecutionTimingResult {
  unloadCompleteAt: Date;
  repositionMiles: number;
  repositionHours: number;
  earliestPickupReadyAt: Date;
  pickupWindowStart: Date;
  pickupWindowEnd: Date;
  /** True if earliestPickupReadyAt <= pickupWindowEnd */
  canMakePickup: boolean;
  /** Minutes of slack. Negative = missed window. Positive = arrived early. */
  slackMinutes: number;
  /** Whether haversine coords were available for precise reposition calculation */
  usedCoordinates: boolean;
  unloadHoursUsed: number;
  /**
   * Set if inputs were invalid and computation was short-circuited.
   * When set, canMakePickup is always false and timing fields hold sentinel values.
   */
  invalidReason?: string;
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Computes whether a truck mid-delivery can make the next load's pickup window.
 * Timeline starts from activeLoad.deliveryDateTime.
 * Never throws — returns structured infeasible result on bad inputs.
 */
export function computeExecutionTiming(
  activeLoad: ActiveLoadExecution,
  nextLoadOrigin: Location,
  pickupWindowStart: Date,
  pickupWindowEnd: Date,
  config: ExecutionTimingConfig,
  nowMs: number = Date.now(),
): ExecutionTimingResult {
  const configError = validateConfig(config);
  if (configError) return infeasibleResult(pickupWindowStart, pickupWindowEnd, configError);

  const windowError = validatePickupWindow(pickupWindowStart, pickupWindowEnd);
  if (windowError) return infeasibleResult(pickupWindowStart, pickupWindowEnd, windowError);

  const deliveryMs = Date.parse(activeLoad.deliveryDateTime);
  if (isNaN(deliveryMs)) {
    return infeasibleResult(
      pickupWindowStart,
      pickupWindowEnd,
      `Invalid active load delivery datetime: "${activeLoad.deliveryDateTime}"`,
    );
  }

  const deliveryDt = new Date(deliveryMs);
  // If delivery is already past, use now as baseline (truck is already at receiver)
  const effectiveDeliveryAt = deliveryDt.getTime() < nowMs ? new Date(nowMs) : deliveryDt;

  const receiverKey = buildFacilityKey(activeLoad.destination);
  const facilityProfile = config.facilityOverrides?.[receiverKey];
  const unloadHours = facilityProfile?.unloadHours ?? config.defaultReceiverUnloadHours;

  const unloadCompleteAt = addHours(effectiveDeliveryAt, unloadHours);

  const { repositionMiles, repositionHours, usedCoordinates } = computeRepositionLeg(
    activeLoad.destination,
    nextLoadOrigin,
    config.averageRoadSpeedMph,
  );

  const earliestPickupReadyAt = addHours(
    unloadCompleteAt,
    repositionHours + config.pickupSafetyBufferHours,
  );

  const canMakePickup = earliestPickupReadyAt <= pickupWindowEnd;
  const slackMinutes =
    (pickupWindowEnd.getTime() - earliestPickupReadyAt.getTime()) / (1000 * 60);

  return {
    unloadCompleteAt,
    repositionMiles,
    repositionHours,
    earliestPickupReadyAt,
    pickupWindowStart,
    pickupWindowEnd,
    canMakePickup,
    slackMinutes,
    usedCoordinates,
    unloadHoursUsed: unloadHours,
  };
}

/**
 * Computes timing when truck is already free at currentLocation (no active load).
 * Used for first load of a cycle or post-home-time dispatch.
 * Never throws — returns structured infeasible result on bad inputs.
 */
export function computeFirstLoadTiming(
  currentLocation: Location,
  availableAt: Date,
  nextLoadOrigin: Location,
  pickupWindowStart: Date,
  pickupWindowEnd: Date,
  config: ExecutionTimingConfig,
  nowMs: number = Date.now(),
): ExecutionTimingResult {
  const configError = validateConfig(config);
  if (configError) return infeasibleResult(pickupWindowStart, pickupWindowEnd, configError);

  const windowError = validatePickupWindow(pickupWindowStart, pickupWindowEnd);
  if (windowError) return infeasibleResult(pickupWindowStart, pickupWindowEnd, windowError);

  if (isNaN(availableAt.getTime())) {
    return infeasibleResult(pickupWindowStart, pickupWindowEnd, 'Invalid availableAt date');
  }

  const effectiveAvailableAt =
    availableAt.getTime() < nowMs ? new Date(nowMs) : availableAt;

  const { repositionMiles, repositionHours, usedCoordinates } = computeRepositionLeg(
    currentLocation,
    nextLoadOrigin,
    config.averageRoadSpeedMph,
  );

  const earliestPickupReadyAt = addHours(
    effectiveAvailableAt,
    repositionHours + config.pickupSafetyBufferHours,
  );

  const canMakePickup = earliestPickupReadyAt <= pickupWindowEnd;
  const slackMinutes =
    (pickupWindowEnd.getTime() - earliestPickupReadyAt.getTime()) / (1000 * 60);

  return {
    unloadCompleteAt: effectiveAvailableAt,
    repositionMiles,
    repositionHours,
    earliestPickupReadyAt,
    pickupWindowStart,
    pickupWindowEnd,
    canMakePickup,
    slackMinutes,
    usedCoordinates,
    unloadHoursUsed: 0,
  };
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

function validateConfig(config: ExecutionTimingConfig): string | null {
  if (config.averageRoadSpeedMph <= 0) {
    return `averageRoadSpeedMph must be > 0 (got ${config.averageRoadSpeedMph})`;
  }
  return null;
}

function validatePickupWindow(start: Date, end: Date): string | null {
  if (isNaN(start.getTime())) return 'Invalid candidate load pickup window start date';
  if (isNaN(end.getTime())) return 'Invalid candidate load pickup window end date';
  if (end < start) {
    return `Pickup window end (${end.toISOString()}) is before window start (${start.toISOString()})`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function computeRepositionLeg(
  from: Location,
  to: Location,
  avgRoadSpeedMph: number,
): { repositionMiles: number; repositionHours: number; usedCoordinates: boolean } {
  const hasCoords =
    from.lat != null && from.lon != null && to.lat != null && to.lon != null;

  if (hasCoords) {
    const repositionMiles = calculateDistance(from.lat!, from.lon!, to.lat!, to.lon!);
    const repositionHours = repositionMiles / avgRoadSpeedMph;
    return { repositionMiles, repositionHours, usedCoordinates: true };
  }

  // No coords → 0 reposition miles. Conservative pass.
  // usedCoordinates=false surfaces as a warning in dispatcher UI.
  return { repositionMiles: 0, repositionHours: 0, usedCoordinates: false };
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function infeasibleResult(
  pickupWindowStart: Date,
  pickupWindowEnd: Date,
  reason: string,
): ExecutionTimingResult {
  const sentinel = new Date(0);
  return {
    unloadCompleteAt: sentinel,
    repositionMiles: 0,
    repositionHours: 0,
    earliestPickupReadyAt: sentinel,
    pickupWindowStart,
    pickupWindowEnd,
    canMakePickup: false,
    slackMinutes: -Infinity,
    usedCoordinates: false,
    unloadHoursUsed: 0,
    invalidReason: reason,
  };
}

// ---------------------------------------------------------------------------
// Exported utilities
// ---------------------------------------------------------------------------

/**
 * Normalizes a location into a facility lookup key.
 * Example: { city: "Memphis", state: "TN" } → "memphis_tn"
 */
export function buildFacilityKey(location: Location): string {
  return `${location.city.toLowerCase().replace(/\s+/g, '_')}_${location.state.toLowerCase()}`;
}

/**
 * Resolves pickup window from a load's raw date fields.
 * Priority: explicit start+end > start only (4h window) > date-only (06:00–20:00 UTC).
 * Returns [windowStart, windowEnd].
 */
export function resolvePickupWindow(
  pickupWindowStart?: string,
  pickupWindowEnd?: string,
  pickupDate?: string,
): [Date, Date] {
  if (pickupWindowStart && pickupWindowEnd) {
    return [new Date(pickupWindowStart), new Date(pickupWindowEnd)];
  }

  if (pickupWindowStart) {
    const start = new Date(pickupWindowStart);
    const end = new Date(start.getTime() + 4 * 60 * 60 * 1000);
    return [start, end];
  }

  if (pickupDate) {
    const start = new Date(`${pickupDate}T06:00:00Z`);
    const end = new Date(`${pickupDate}T20:00:00Z`);
    return [start, end];
  }

  // No date — far-future window, passes feasibility. Data quality issue for UI to surface.
  const fallback = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  return [fallback, new Date(fallback.getTime() + 14 * 60 * 60 * 1000)];
}
