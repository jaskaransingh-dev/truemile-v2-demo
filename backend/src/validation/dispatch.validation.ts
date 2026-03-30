/**
 * dispatch.validation.ts
 *
 * Manual validation for POST /api/dispatch/rank-loads.
 * No external schema library — plain TypeScript guards.
 */

import type { TrailerType, Location } from '../types/constraint.types';

// ---------------------------------------------------------------------------
// Request shape (what the HTTP client sends)
// ---------------------------------------------------------------------------

export interface DriverInput {
  currentLocation: Location;
  homeLocation: Location;
  trailerType: TrailerType;
  cycleDays?: number;
  homeDays?: number;
  maxDeadheadMiles?: number;
  minEffectiveRPM?: number;
  survivalMarginPercent?: number;
  preferredStates?: string[];
  avoidStates?: string[];
}

export interface CandidateLoadInput {
  externalId: string;
  origin: Location;
  destination: Location;
  rate: number;
  miles: number;
  trailerType: TrailerType;
  pickupDate?: string;
  deliveryDate?: string;
  pickupWindowStart?: string;
  pickupWindowEnd?: string;
  brokerName?: string;
  numberOfStops?: number;
}

export interface RankLoadsBody {
  driverId: string;
  cycleStartDate: string;
  driver: DriverInput;
  candidateLoads: CandidateLoadInput[];
}


// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isPositiveNumber(v: unknown): v is number {
  return typeof v === 'number' && isFinite(v) && v > 0;
}

function validateLocation(loc: unknown, path: string): string[] {
  const errs: string[] = [];
  if (!loc || typeof loc !== 'object') {
    errs.push(`${path}: must be an object with city and state`);
    return errs;
  }
  const l = loc as Record<string, unknown>;
  if (!isNonEmptyString(l.city)) errs.push(`${path}.city: required non-empty string`);
  if (!isNonEmptyString(l.state)) errs.push(`${path}.state: required non-empty string`);
  return errs;
}

function validateLoad(load: unknown, i: number): string[] {
  const path = `candidateLoads[${i}]`;
  const errs: string[] = [];
  if (!load || typeof load !== 'object') {
    errs.push(`${path}: must be an object`);
    return errs;
  }
  const l = load as Record<string, unknown>;
  if (!isNonEmptyString(l.externalId)) errs.push(`${path}.externalId: required non-empty string`);
  errs.push(...validateLocation(l.origin, `${path}.origin`));
  errs.push(...validateLocation(l.destination, `${path}.destination`));
  if (!isPositiveNumber(l.rate)) errs.push(`${path}.rate: must be a positive number`);
  if (!isPositiveNumber(l.miles)) errs.push(`${path}.miles: must be a positive number`);
  if (l.trailerType !== 'DRY_VAN' && l.trailerType !== 'REEFER' && l.trailerType !== 'FLATBED') {
    errs.push(`${path}.trailerType: must be 'DRY_VAN', 'REEFER', or 'FLATBED'`);
  }
  return errs;
}

// ---------------------------------------------------------------------------
// Main validator
// ---------------------------------------------------------------------------

/**
 * Returns null if the body is valid, or a human-readable error string if not.
 */
export function validateRankLoadsBody(body: unknown): string | null {
  const errs: string[] = [];

  if (!body || typeof body !== 'object') {
    return 'Request body must be a JSON object';
  }

  const b = body as Record<string, unknown>;

  if (!isNonEmptyString(b.driverId)) errs.push('driverId: required non-empty string');

  if (!isNonEmptyString(b.cycleStartDate)) {
    errs.push('cycleStartDate: required ISO date string');
  } else if (isNaN(Date.parse(b.cycleStartDate as string))) {
    errs.push('cycleStartDate: invalid date format');
  }

  if (!b.driver || typeof b.driver !== 'object') {
    errs.push('driver: must be an object');
  } else {
    const d = b.driver as Record<string, unknown>;
    errs.push(...validateLocation(d.currentLocation, 'driver.currentLocation'));
    errs.push(...validateLocation(d.homeLocation, 'driver.homeLocation'));
    if (d.trailerType !== 'DRY_VAN' && d.trailerType !== 'REEFER' && d.trailerType !== 'FLATBED') {
      errs.push("driver.trailerType: must be 'DRY_VAN', 'REEFER', or 'FLATBED'");
    }
  }

  if (!Array.isArray(b.candidateLoads)) {
    errs.push('candidateLoads: must be an array');
  } else if (b.candidateLoads.length === 0) {
    errs.push('candidateLoads: must contain at least one load');
  } else {
    b.candidateLoads.forEach((load, i) => errs.push(...validateLoad(load, i)));
  }

  return errs.length > 0 ? errs.join('; ') : null;
}
