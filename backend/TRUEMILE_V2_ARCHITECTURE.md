# TrueMile V2 Architecture Spec

**Status:** Post-shadow-testing build plan  
**Version:** 1.0  
**Prerequisites:** MVP shadow testing complete, match rate baseline established  
**DAT API dependency:** Phase 3 cannot start until DAT API access is approved (~10 business days from application)

---

## 1. What This Document Is

This spec defines the V2 architecture for TrueMile after MVP shadow testing validates the current engine. It is not a rewrite plan. It is a staged evolution from a static seed-market ranking engine toward a live-market-aware cycle utility optimizer.

**Do not start building V2 before:**
- Shadow testing is complete against real Royal Carriers loads
- A match rate baseline exists
- Disagreement patterns are understood
- DAT API access is confirmed

---

## 2. What Stays From MVP

These parts of the current engine are worth preserving as the foundation:

| Component | Status |
|---|---|
| Deterministic synchronous ranking engine | Keep as-is |
| Constraint-first hard reject architecture | Keep as-is |
| `reasons[]` explainability layer | Keep, extend in V2 |
| Shadow-mode persistence (DispatchRun / DispatchDecision) | Keep, expand when needed |
| Stateless request/response pattern | Keep as-is |
| `fixedCostPerDay` + `variableCPM` cost aggregation | Keep for now, replace in V2 |
| Seed market table | Keep for shadow testing, replace in Phase 3 |

---

## 3. V2 North Star

V2 optimizes **cycle utility**, not single-load attractiveness.

The core insight: a load with higher raw profit is not always better if it consumes too much cycle time, creates excessive deadhead, ends in a weak reload market, or increases home-time miss risk.

### V2 Objective Function

```
cycleUtility = (expectedCycleProfit / daysConsumed)
               × loadedMileRatio
               × marketConfidence
               - penalties
```

**Why multiplicative, not additive:**  
A low-confidence market projection should scale down the entire projection, not just subtract a flat dollar amount. Additive penalties let uncertain projections dominate the score. Multiplicative confidence degrades the whole estimate proportionally.

**Component definitions:**
- `expectedCycleProfit` — revenue minus all cost classes across the projected cycle
- `daysConsumed` — loaded transit days + dwell days + deadhead days (not just driving days)
- `loadedMileRatio` — loaded miles / total miles (penalizes excessive empty repositioning)
- `marketConfidence` — composite of data freshness, source quality, market sparsity
- `penalties` — reload risk, home-time miss risk, route volatility, uncertainty

**Why profit-per-day, not total profit:**

```
Load A: $2,800 over 4 days = $700/day
Load B: $1,600 over 2 days = $800/day
```

Under a fixed cycle deadline, B is operationally superior. Total profit alone biases toward longer routes that crowd out better opportunities later in the cycle.

**Why empty miles are a separate term:**  
Profit-per-day can still be high with excessive deadhead. A route running 40% deadhead at $800/day is worse than a route running 5% deadhead at $780/day — the second route is better positioned for the next load and leaves less cost exposure. `loadedMileRatio` captures this separately.

---

## 4. V2 System Boundaries

### V2 Includes
- Structured extensible cost model
- Configurable driver schedule and home-time policy
- Live market snapshot layer (state → metro → lane-pair, staged)
- Missing-data handling with explicit confidence degradation
- Single-hop ranking using live market data
- Improved continuation projection (not full graph yet)
- Confidence-tagged `reasons[]`

### V2 Does Not Yet Include
- Full multi-hop route graph across all U.S. lanes
- Autonomous broker outreach
- Real-time booking
- Full accounting integrations as a hard dependency
- ML model retraining pipeline
- Deep TMS automation

---

## 5. Architectural Principles

**Keep compute separate from persistence.**  
The ranking engine stays pure and stateless. Persistence, logging, and analytics live outside the core compute layer.

**Separate hard truth from estimated truth.**  
The system must distinguish exact values from inferred values from estimated values — in market projections, timing feasibility, deadhead distance, and reload assumptions.

**Prefer staged realism over fake precision.**  
A coarse but explicit estimate is better than a precise-looking guess with hidden uncertainty.

**Preserve dispatcher trust.**  
Every major score component should be explainable: what is known, what is assumed, what is estimated, how confident the engine is.

