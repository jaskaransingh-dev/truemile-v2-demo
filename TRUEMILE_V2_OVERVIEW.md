# TrueMile V2 Demo — Complete Overview

---

## Links (send these to the team)

| What | URL |
|------|-----|
| **Live Demo (production)** | **https://truemile-v2-demo.vercel.app** |
| **Live Demo (direct)** | https://truemile-v2-demo.vercel.app/demo.html |
| **API (Railway)** | https://truemile-v2-demo-dev.up.railway.app |
| **API Docs / Swagger** | https://truemile-v2-demo-dev.up.railway.app/docs |
| **GitHub Repo** | https://github.com/TrueMile/truemile-v2-demo |
| **Vercel Dashboard** | https://vercel.com/mb7869fdzv-3791s-projects/truemile-v2-demo |

---

## Architecture (what's running where)

```
Browser
  └── https://truemile-v2-demo.vercel.app        ← Vite/React (Vercel)
        └── iframe → /demo.html                  ← Golden Mile demo UI
              └── demo-connect.js                ← Live data connector
                    └── GET /api/drivers          ← Railway FastAPI
                    └── GET /api/loads            ← Railway FastAPI
                    └── POST /api/loads/parse-ratecon  ← Railway FastAPI
                          └── Anthropic Claude   ← AI PDF parsing
                          └── PostgreSQL (Railway)← Persistent storage
```

---

## What's done ✅

### 1. Rate Confirmation Upload (Ratecon) — FULLY WORKING
- Upload any PDF broker rate confirmation
- AI (Claude via Anthropic API) reads and extracts all fields
- Stores in PostgreSQL with full data
- Shows in "View live data sources → Rate Confirmations" tab
- Schedule automatically updates from new uploads

**Extracts:** load number, driver, pickup city/state/date/time, dropoff city/state/date/time, rate, miles, RPM, broker name, broker email, broker phone, full stop details

### 2. Plan Schedule — LIVE FROM RATE SHEETS
- Per-driver monthly calendar (Max / Monu / Paul)
- Built from real rate confirmation pickup/dropoff dates
- **Teal = booked load** (hover shows lane, rate, load number)
- **Red hatched = empty day** (no load booked, needs fill)
- Month switcher: February, March, April, May
- Urgent banner when a driver is running empty after their last load

### 3. Agent Scenarios — WORKING
- Type in "tell the agent" box or use the quick chips:
  - "Max truck down" → red TRUCK DOWN flag on Max's calendar row
  - "Paul home Saturday" → HOME BY flag on Paul's row
  - "Monu home Friday" → HOME BY flag on Monu's row
- Reflects immediately in the schedule

### 4. Notify Broker — WORKING (send stubbed)
- Click any teal booked-load day in the schedule
- Opens modal with broker's real name/email/phone from that rate sheet
- Auto-drafts email referencing the actual load number, lane, rate
- "Copy draft" works; "Send email" is ready and waiting for Danish's email endpoint

### 5. Analytics — LIVE FROM REAL DATA
- $304,752 total revenue (Feb–May 2026, 121 loads, 3 drivers)
- Revenue by month bar chart
- Per-driver table: loads, revenue, avg RPM, utilization %
- Load-level detail: most recent 12 loads with broker, lane, rate, RPM

### 6. View Live Data Sources → Rate Confirmations — WORKING
- Shows all 121 parsed loads from Google Drive rate sheets
- Drag & drop any new PDF to upload more
- Shows load number, driver, route, pickup date, rate, RPM, status
- Badge on tab updates with count

---

## What's stubbed (waiting on backend)

| Feature | What's needed | Where to stub is |
|---------|--------------|-----------------|
| **Send broker email** | `POST /api/email/send` | `demo-connect.js → openBrokerModal()` |
| **Find & Fill (DAT board)** | DAT API / Chrome extension endpoint | Scene 2 in demo.html |
| **Optimal assignments optimizer** | `POST /api/schedule/optimize` | `demo-connect.js → makeOptimalAssignments()` |
| **Learning engine** | `GET /api/learning/recommendations` | New scene/tab needed |
| **June schedule persistence** | `POST /api/schedule` | `demo-connect.js → state.scenarios` |

---

## How to test everything

### Test 1: Rate Confirmation Upload (UI)
1. Go to https://truemile-v2-demo.vercel.app
2. Click **"View live data sources"** button
3. Click the **"Rate Confirmations"** tab
4. Drag any PDF from `/V1/Royal Carriers Inc PnL Data/` onto the drop zone
5. Watch it parse and appear in the table
6. Switch to Plan tab — the new load's dates now appear on the calendar

### Test 2: Rate Confirmation Upload (API direct)
```bash
# Upload a rate sheet directly to the API
curl -X POST https://truemile-v2-demo-dev.up.railway.app/api/loads/parse-ratecon \
  -F "file=@/path/to/rate-confirmation.pdf"

# See what it parsed
curl https://truemile-v2-demo-dev.up.railway.app/api/loads?page_size=5
```

