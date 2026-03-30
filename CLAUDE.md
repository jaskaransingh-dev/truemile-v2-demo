# TrueMile — Project Context for AI Coding Sessions

## What This Is

TrueMile is an AI-native freight dispatch platform for OTR trucking carriers.
The MVP is a constraint-based AI dispatch engine: it ingests driver state + load candidates,
runs hard-reject filtering, ranks by cycle utility, and surfaces top loads to a dispatcher
for final approval. Royal Carriers (15 trucks, real revenue) is the live proof of concept.

This file is the source of truth for any AI coding session. Read it before touching any code.

---

## Repo Structure

```
/TrueMile
├── .claude/
│   └── settings.local.json
├── backend/           # Node.js + Express + TypeScript → deployed on Railway
│   └── src/
│       ├── routes/
│       ├── services/
│       │   └── dispatch/
│       │       ├── constraint-engine.ts
│       │       ├── decision-engine.ts
│       │       ├── decision-engine-v2.ts
│       │       ├── cycle-profit.ts
│       │       ├── cost-engine.ts
│       │       ├── load-metrics.ts
│       │       ├── market-projection.ts
│       │       ├── execution-timing.ts
│       │       ├── route-sequencer.ts
│       │       ├── driver-cycle.ts
│       │       ├── geocoder.ts
│       │       └── dat-ingest.service.ts
│       └── middleware/
├── frontend/          # React + TypeScript + Vite → deployed on Vercel
├── tools/
└── .env               # never commit
```

Monorepo. Frontend and backend in the same repo. Do not restructure this.

---

## Tech Stack

**Frontend:** React, TypeScript, Vite, Lucide React, Fetch API, inline CSS → Vercel  
**Backend:** Node.js, Express, TypeScript, Prisma ORM, pg (raw queries where needed) → Railway  
**Database:** PostgreSQL hosted on Supabase (Supabase Pooler for IPv4)  
**Auth:** Supabase Auth + Google OAuth + Microsoft Azure OAuth + JWT middleware  
**AI:** OpenAI GPT-4o-mini (load normalization, email gen, OCR parsing), Tesseract.js (OCR fallback)  
**External APIs:** Gmail API, Microsoft Graph API, Google Maps Distance Matrix API  
**File handling:** Multer, Busboy, csv-parse, XLSX, Sharp  
**Security:** cors, helmet, dotenv, bcrypt, jsonwebtoken  

---

## Dispatch Engine — Core Logic

### MVP Flow (Shadow Testing Phase)

```
Driver state + load candidates
→ Hard reject filter (7 conditions)
→ Decision engine (ranked output)
→ Approval gate (dispatcher confirms)
→ Log to DispatchRun / DispatchDecision
```

### Hard Reject Conditions (exclude load immediately if ANY are true)

1. Destination in driver's excluded city list
2. Broker credit score < 87
3. Rate not posted
4. Deadhead > 150 miles
5. 4+ drops indicated in comments
6. Team load specified (unless driver is team-capable)
7. Hazmat in comments

### Decision Engine Ranking (in priority order)

1. Home time constraint satisfied (HARD — if fails, reject)
2. Meets or exceeds revenue target per day (PRIMARY objective)
3. Destination city market strength (MCI score)
4. Cycle fit (early cycle = maximize outbound revenue; mid = balance; late = prioritize return feasibility)
5. Highest RPM
6. Earliest delivery appointment

### Scoring Engine Tie-Breaker (top 2 loads max)

1. Highest RPM
2. Weighted return: destination market strength × avg load rate / capacity
3. Earliest delivery

### decision-engine-v2 Scoring Formula

```
score = revenueScore×0.30 + destinationScore×0.25 + cycleFitScore×0.20 + rpmScore×0.15 + deliveryScore×0.10
```

Component definitions:
- `effectiveRPM` = `rate / (miles + deadheadMiles)` — **never use rate/miles alone**
- `revenueScore` = binary: `1` if `effectiveRPM >= minEffectiveRPM`, else `0`
- `destinationScore` = `marketStrength` = `(outbound_mci + 100) / 200` → 0 to 1
- `cycleFitScore` = blend of destinationScore + homewardBias weighted by cycle position
  - cyclePosition < 0.4 (early): reward strong outbound markets
  - cyclePosition 0.4–0.7 (mid): blend market + homeward bias
  - cyclePosition > 0.7 (late): prioritize getting home
- `rpmScore` = `min(effectiveRPM / targetRPM, 2.0) / 2.0`
- `deliveryScore` = `max(0, 1 - daysUntilDelivery / 14)`

Top 2 ranked loads get `urgentCall: true`. All others false.

### decision-engine-v2 Rejection Codes

All rejected loads are returned in `rejectedLoads[]` with `{ externalId, violationCode, message }`.