**Build moat through data, not complexity theater.**  
The moat is better market data, better route-sequence logic, and better operational fit — not more formulas.

**Never silently degrade.**  
When deadhead, timing, market quality, or continuation confidence is low, surface it explicitly. Invisible degradation is worse than visible uncertainty.

---

## 6. V2 Core Components

### 6.1 Structured Cost Model

**Current problem:** One `fixedCostPerMonth` + one `variableCPM`. Too compressed for real fleet economics.

**V2 goal:** Extensible cost-item system where each item has a category, value, unit, and source.

#### Cost Categories

| Category | Examples |
|---|---|
| `FIXED_PERIODIC` | truck payment, trailer payment, insurance, ELD, compliance, office overhead |
| `VARIABLE_PER_MILE` | maintenance reserve, tires, driver CPM pay, fuel proxy |
| `VARIABLE_PER_LOAD` | per-load admin, dispatch fee, factoring minimums |
| `ROUTE_VARIABLE` | tolls, lane-specific fuel estimate, regional cost adjustments |
| `TIME_VARIABLE` | dwell burden, idle cost, detention risk proxy |
| `MANUAL_ADJUSTMENT` | user-defined catch-all items |

#### Engine Aggregation

At request time, the engine aggregates cost items into derived economics:
- `fixedCostPerDay` — sum of FIXED_PERIODIC / 30
- `variableCPMLoaded` — sum of VARIABLE_PER_MILE (loaded miles only)
- `variableCPMTotal` — sum of VARIABLE_PER_MILE (all miles including deadhead)
- `routeBurden` — sum of ROUTE_VARIABLE for this specific lane
- `timeBurden` — sum of TIME_VARIABLE × projected dwell days

#### Input Sources Over Time

| Source | When |
|---|---|
| Manual text entry in onboarding UI | V2 launch |
| Editable cost table in settings UI | V2 launch |
| PDF / doc upload parsed into candidate cost items (OCR + GPT-4o-mini, already in codebase) | V2 |
| TMS / accounting integrations | V3 |

**Rule:** Manual entry must always remain supported. Do not require integration to use the engine.

---

### 6.2 Driver / Schedule Architecture

**Current problem:** Schedule logic risks sprawling across flat Driver fields.

**V2 goal:** Four clean layers.

#### Layer A — Driver Master Profile
Stable identity and physical attributes. Changes rarely.
- driver ID, name
- trailer type compatibility
- home domicile (city/state/coords)
- default operating region
- carrier association

#### Layer B — Schedule / Home-Time Policy
Semi-stable preferences and constraints. Changes per conversation or weekly.
- target days out per cycle
- target days home
- max days out (hard)
- preferred home cadence
- preferred return geography
- hard vs soft home-time rules
- avoid-state policy

#### Layer C — Current Operational State
Frequently changing. Updated on every dispatch event.
- current location (lat/lon + timestamp)
- current cycle anchor date
- days remaining in cycle
- active load (if any)
- current availability window

#### Layer D — Temporary Overrides
Dispatch-time exceptions. Short-lived.
- willing to stay out longer this week
- temporary deadhead increase
- temporary avoid-state override
- special load exception

**Rule:** The engine consumes a normalized request shape. The backend should not force all logic into a single Driver record forever. Layers A and B live in DB. Layers C and D come in the request.

---

### 6.3 Location and Deadhead Modeling

**Current problem:** Missing coordinates silently default to zero deadhead — optimistically wrong.

**V2 fallback chain (in priority order):**

1. Exact lat/lon from load posting
2. ZIP centroid geocode
3. City/state centroid geocode
4. Market cluster centroid (conservative)
5. Conservative fallback distance + low-confidence flag

**V2 behavior:**
- Never silently assume zero deadhead unless origin matches current location exactly
- Apply `deadheadConfidence` penalty when fallback is used
- Expose in `reasons[]`:
  ```
  [estimated] Deadhead approximated from city/state centroid — verify origin
  Deadhead confidence: 0.45
  ```

**Bad centroid handling:**  
Ambiguous city names (Kansas City MO vs KS, Portland OR vs ME) must be flagged, not silently resolved. If geocoding returns ambiguous results, apply conservative fallback and flag it.

**Dispatcher UI:**  
Show `"deadhead estimated — verify origin"` as a visible warning on any load where deadhead confidence < 0.7.

---

### 6.4 Timing Uncertainty Model

