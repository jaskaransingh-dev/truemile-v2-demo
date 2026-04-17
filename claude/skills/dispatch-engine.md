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
  targetRPM: number,             // used in dailyRevenueScore: targetDailyRevenue = targetRPM × avgDailyMiles
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
  deliveryDate?: string,         // ISO datetime — used in deliveryScore; inferred from pickupDate if absent
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
| `HOME_TIME_EXCEEDED` | After delivery + transit home, driver would miss `cycleEndDate`. Transit uses `avgDailyMiles × 1.15` buffer. |
| `BELOW_MIN_RPM` | `effectiveRPM < driver.minEffectiveRPM` — evaluated after home-time check, before scoring |

Rejected loads are returned separately as `RejectedLoad[]` with `violationCode` attached.
They do not appear in the ranked output.

---

## Scoring — Weighted Composite

All sub-scores are 0–1, 3 decimal places. Final score is 0–1.

```
// When deliveryScoreAvailable = true (deliveryDate or deliveryDeadline present):
score = netProfitScore    × 0.35
      + dailyRevenueScore × 0.20
      + destinationScore  × 0.20
      + cycleFitScore     × 0.15
      + deliveryScore     × 0.10

// When deliveryScoreAvailable = false (both absent/empty — weight redistributed):
score = netProfitScore    × 0.389
      + dailyRevenueScore × 0.222
      + destinationScore  × 0.222
      + cycleFitScore     × 0.167
```

`revenueScore` is NOT in the weighted sum. It is a hard gate — loads that fail it are
rejected as `BELOW_MIN_RPM` before scoring begins. See Hard Reject Logic above.

### Sub-score Definitions

**effectiveRPM** (derived, display only — not a scoring component)
```
effectiveRPM = rate / (miles + deadheadMiles)
```

**revenueScore** — hard gate (display only on output, always 1 for scored loads)
```
if effectiveRPM < minEffectiveRPM → reject with BELOW_MIN_RPM
// revenueScore = 1 on all RankedLoad output (hard gate already passed)
```

**netProfitScore** (primary economic signal — two-pass relative normalization)
```
// Pass 1 (inside loop): compute raw netProfit per load
totalMiles    = miles + deadheadMiles
variableCPM   = body.driver.variableCPM ?? (minEffectiveRPM × 0.85)
factoringRate = body.driver.factoringRate ?? 0.018
estCost       = (totalMiles × variableCPM) + (rate × factoringRate)
netProfit     = rate − estCost
// netProfitScore = 0 (placeholder); score = 0 (placeholder)

// Pass 2 (after loop, before sort): normalize relative to best load
maxNetProfit  = max(netProfit across all scored loads)
netProfitScore = netProfit > 0 ? max(netProfit / maxNetProfit, 0) : 0
// Best load in set scores 1.0; all others scale proportionally.
// variableCPM and factoringRate not yet persisted in DB — request body only (Phase 5)
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

**dailyRevenueScore**
```
loadDays          = max(load.miles / driver.avgDailyMiles, 0.5)
revenuePerDay     = load.rate / loadDays
dailyCeiling      = driver.minEffectiveRPM × driver.avgDailyMiles × 2.5
dailyRevenueScore = min(revenuePerDay / dailyCeiling, 1.0)
// Ceiling = 2.5× survival-floor daily revenue. Loads at or above ceiling score 1.0.
// loadDays floored at 0.5 to prevent very short loads from inflating score.
// targetRPM is NOT used here — normalization is against minEffectiveRPM.
```

**deliveryScore** — day utilization model
```
// deliveryScoreAvailable = true when load.deliveryDeadline OR load.deliveryDate is non-empty.
// When false: deliveryScore excluded from sum, 0.10 weight redistributed to other 4 dims.
//
// When available:
//   Reads load.deliveryDeadline (full ISO) if present, else load.deliveryDate.
//   Business window: 05:00–20:00 (15 usable hours).
//     delivery >= 20:00 → roll to next day 05:00 (0 hours usable today)
//     delivery < 05:00  → snap to 05:00 same day (full 15h usable)
//     delivery 05:00–19:59 → use actual time
//   remainingHours = max(0, businessEnd - effectiveStart) in hours
//   rawUtilization = remainingHours / 15
//   deliveryScore  = min(1, max(0, rawUtilization ^ 1.8))
//   Exponential decay (^1.8) penalizes late-day deliveries steeply.
```
**Phase 6 target:** replace with full continuation value model (destination market strength
for next load + avg reload dwell time per city + multi-hop continuation revenue).

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
  destinationMCI: number,            // raw outbound MCI from MarketSnapshot (-100 to +100)
  capacityLabel: string,             // e.g. 'Very Tight', 'Tight', 'Neutral', 'Loose', 'Very Loose'
  marketStrength: number,            // normalized: (destinationMCI + 100) / 200 → 0–1
  mciProxy: boolean,                 // true when no exact city match — nearest proxy used
  mciProxyCity: string | null,       // proxy city name (null when exact match)
  mciProxyState: string | null,      // proxy city state (null when exact match)
  mciProxyDistanceMiles: number | null, // haversine miles to proxy city (null when exact match)

  // Score breakdown (each 0–1, except dollar fields)
  effectiveRPM: number,       // display only — not a scoring component
  revenueScore: number,       // always 1 (hard gate already passed)
  netProfitScore: number,     // 0–1
  netProfit: number,          // $ — rate minus estimated cost
  estCost: number,            // $ — (totalMiles × variableCPM) + (rate × factoringRate)
  destinationScore: number,
  cycleFitScore: number,
  dailyRevenueScore: number,
  revenuePerDay: number,      // load.rate / transitDays — display only
  deliveryScore: number,
  deliveryScoreAvailable: boolean, // false when deliveryDate and deliveryDeadline both absent — weight redistributed
  inferredDelivery: boolean,  // true when deliveryDate was absent and inferred from pickupDate + buffered transit
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

### MCI Lookup — Nearest-City Proxy Fallback

When a destination city has no exact MarketSnapshot row, the engine falls back to the nearest city that does have a row, up to `MAX_PROXY_DISTANCE_MI = 300` miles.

**Two-pass lookup (batch, before scoring begins):**
```
Pass A: exact match — prisma.marketSnapshot.findFirst({ city, state, equipment_type })
        → runs in parallel for all unique destination cities