| Code | Trigger |
|---|---|
| `TRAILER_MISMATCH` | `load.trailerType` ≠ `driver.trailerType` (FLEX accepted by REEFER or DRY_VAN) |
| `AVOID_STATE` | `load.destination.state` is in `driver.avoidStates` |
| `PICKUP_WINDOW_EXPIRED` | `load.pickupWindowEnd` exists and is before `now` |
| `PICKUP_UNREACHABLE` | `pickupWindowEnd` is in the future but `deadheadMiles / avgDailyMiles > daysUntilWindowClose` |
| `HOME_TIME_EXCEEDED` | After delivery + transit home, driver misses `cycleEndDate` |

### cycleState Derivation (server-side — callers do not send this)

The route handler (`dispatch-dev.routes.ts`) derives cycle state from flat request fields:
```
anchorMs     = cycleStartDate + (completedCycles × (cycleDays + homeDays) days)
cycleEndDate = anchorMs + cycleDays + 12h grace
```
Callers only need to send: `cycleStartDate`, `driver.cycleDays` (default 17), `driver.homeDays` (default 3).

### Scheduler Logic

- Run at 7am CST on driver's emptying/loading day
- Refresh every 5 min for 30 min → pause if load booked
- If not run for 1 hour → stop
- If no load booked → re-run 1 hour before appt time OR when driver checks in at receiver
- Refresh every 3 min in that window, outreach on new loads only

### Cycle Fit Logic

- Early cycle → maximize outbound revenue
- Mid cycle → balance revenue + positioning
- Late cycle → prioritize return/home feasibility

---

## Data Models (Prisma)

### Driver (Layer A — stable identity)
- id (uuid), fullName, numericDriverId (optional), phoneNumber
- truckNumber, trailerNumber, trailerType (REEFER | DRY_VAN | FLATBED)
- homeBaseCity, homeBaseLat, homeBaseLon
- defaultOperatingRegion, carrierId
- createdAt, updatedAt

### DriverSchedulePolicy (Layer B — semi-stable preferences)
- driverId, targetDaysOut, targetDaysHome, maxDaysOut (hard)
- preferredHomeCadence, preferredReturnGeography
- homeTimeHard (boolean), avoidStates[]

### DriverOperationalState (Layer C — live, changes per dispatch event)
- driverId, currentLat, currentLon, currentLocationTimestamp
- cycleAnchorDate, daysRemainingInCycle
- activeLoadId (nullable), availabilityWindowStart

### DispatchSession
- id, driverId, contextJSON, createdAt

### LoadRecommendation
- id, driverId, loadJSON, constraintScore
- status (PENDING | APPROVED | REJECTED), createdAt

### BrokerContactLog
- id, loadId, brokerEmail, status, createdAt

### MarketSnapshot (99 cities × 3 equipment types — seed data, will be replaced by DAT API)
- origin, destination, equipmentType, avgRPM, mciScore, confidence, dataSource, snapshotDate

### DispatchRun / DispatchDecision (shadow mode persistence)
- For recording actual dispatch choices against engine recommendations

---

## API Endpoints

### Drivers
- POST /api/drivers
- GET /api/drivers
- PUT /api/drivers/:id
- DELETE /api/drivers/:id

### Dispatch
- POST /api/dispatch/chat — { driverId, message }
- POST /api/dispatch/ratecon — PDF upload via Multer
- GET /api/dispatch/recommendations
- POST /api/dispatch/approve/:id
- POST /api/dispatch/reject/:id
- POST /api/dispatch/rank-loads — core engine endpoint (currently allowed in local settings)
- POST /api/dispatch/negotiation-result — VAPI webhook (Phase 2)

### Dispatch Dev (test portal endpoints)
- POST /api/dev/dispatch/rank-loads-v2 — **active, use this** — decision-engine-v2, MCI scoring
- POST /api/dev/dispatch/rank-routes — stale, do not update, route-sequencer v1 only
- POST /api/dev/dispatch/rank-loads — stale v1 load ranking

---

## Services Map