**Current problem:** Missing pickup windows are treated as either hard-feasible or skipped entirely.

**V2 goal:** Missing timing reduces confidence without blocking ranking.

#### Timing Confidence States

| State | Definition | Engine behavior |
|---|---|---|
| `EXACT` | Full appointment window posted | Enforce feasibility check normally |
| `PARTIAL` | Pickup date known, no time window | Soft feasibility estimate, reduce confidence |
| `UNKNOWN` | No timing in posting | Skip hard feasibility check, apply uncertainty penalty |

**V2 reasons output:**
```
[inferred] Pickup timing missing — feasibility not guaranteed
Timing confidence: 0.30
```

**Rule:** Unknown timing should reduce confidence, not disappear from the model.

---

### 6.5 Market Data Layer

**Current problem:** 10-state seed table. Stale, coarse, not updatable.

**V2 goal:** Live market snapshots by origin/destination market, refreshed daily.

#### Staged Granularity Roadmap

**Stage A — State-to-state** *(V2 launch)*
- Small, simple, fast
- Acceptable transitional model
- Enables seed table replacement immediately
- Refresh: daily minimum
- Limitation: Dallas ≠ Houston, Atlanta ≠ Savannah

**Stage B — Metro / market cluster** *(V2 mid)*
- Groups cities into freight markets (DFW, ATL, CHI, etc.)
- Operationally meaningful for routing
- Manageable table size (~50-100 clusters)
- Refresh: daily

**Stage C — Lane-pair model** *(V2 late / V3 early)*
- Origin market → destination market economics
- Captures directional differences (TX→GA ≠ GA→TX)
- Required for real pair matching
- Refresh: daily, intraday for high-volume lanes
- Sparsity handling required for thin lanes

**Stage D — Route-sequence layer** *(V3)*
- Expected onward path quality from a destination
- Path confidence scoring
- Required for full multi-hop optimization

#### Minimum Viable V2 Snapshot Fields

```
origin_market       string
destination_market  string
avg_spot_rpm        decimal
load_to_truck_ratio decimal    -- tightness proxy
avg_dwell_days      decimal
expected_deadhead   integer    -- miles to next good load
snapshot_date       timestamp
source_mix          string[]   -- ['DAT', 'SONAR', 'TRUCKSTOP']
confidence_score    decimal    -- 0-1
freshness_hours     integer    -- hours since last update
```

#### Confidence / Freshness / Sparsity

- `confidence_score` degrades linearly with `freshness_hours`
- Sparse lanes (< N data points in window) get `confidence_score` floor of 0.3
- Engine must use `confidence_score` as a multiplier in cycle utility, not just a display field

#### Data Sources

| Source | Data type | Refresh |
|---|---|---|
| DAT Market Conditions API | spot RPM, load-to-truck ratio | Daily / intraday |
| Sonar (FreightWaves) | OTVI volume index, HAUL rate | Daily |
| Truckstop | spot rates, availability | Daily |
| Royal Carriers historical | carrier-specific actuals | Rolling 90 days |

**Note:** DAT API access pending approval. Phase 3 is blocked until this is confirmed. Sonar requires separate subscription evaluation.

**Fallback chain when live data unavailable:**  
Live cache → yesterday's snapshot → seed data with `confidence_score: 0.30` and `[seed data]` tag in reasons.

---

### 6.6 Continuation Logic

**Current problem:** All 3 continuation projections use the same destination state repeatedly. TX→GA projects GA→GA→GA.

**V2 immediate fix (before full route graph):**

For the destination of the first load:
1. Query the market snapshot for top outbound lanes from that destination
2. Project continuation load 2 using the best expected next lane
3. Project continuation load 3 using the best expected lane from continuation 2's destination
4. Apply confidence multiplier at each step

This gives TX→GA→TN→OH instead of TX→GA→GA→GA without requiring a full graph search.

**Still avoid in V2:**
- Full nationwide deep path search on every request
- Complex pathfinding before live data is trustworthy

---

### 6.7 Confidence Model

Every major estimated component should carry a confidence score.

#### Confidence Inputs

| Factor | Confidence degradation |
|---|---|
| Market data freshness | Linear decay per hour |
| Seed data fallback | Cap at 0.30 |
| Missing appointment timing | 0.30 |
| Estimated deadhead (centroid) | 0.45-0.65 |
| Estimated deadhead (fallback) | 0.20 |
| Projection depth (continuation load 3) | 0.70 × depth discount |