Pass B (for misses only):
  1. Fetch all MarketSnapshot rows for this equipment_type at the most recent valid_date (one query)
  2. For each missed destination, resolve lat/lon:
       - prefer load.destination.lat/lon if present
       - fall back to CITY_COORDS["CityName-STATE"] hardcoded map
  3. Haversine distance from destination to each candidate city in allRows
  4. Pick closest within 300 miles → use its outbound_mci / capacity_label as proxy
  5. If nothing within 300 miles → default outbound_mci = 0, capacity_label = 'Neutral'
```

**Proxy fields on RankedLoad output:**
```typescript
mciProxy:              boolean      // true when proxy city was used
mciProxyCity:          string|null  // name of proxy city
mciProxyState:         string|null  // state of proxy city
mciProxyDistanceMiles: number|null  // haversine distance to proxy city (rounded)
```

`mciProxy = false` and all proxy fields `null` when exact match found or default fallback used.

**`CITY_COORDS` map** is hardcoded in `decision-engine-v2.ts` (50 common freight cities).
Key format: `"CityName-STATE"` — must match `MarketSnapshot.city` and `MarketSnapshot.state` exactly.

---

## What's Not Done Yet

| Phase | Item |
|---|---|
| Phase 5 | `variableCPM` and `factoringRate` not yet persisted per-carrier in DB. Passed via request body (`body.driver.variableCPM`, `body.driver.factoringRate`). Falls back to `minEffectiveRPM × 0.85` and `0.018` respectively when absent. |
| Phase 6 | Full continuation value model — `deliveryScore` currently measures day utilization only. Replace with destination market strength for next load + avg reload dwell time per city + next-leg revenue estimate using MarketSnapshot. |

---

## What NOT To Do

- Do not add `reasons[]` to V2 — that's V1 only
- Do not update `decision-engine.ts` or `route-sequencer.ts` — they are stale
- Do not update `/rank-routes` — it calls the stale engine and is not under active development
- Do not compute `cycleEndDate` client-side — always derived server-side
- Do not default missing deadhead to 0 — surface it explicitly or reject the load
- Do not treat `revenueScore = 0` as a soft signal — it is a binary gate on minEffectiveRPM
- Do not change score weights without updating this doc


## Pickup Sequencing (V2 Scheduler Concern)
When chaining loads, the scheduler must set:
  now = deliveryTime + 2hrs + deadheadToNextOrigin
This ensures PICKUP_WINDOW_EXPIRED and PICKUP_UNREACHABLE correctly 
filter loads the driver cannot physically reach after the prior delivery.
The single-load engine does not need to know about prior loads.