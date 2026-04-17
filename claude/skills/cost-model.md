# TrueMile Cost Model — Technical Reference

## Two Cost Models — V1 and V2 Are Different

V1 (`/rank-loads`, `decision-engine.ts`) and V2 (`/rank-loads-v2`, `decision-engine-v2.ts`)
use entirely different cost inputs. Do not mix them.

---

## V1 Cost Model (dispatch.service.ts — stale engine)

### Input Shape

```typescript
body.costModel?: {
  fixedCostPerMonth?:     number   // default: 7050
  variableCPM?:           number   // default: 1.05
  survivalMarginPercent?: number   // default: 5
}
```

### Derivation (dispatch.service.ts:122-126)

```typescript
fixedCPM        = fixedCostPerMonth / (avgDailyMiles × 30)
trueCPM         = fixedCPM + variableCPM
fixedCostPerDay = fixedCostPerMonth / 30
targetRPMFloor  = trueCPM × (1 + survivalMarginPercent / 100)
```

### Where Values Live

- Hardcoded defaults in `dispatch.service.ts:29-31` — used when `body.costModel` is absent
- Caller can override by passing `costModel` in the request body
- No DB persistence — no per-carrier cost record exists anywhere
- Royal Carriers defaults: `fixedCostPerMonth: 7050`, `variableCPM: 1.05`, `survivalMarginPercent: 5`

**This cost model is V1 only. Do not reference it in V2 work.**

---

## V2 Cost Model (/rank-loads-v2 — active engine)

V2 does not use `costModel` at all. Cost is expressed as RPM floors passed directly on `body.driver`.

### Input Fields (from route handler)

```typescript
body.driver.minEffectiveRPM?: number   // default: 1.62
// targetRPM derived inline in route handler:
targetRPM = minEffectiveRPM × 1.15
```

### How They're Used

```typescript
// revenueScore — binary gate
revenueScore = effectiveRPM >= minEffectiveRPM ? 1 : 0

// rpmScore — normalized performance above floor
rpmScore = min(effectiveRPM / targetRPM, 2.0) / 2.0
```

`minEffectiveRPM` is the survival floor — loads below it score 0 on the revenue gate.
`targetRPM` is the performance target — loads at 2× target max out rpmScore at 1.0.

### No Per-Carrier DB Record

Cost values are not stored in the database. They live in:
1. Hardcoded defaults in the route handler
2. Request body override from the caller

This is a known gap. Per-carrier cost persistence is a Phase 5 deliverable.

---

## V2 Phase 5 — Extensible Cost Model (Do Not Build Yet)

Phase 5 replaces the flat RPM-floor approach with a structured cost-item system.
Build only after shadow testing is complete and DAT API access is confirmed.

### Planned Cost Categories

| Category | Examples |
|---|---|
| `FIXED_PERIODIC` | Truck payment, trailer payment, insurance, ELD, compliance, office overhead |
| `VARIABLE_PER_MILE` | Maintenance reserve, tires, driver CPM pay, fuel proxy |
| `VARIABLE_PER_LOAD` | Per-load admin, dispatch fee, factoring minimums |
| `ROUTE_VARIABLE` | Tolls, lane-specific fuel estimate, regional adjustments |
| `TIME_VARIABLE` | Dwell burden, idle cost, detention risk proxy |
| `MANUAL_ADJUSTMENT` | User-defined catch-all |

### Planned Engine Aggregation

```typescript
fixedCostPerDay    = sum(FIXED_PERIODIC) / 30
variableCPMLoaded  = sum(VARIABLE_PER_MILE)   // loaded miles only
variableCPMTotal   = sum(VARIABLE_PER_MILE)   // all miles incl. deadhead
routeBurden        = sum(ROUTE_VARIABLE) for this lane
timeBurden         = sum(TIME_VARIABLE) × projected dwell days
```

### Planned Input Sources (in order)

1. Manual entry in onboarding UI — required at V2 launch
2. Editable cost table in settings UI — required at V2 launch
3. PDF/doc upload parsed into candidate cost items (OCR + GPT-4o-mini) — V2
4. TMS/accounting integrations — V3

Manual entry must always remain supported. Do not require an integration to use the engine.

---

## Royal Carriers Actual Cost Structure (Reference)

Current operational values used for shadow testing:

| Item | Value |
|---|---|
| Fixed cost per month | $7,050 |
| Variable CPM | $1.05 |
| Survival margin | 5% |
| Min effective RPM (V2) | $1.62 |
| Target RPM (V2, derived) | $1.86 (`1.62 × 1.15`) |

These are single-truck figures. Multi-truck fleet costs are not yet modeled per-truck.

---

## What NOT To Do

- Do not pass `costModel` to `/rank-loads-v2` — it is ignored by the V2 engine
- Do not read `fixedCostPerMonth` or `variableCPM` in V2 code — those are V1 fields
- Do not build the Phase 5 extensible cost-item model before shadow testing is complete
- Do not require DB-persisted cost values before Phase 5 — request body defaults are intentional for now
- Do not conflate `minEffectiveRPM` (survival floor, binary gate) with `targetRPM` (performance target, continuous score)