#### Composite Confidence

```
overallConfidence = min(
  marketConfidence,
  timingConfidence,
  locationConfidence
) weighted by component importance
```

#### Uses in Engine

- Multiplier in cycle utility objective
- Input to penalty calculations
- Display field in `reasons[]`
- Disagreement analysis later

---

### 6.8 Reasons / Explanation Model

**Current problem:** All reason lines presented with equal certainty.

**V2 reason shape:**

```typescript
interface Reason {
  type: 'exact' | 'inferred' | 'estimated';
  confidence: number;      // 0-1
  message: string;
  dataSource?: string;     // 'DAT_LIVE' | 'SONAR' | 'SEED' | 'ESTIMATED'
}
```

**Examples:**

```json
{
  "type": "exact",
  "confidence": 1.0,
  "message": "Effective RPM $2.84 — above target floor $1.81",
  "dataSource": "REQUEST"
}

{
  "type": "estimated",
  "confidence": 0.44,
  "message": "2 continuation loads projected from IL market",
  "dataSource": "SEED"
}

{
  "type": "inferred",
  "confidence": 0.81,
  "message": "3 continuation loads projected from GA market",
  "dataSource": "DAT_LIVE"
}
```

**Display rule:** Reason lines with `confidence < 0.6` should be visually distinguished in the dispatcher UI (dimmed, tagged, or marked estimated).

---

## 7. Constraint Strategy: Engine vs Upstream Search

Some constraints belong in both places.

| Constraint | Upstream filter | Engine check |
|---|---|---|
| Trailer type | Yes — DAT search filter | Yes — safety net |
| Deadhead radius | Yes — DAT search radius | Yes — exact calc |
| Avoid states | Yes — DAT lane filter | Yes — safety net |
| RPM floor | No | Yes — hard reject |
| Home-time feasibility | No | Yes — hard reject |
| Pickup timing | No | Yes — when data present |
| Load volume / weight | Yes — equipment filter | Optional |

**Rule:** Search filters reduce noise. Engine checks protect truth. Upstream filtering does not eliminate engine-side enforcement.

---

## 8. Computational Strategy

### Why This Matters

Route-sequence planning can explode combinatorially without pruning.

**Rough scale problem:**  
200 candidate first-leg loads × 50 destination markets × 50³ continuation paths = 25M+ paths for 3-hop lookahead. Naive DFS is not viable at dispatch speed.

### V2 Pruning Strategy

Apply in order:

1. **Beam width limit** — keep top N paths at each hop (N=10 for V2)
2. **Cycle deadline pruning** — drop paths that exceed remaining cycle days
3. **Weak lane pre-filtering** — drop destination markets with `confidence_score < 0.3` or `avg_spot_rpm < survivalFloor`
4. **Confidence-aware pruning** — discount paths where compound confidence falls below threshold
5. **Marginal value stopping** — stop extending a path when expected continuation adds less than X per day

### Precompute vs On-Demand

| Component | Strategy |
|---|---|
| Top outbound lanes per market | Precompute nightly |
| Market node rankings | Precompute nightly |
| Daily market snapshots | Precompute via ingestion job |
| Confidence / sparsity summaries | Precompute nightly |
| Driver-specific utility score | On-demand per request |
| Cycle state | On-demand per request |
| Route selection from current state | On-demand per request |

**Gap handling:** If nightly precompute hasn't run yet when a request arrives, fall back to previous day's cache → seed data with confidence flag. Never block a dispatch request on a missing background job.

---

## 9. Phased Implementation Roadmap

### Phase 1 — Shadow Testing *(Now)*
**Goal:** Validate current engine against real dispatch decisions.

**Deliverables:**
- Run 20-50 loads through debug UI
- Record actual dispatch choices via `/decision` endpoint
- Establish match rate baseline
- Inspect `engineOutput` JSON on non-matching runs
- Document systematic disagreement patterns

**Do not start Phase 2 until:**
- Match rate baseline is established
- At least 3-5 disagreement cases are understood

---

### Phase 2 — Architecture Lock *(After Phase 1)*
**Goal:** Finalize V2 design before any code changes.

**Deliverables:**
- Approved V2 architecture (this document, reviewed)
- System boundary decisions made
- Data dependency map confirmed
- DAT API access status confirmed
- Phasing decision: which V2 components ship together

