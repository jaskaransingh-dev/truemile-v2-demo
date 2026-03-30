# TrueMile Dispatch Engine — Technical Reference

## Scope

This document covers `decision-engine-v2.ts` and the `/rank-loads-v2` endpoint exclusively.
`decision-engine.ts` and `/rank-routes` are stale and not under active development.
Do not touch them. Do not port V2 improvements back to them.

---

## Active Endpoint

```
POST /rank-loads-v2
Defined in: dispatch-dev.routes.ts
Engine: decision-engine-v2.ts
```

---

## Request Shape

Callers send flat fields — the route handler derives cycle math server-side.

```typescript
{
  candidateLoads: CandidateLoad[],  // array of load candidates to rank — NOT 'loads'
  driver: {
    id: string,
    trailerType: 'DRY_VAN' | 'REEFER' | 'FLEX',
    avoidStates: string[],       // e.g. ['CA', 'OR']
    cycleDays: number,           // default 17
    homeDays: number,            // default 3
    avgDailyMiles: number,       // used for PICKUP_UNREACHABLE calc
  },
  cycleStartDate: string,        // ISO date string — cycle anchor
  completedCycles: number,       // used to compute current cycle anchor
  minEffectiveRPM: number,       // floor for revenueScore binary gate
  targetRPM: number,             // used in rpmScore normalization
}
```

### Cycle Math (derived server-side in dispatch-dev.routes.ts:129-136)

```typescript
anchorMs     = cycleStartDate + (completedCycles × (cycleDays + homeDays) days)
cycleEndDate = anchorMs + cycleDays days + 12h grace

// Passed to rankLoads() as:
{
  cycleStartDate: new Date(anchorMs),
  cycleEndDate,           // Date object
  totalCycleDays: cycleDays,
}
```

Callers never send `cycleEndDate` directly. It is always derived.

---

## CandidateLoad Shape

```typescript
{
  id: string,
  origin: { city: string, state: string, lat?: number, lon?: number },
  destination: { city: string, state: string, lat?: number, lon?: number },
  trailerType: 'DRY_VAN' | 'REEFER' | 'FLEX',
  rate: number,                  // total gross revenue
  miles: number,                 // loaded miles
  deadheadMiles: number,
  pickupWindowStart?: string,    // ISO datetime
  pickupWindowEnd?: string,      // ISO datetime — used in rejection checks
  deliveryDate?: string,         // ISO datetime — used in deliveryScore
}
```

---

## Hard Reject Logic

Evaluated before scoring. Any match → load is excluded from ranked output.

Rejection codes are a union type defined at `decision-engine-v2.ts:111`.

| Code | Trigger |
|---|---|
| `TRAILER_MISMATCH` | `load.trailerType !== driver.trailerType` — FLEX is accepted by both REEFER and DRY_VAN |
| `AVOID_STATE` | `load.destination.state` is in `driver.avoidStates` |
| `PICKUP_WINDOW_EXPIRED` | `pickupWindowEnd` exists and is in the past |
| `PICKUP_UNREACHABLE` | `pickupWindowEnd` is in the future but `deadheadMiles / driver.avgDailyMiles > daysUntilWindowClose` |
| `HOME_TIME_EXCEEDED` | After delivery + transit home, driver would miss `cycleEndDate` |

Rejected loads are returned separately as `RejectedLoad[]` with `violationCode` attached.
They do not appear in the ranked output.

---

## Scoring — Weighted Composite

All sub-scores are 0–1, 3 decimal places. Final score is 0–1.

```
score = revenueScore×0.30
      + destinationScore×0.25
      + cycleFitScore×0.20
      + rpmScore×0.15
      + deliveryScore×0.10
```

### Sub-score Definitions

**effectiveRPM** (derived, not a score component)
```
effectiveRPM = rate / (miles + deadheadMiles)
```

**revenueScore** — binary gate
```
revenueScore = effectiveRPM >= minEffectiveRPM ? 1 : 0
```

**destinationScore**
```
destinationScore = marketStrength
// marketStrength = (destinationMCI + 100) / 200  →  0–1
// destinationMCI from MarketSnapshot, defaults to 0 if no row → marketStrength = 0.5
```

**cycleFitScore** — blend of destination and homeward bias by cycle position
```
// Early cycle  → maximize outbound revenue (weight toward destinationScore)
// Mid cycle    → balance revenue + positioning
// Late cycle   → prioritize return/home feasibility (homeward bias dominant)
// Cycle position = daysElapsed / totalCycleDays
```

**rpmScore**
```
rpmScore = min(effectiveRPM / targetRPM, 2.0) / 2.0
// Caps at 1.0 when effectiveRPM = 2× targetRPM
```

**deliveryScore**
```
deliveryScore = max(0, 1 - daysUntilDelivery / 14)
// Peaks at 1.0 for same-day delivery, 0 at 14+ days out
```

---

## RankedLoad Response Shape

Each ranked load returns everything from `CandidateLoad` plus:

```typescript
{
  // Ranking
  rank: number,               // 1-based position
  score: number,              // weighted composite, 0–1, 3 decimal places
  urgentCall: boolean,        // true for rank 1 and 2

  // Market data
  destinationMCI: number,     // raw outbound MCI from MarketSnapshot (-100 to +100)
  capacityLabel: string,      // e.g. 'Very Tight', 'Tight', 'Neutral', 'Loose', 'Very Loose'
  marketStrength: number,     // normalized: (destinationMCI + 100) / 200 → 0–1

  // Score breakdown (each 0–1)
  effectiveRPM: number,
  revenueScore: number,
  destinationScore: number,
  cycleFitScore: number,
  rpmScore: number,
  deliveryScore: number,
}
```

**No `reasons[]` array.** That is a V1 concept. V2 returns raw numeric dimensions.
The portal renders them directly. Do not add reasons[] to V2.

---

## MCI / MarketSnapshot

### Table Structure

```sql
MarketSnapshot (
  origin_city    TEXT,
  origin_state   TEXT,
  equipment_type TEXT,   -- 'DRY_VAN' | 'REEFER' | 'FLATBED'
  outbound_mci   INTEGER,
  capacity_label TEXT,
  valid_date     DATE,
  data_source    TEXT    -- 'MANUAL' | 'DAT'
)
```

### Data Sources

| Source | How | `data_source` value |
|---|---|---|
| Seed script | `scripts/market_conditions_seed.sql` → `npm run seed:markets` | `'MANUAL'` |
| DAT ingest | `dat-ingest.service.ts` writes newer rows | `'DAT'` |
| Manual override | Direct DB insert with a newer `valid_date` | `'MANUAL'` |

### Override Mechanism

Query uses `ORDER BY valid_date DESC` — newest row wins automatically.
Insert a row with today's date to shadow any older row. No code change needed.

### Cold Start State

297 seed rows (99 cities × 3 equipment types), all `outbound_mci = 0`.
At cold start: `marketStrength = 0.5` for every destination → identical scores across all loads.
This is expected behavior, not a bug.

---

## What NOT To Do

- Do not add `reasons[]` to V2 — that's V1 only
- Do not update `decision-engine.ts` or `route-sequencer.ts` — they are stale
- Do not update `/rank-routes` — it calls the stale engine and is not under active development
- Do not compute `cycleEndDate` client-side — always derived server-side
- Do not default missing deadhead to 0 — surface it explicitly or reject the load
- Do not treat `revenueScore = 0` as a soft signal — it is a binary gate on minEffectiveRPM
- Do not change score weights without updating this doc