| Service | File | Responsibility |
|---|---|---|
| Constraint engine | dispatch/constraint-engine.ts | Inputs driver state → outputs pickupRadius, destinationRegions, minRPM, maxDeadhead, mustBeInMarketByDate |
| Decision engine (MVP) | dispatch/decision-engine.ts | Hard reject + ranking, deterministic synchronous |
| Decision engine (V2) | dispatch/decision-engine-v2.ts | MCI-based load ranking — in active development |
| Cycle profit | dispatch/cycle-profit.ts | expectedCycleProfit calculation |
| Cost engine | dispatch/cost-engine.ts | Aggregates cost items into fixedCostPerDay, variableCPM, routeBurden |
| Load metrics | dispatch/load-metrics.ts | Per-load metric derivation (RPM, loaded mile ratio, etc.) |
| Market projection | dispatch/market-projection.ts | Continuation market estimates from MarketSnapshot |
| Execution timing | dispatch/execution-timing.ts | Delivery feasibility, days-consumed modeling |
| Route sequencer | dispatch/route-sequencer.ts | Multi-hop DFS — deprioritized, do not update. Called by `/rank-routes` in `dispatch-dev.routes.ts` which is stale and has NOT been updated to match V2 improvements (MCI scoring, new rejection codes). All active work is on `decision-engine-v2.ts` and `/rank-loads-v2` only. |
| Driver cycle | dispatch/driver-cycle.ts | Days remaining, cycle anchor, home-time window |
| Geocoder | dispatch/geocoder.ts | Coordinate resolution with fallback chain |
| DAT ingest | dispatch/dat-ingest.service.ts | DAT load board data ingestion (manual screenshot → Claude Vision interim) |

---

## V2 Architecture — Do Not Build Yet

V2 evolves the engine toward cycle utility optimization. Build order is gated on shadow testing.

**V2 objective function:**
```
cycleUtility = (expectedCycleProfit / daysConsumed) × loadedMileRatio × marketConfidence - penalties
```

**V2 phases (in order, each gated on prior completion):**
- Phase 1: Shadow testing against real Royal Carriers loads (NOW)
- Phase 2: Architecture lock — finalize V2 design
- Phase 3: Live market data (BLOCKED on DAT API access, ~10 business days)
- Phase 4: Recalibrated single-hop on live data
- Phase 5: Structured cost model + schedule policy (extensible cost-item system)
- Phase 6: Improved continuation logic (destination-aware next-leg modeling)
- Phase 7: Multi-hop route utility engine (beam search, 3-4 hops — the moat)

**Do not build Phase 3+ until:**
- Shadow testing complete (20-50 real loads)
- Match rate baseline established
- At least 3-5 disagreement patterns understood
- DAT API access confirmed

---

## Cost Model (Current — MVP)

Flat model for shadow testing only:
- `fixedCostPerDay` = fixedCostPerMonth / 30
- `variableCPM` = per-mile cost

Will be replaced in Phase 5 with extensible cost-item model (FIXED_PERIODIC, VARIABLE_PER_MILE, VARIABLE_PER_LOAD, ROUTE_VARIABLE, TIME_VARIABLE, MANUAL_ADJUSTMENT).

---

## Deadhead / Location Fallback Chain

Priority order for coordinate resolution:
1. Exact lat/lon from load posting
2. ZIP centroid geocode
3. City centroid geocode
4. State centroid (flag as low-confidence)
5. Missing → surface explicitly, do NOT default to zero

Zero deadhead is not a valid fallback. Missing data must be surfaced.

---

## Coding Rules

- Reuse existing auth middleware. Do not re-implement auth.
- Use Prisma for all DB operations. Raw pg only where Prisma cannot handle it.
- Keep services modular and stateless. No logic in route handlers.
- No heavy refactors. Build thin vertical slices.
- No overengineering. MVP first, then V2 phases.
- Do NOT touch GitHub — version control is handled manually.
- Never silently degrade. Surface missing data, low confidence, and fallbacks explicitly.
- `reasons[]` array applies to v1 (decision-engine.ts) only. V2 (decision-engine-v2.ts) returns raw numeric score dimensions instead — do NOT add reasons[] to v2 output.
- Separate hard truth from estimated truth in all scoring output.

---

## Environment

- Local dev: VS Code + Cline (implementation), Claude.ai browser (architecture)
- Backend runs locally at localhost:3000
- Test dispatch endpoint: `curl localhost:3000/api/dispatch/rank-loads`
- Railway logs for production debugging
- Chrome DevTools + Node.js debugger for local debugging
- CodeRabbit for PR review

---

## Active Work (update this section each session)

- [x] Decision engine v2 (`decision-engine-v2.ts`) — MCI-based load ranking, in active development
- [ ] **NOW: Shadow testing** — running real Royal Carriers loads through debug/portal HTML, recording actual vs engine decisions
- [ ] DAT iQ market data ingestion — manual screenshot → Claude Vision (interim, via `dat-ingest.service.ts`)
- [ ] DAT API integration — initiated, pending access (~10 business days)
- [ ] Truckstop API integration — initiated
- [ ] Driver onboarding module — Prisma model + UI table (not started)
- [ ] Broker outreach module — not started (post shadow testing)

---

## What NOT To Do

- Do not restructure the monorepo
- Do not build V2 multi-hop graph before shadow testing is complete
- Do not let Driver model accumulate all schedule preferences as flat fields (use 4-layer separation)
- Do not present seed-data estimates as exact values
- Do not block dispatch requests on missing background jobs — always fall back gracefully
- Do not optimize for total cycle profit instead of profit-per-day (biases toward longer routes)