---

### Phase 3 — Live Market Data Foundation *(Blocked on DAT API)*
**Goal:** Replace seed table with real market snapshots.

**Prerequisite:** DAT API access confirmed.

**Deliverables:**
- `MarketSnapshot` schema (Stage A: state-to-state)
- Daily ingestion job (DAT → normalize → store)
- Source normalization layer
- Confidence / freshness scoring
- Market provider abstraction backed by real data
- Fallback chain: live → yesterday → seed with flag

---

### Phase 4 — Recalibrated Single-Hop on Live Data
**Goal:** Run existing ranking architecture on live market data.

**Deliverables:**
- Live market-backed continuation estimates
- Improved confidence modeling
- Updated shadow testing with real data
- New match rate measurement
- Reasons tags showing data source (`DAT_LIVE` vs `SEED`)

---

### Phase 5 — Structured Cost Model + Schedule Policy
**Goal:** Replace flat cost blobs with extensible cost-item model and proper schedule separation.

**Deliverables:**
- `CostProfile` table with cost categories
- Cost aggregation in engine
- Driver schedule / home-time policy layer (separate from master profile)
- Manual entry UI for cost items
- PDF parsing integration for cost extraction

---

### Phase 6 — Improved Continuation Logic
**Goal:** Move from repeated same-state projection to forward-aware continuation.

**Deliverables:**
- Destination-aware next-leg modeling using market snapshot
- TX→GA→TN→OH projection instead of TX→GA→GA→GA
- Uncertainty propagation through continuation chain
- Stronger route-sequence economics without full graph

---

### Phase 7 — Multi-Hop Route Utility Engine *(The Moat)*
**Goal:** Bounded route-sequence optimization with pruned path search.

**Deliverables:**
- Limited-depth beam search (3-4 hops)
- Cycle-utility objective function replacing raw score
- Pruning strategy (beam width, deadline, confidence)
- Homebound / preferred-region path weighting
- Precomputed market node rankings used as graph edges
- Full route explanation in `reasons[]`

---

## 10. Biggest Risks to Avoid

**Fake precision.**  
Do not present estimated continuation projections like exact truths. Seed data dressed up as a $2,234 score is a confident lie.

**Premature graph complexity.**  
Do not build path search before live market data is reliable. A route graph on seed data produces impressive-looking wrong answers.

**Driver model sprawl.**  
Do not let every mutable scheduling preference accumulate as flat fields on the Driver record. Apply the four-layer separation from section 6.2.

**Cost model under-investment.**  
The current flat model is acceptable for shadow testing. It will not survive onboarding real carriers with different cost structures. Build the extensible model in Phase 5, not later.

**Silent degradation.**  
When deadhead, timing, market quality, or continuation confidence is low — surface it. Invisible fallbacks erode dispatcher trust over time.

**Architecture drift.**  
The state-to-state MarketSnapshot is a transitional model, not the destination. Document this explicitly so it doesn't become permanent by accident.

**Objective function mismatch.**  
Optimizing total cycle profit instead of profit-per-day biases toward longer routes that crowd out better opportunities. The V2 objective must be time-aware from the start.

---

## 11. Open Questions to Resolve Before Phase 3

1. **Minimum market granularity for V2 launch:** state-to-state, or go directly to metro clusters?
2. **Confidence scoring formula:** what are the exact weights for freshness, sparsity, source quality?
3. **Cost categories for V2 onboarding:** which line items matter enough to require at launch vs optional?
4. **Continuation logic depth:** one-step improved projection, or 2-hop beam search in Phase 6?
5. **Match rate threshold:** what agreement rate is sufficient before expanding to Phase 5+?
6. **Sonar access:** subscription evaluation needed before Phase 3 data architecture is finalized.

---

## 12. The Moat

TrueMile's competitive moat is not a more complex formula.

It is:
- **Better market data** than any dispatcher has access to manually
- **Better route-sequence intelligence** that evaluates multi-hop paths, not single loads
- **Better confidence-aware economics** that surface uncertainty instead of hiding it
- **Better operational fit** to how small OTR fleets actually run — cycle-constrained, home-time-aware, relationship-dependent

The current MVP proves the concept.  
Live market data makes it trustworthy.  
Multi-hop route optimization makes it the moat.

