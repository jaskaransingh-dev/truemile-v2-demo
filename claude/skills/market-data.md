# TrueMile Market Data — Technical Reference

## Two Separate Tables — Do Not Conflate

| Table | Purpose | Written by |
|---|---|---|
| `MarketSnapshot` | MCI scores per origin city × equipment type — used by decision engine for destination scoring | Seed script + manual override |
| `DATLoadSnapshot` | Raw load postings ingested from DAT load board | `dat-ingest.service.ts` |

These are independent. `dat-ingest.service.ts` does NOT write to `MarketSnapshot`.
MCI data and load posting data are separate ingestion pipelines.

---

## MarketSnapshot

### Schema

```sql
MarketSnapshot (
  origin_city    TEXT,
  origin_state   TEXT,
  equipment_type TEXT,      -- 'DRY_VAN' | 'REEFER' | 'FLATBED'
  outbound_mci   INTEGER,   -- raw DAT Market Conditions Index: -100 to +100
  capacity_label TEXT,      -- 'Very Tight' | 'Tight' | 'Neutral' | 'Loose' | 'Very Loose'
  valid_date     DATE,
  data_source    TEXT       -- 'MANUAL' | 'DAT'
)
```

### Seed State

- 297 rows: 99 cities × 3 equipment types
- All `outbound_mci = 0` at seed time
- `marketStrength = (0 + 100) / 200 = 0.5` for every destination
- Result: identical `destinationScore` across all loads at cold start — expected, not a bug

### Override Mechanism

Query uses `ORDER BY valid_date DESC LIMIT 1`. Newest row wins automatically.

To override a market:
```sql
INSERT INTO "MarketSnapshot" (origin_city, origin_state, equipment_type, outbound_mci, capacity_label, valid_date, data_source)
VALUES ('Dallas', 'TX', 'DRY_VAN', 42, 'Tight', CURRENT_DATE, 'MANUAL');
```

No code change needed. The new row shadows the seed row on next request.

### How MCI Flows Into the Engine

```
MarketSnapshot row (outbound_mci)
→ marketStrength = (outbound_mci + 100) / 200        // 0–1
→ destinationScore = marketStrength                   // in scoring
→ destinationMCI, capacityLabel returned on RankedLoad
```

Default if no row found: `outbound_mci = 0`, `capacityLabel = 'Neutral'`, `marketStrength = 0.5`.

---

## DATLoadSnapshot

### Schema (written by dat-ingest.service.ts via Prisma)

```typescript
{
  carrierId:         string,
  batchId:           string,       // FK to DATIngestBatch
  origin:            string,       // plain string: "Dallas, TX" — NOT {city, state}
  destination:       string,       // plain string: "Laredo, TX"
  pickupDate:        DateTime,
  deliveryDate:      DateTime,
  miles:             number,
  rate:              number,
  brokerName:        string,
  brokerEmail:       string,
  brokerPhone:       string,
  trailerType:       string,
  hash:              string,       // dedup key
  snapshotTimestamp: DateTime,
}
```

**Critical:** `origin` and `destination` are stored as plain strings, not structured `{city, state}` objects.
Any code that needs to parse city/state must split on ", " — do not assume a structured shape.

### DATIngestBatch (metadata record)

```typescript
{
  ingestId:         string,
  extensionVersion: string,
  counts:           object,   // load counts per batch
}
```

### Current Ingestion Flow (Manual — Interim)

1. Open DAT load board, navigate to Market Conditions view for target lane
2. Take screenshot
3. Upload screenshot to Claude Vision (claude.ai)
4. Claude Vision extracts MCI values, city names, capacity labels
5. Output is a SQL INSERT or structured JSON
6. Manually execute insert against Supabase → MarketSnapshot row created with today's `valid_date`

This is the current operational process. `dat-ingest.service.ts` handles load postings (DATLoadSnapshot), not MCI data. MCI inserts are fully manual until DAT API access is confirmed.

### DAT API (Blocked)

DAT API access is pending (~10 business days from application).

When approved:
- Phase 3 replaces manual screenshot flow with automated ingestion job
- `dat-ingest.service.ts` will be extended or a new service created for MarketSnapshot writes
- Fallback chain: live DAT → yesterday's snapshot → seed row with confidence flag
- `data_source` column distinguishes `'DAT'` (automated) from `'MANUAL'` (screenshot/seed)

Do not build automated MCI ingestion before DAT API access is confirmed.

---

## What NOT To Do

- Do not write MCI data through `dat-ingest.service.ts` — it writes load postings only
- Do not parse `origin`/`destination` as structured objects — they are plain strings
- Do not assume `outbound_mci = 0` means weak market — it means no data yet (seed state)
- Do not build DAT API ingestion pipeline before access is confirmed
- Do not change the `valid_date DESC` override mechanism — it is intentional