### Test 3: Schedule calendar
1. Go to https://truemile-v2-demo.vercel.app
2. Plan tab loads automatically — scroll to see Max, Monu, Paul rows
3. Switch months (Feb, Mar, Apr, May)
4. Hover a teal day → see the full lane details (e.g. Irving TX → Sunset Hills MO · $2,200 · #2943476)
5. Click a teal day → broker pre-draft email opens with real contact info
6. Click a red day → jumps to Find & Fill to source a load

### Test 4: Agent scenarios
1. In the Plan scene, look at the right panel "Tell the agent what changed"
2. Click **"Max truck down"** chip → Max's row gets a red TRUCK DOWN flag
3. Click **"Paul home Saturday"** → Paul's row gets HOME BY flag
4. Or type custom: `"Monu wants to be home by Thursday"` → Enter

### Test 5: Analytics
1. Click Analytics in the left nav
2. See live stats: $304K revenue, 121 loads, $3.73 avg RPM
3. Check per-driver breakdown (Monu: 52 loads $186K, Max: 43 loads $184K, Paul: 26 loads $94K)

---

## Ratecon: How It Works (Technical)

### Upload Flow
```
1. User drags PDF onto demo UI
2. POST /api/loads/parse-ratecon with multipart/form-data
3. Backend extracts text from PDF (pdftotext or vision OCR)
4. Claude AI parses text and extracts structured fields
5. Stores in PostgreSQL d2_loads table
6. Returns parsed load JSON
7. Demo UI renders load in table + updates schedule calendar
```

### What the AI extracts from any broker format
```json
{
  "loadNumber": "2943476",
  "driverName": "Max",
  "trailerType": "REEFER",
  "pickupCity": "Irving",
  "pickupState": "TX",
  "pickupTime": "2026-04-19T10:00:00",
  "dropoffCity": "Sunset Hills",
  "dropoffState": "MO",
  "deliveryTime": "2026-04-21T02:00:00",
  "rate": 2200.0,
  "loadedMiles": 618.1,
  "stops": [...],
  "brokerName": "Integrity Express Logistics",
  "brokerEmail": "amandap@intxlog.com",
  "brokerPhone": "(937) 329-9125"
}
```

### Supported PDF types
- ✅ Carrier rate confirmations (any broker format)
- ✅ Signed e-signed rate confirmations
- ✅ Multi-stop rate sheets
- ✅ Image-based PDFs (uses OCR vision fallback)
- ✅ Any broker: TQL, SOREN, Integrity Express, Allen Lund, FLS, DIRECT CONNECT, etc.

### API Endpoints

**Parse a rate confirmation:**
```bash
POST https://truemile-v2-demo-dev.up.railway.app/api/loads/parse-ratecon
Content-Type: multipart/form-data
Body: file=@ratecon.pdf
```

**List all loads (with filters):**
```bash
GET /api/loads?driver_name=Max&month=4&year=2026&page_size=50
GET /api/loads?driver_name=Monu&month=5&year=2026
GET /api/loads?page_size=200
```

**List drivers:**
```bash
GET /api/drivers
# Returns: Max (truck 106), Monu (truck 109), Paul (truck 107)
```

**Full API docs / Swagger UI:**
```
https://truemile-v2-demo-dev.up.railway.app/docs
```

---

## Repo structure (what we changed)

```
truemile-v2-demo/
├── frontend/
│   ├── public/
│   │   ├── demo.html              ← Golden Mile demo UI (v45, unmodified)
│   │   └── demo-connect.js        ← NEW: live data connector to Railway API
│   ├── src/
│   │   ├── pages/
│   │   │   └── DemoPage.tsx       ← NEW: full-viewport iframe wrapper
│   │   └── App.tsx                ← Updated: / and /demo → DemoPage
│   └── vite.config.ts             ← Proxy /api → Railway
├── fastapi-backend/               ← Danish's backend (deployed on Railway)
│   └── app/routers/
│       ├── loads.py               ← parse-ratecon + list/filter loads
│       └── drivers.py             ← list/create/delete drivers
└── TRUEMILE_V2_OVERVIEW.md        ← This file
```

---

## To push the code to GitHub
The commits are ready locally. Run:
```bash
cd /tmp/truemile-v2-demo && git push origin main
```
(Needs the TrueMile org GitHub credentials — jaz's personal token or deploy key with write access)

---

## Run locally
```bash
cd /tmp/truemile-v2-demo/frontend
npm install
npm run dev
# Open http://localhost:5173
```
The app will use the live Railway API automatically (vite.config.ts proxies `/api` to Railway).

---

## What's next (backend endpoints to build with Danish)

### Priority 1 — closes the loop on current UI
```
POST /api/email/send
  body: { to, subject, body }
  → Unlocks "Send email" button in broker notify modal
```

### Priority 2 — Find & Fill
```
GET /api/loads/dat-board?origin_city=X&origin_state=Y&dest_radius=200
  → Returns top 3 DAT loads for the driver's current location
  → Populates the Find & Fill load board
```

### Priority 3 — Optimal assignments
```
POST /api/schedule/optimize
  body: { drivers: [Max, Monu, Paul], month: "2026-06" }
  → Returns optimal driving/rest day schedule
  → Pre-fills the June calendar
```

### Priority 4 — Learning engine
```
GET /api/learning/summary
  → Returns: loads recommended, booked, declined + reasoning
  → Powers the Learning Engine tab
```
