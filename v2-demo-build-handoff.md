# V2 Demo Build — Order of Operations + Dependencies

We're staging a V2-style demo on top of the existing **V1 stack** (Express + Prisma + Supabase + Railway) and the **Golden Mile demo HTML**.

We are **NOT** building real V2 — no CP-SAT, no WhatsApp, no live-broker dependency, no real-time learning, no auth rebuild. Reuse first; build only what's tagged.

You own building the tabs, wiring them together, and the fallbacks.

Build in this order. Each item lists what it depends on.

---

## Where things live (confirm repo root before starting)

Paths below are **repo-relative**, pulled from the build logs. Two separate things:
- **V1 codebase** (the engine, apps, extensions) — the `TrueMile/` repo.
- **Demo HTML** — the standalone `golden_mile_demo_v45` file we're reskinning.

⚠️ Confirm the actual clone location / repo root on the demo box — the logs only give relative paths, not absolute ones.

| What | Path (repo-relative) | Used by |
|---|---|---|
| Rate-con parser (Anthropic + GPT, async job + poll) | `src/services/` parse logic; routes in `dispatcher-loads.routes.ts` + `load-lifecycle.routes.ts` | #1 |
| Extension → backend ingest endpoint | `POST /api/loads/ingest-from-extension` in `dispatcher-loads.routes.ts` | #1 |
| Manual rate-con upload (web) | `frontend/src/dispatcher/RateConUploadScreen.tsx` | #1 |
| Mobile rate-con logic (source of truth to port) | `mobile/driver/` + `mobile/dispatcher/lib/dispatcher-api.ts` | #1 |
| Gmail Chrome extension | `tools/gmail-ratecon-extension/` (`content.js`, `manifest.json`) | #1 |
| Prisma schema / DB | `prisma/schema.prisma`, client in `src/services/db.ts` (Supabase) | #1, all |
| Ranking engine | `decision-engine-v2.ts` behind `POST /rank-loads-v2` (`dispatch-dev.routes.ts`) | #4, #8 |
| DAT Chrome extension | `tools/dat-chrome-extension/` | #4 |
| Broker email | `broker-email.service.ts`, `GmailRuntimeService.sendEmailWithAttachments()` | #7 |
| Driver notify / SMS | `mobile` dispatcher notify UI + Twilio (`src/services/`) — **Twilio not configured yet** | #7 |
| Web dispatcher (Billings/KPI screens) | `frontend/src/dispatcher/` → `/dispatcher`, `FinancialsScreen.tsx` | #5 |
| Fleet expenses / KPI routes | `fleet-expenses.routes.ts` → `/api/fleet` | #5, #6 |
| Demo HTML (reskin target) | `golden_mile_demo_v45__17_.html` | #2, #3 |
| Engine reference docs | `dispatch-engine.md`, `cost-model.md`, `market-data.md` | #4, #5 |

---

## TIER 0 — stand up first, everything waits on these

**1) Rate-con ingest + load store**  · *the blocker — do this first*
- Port the **mobile dispatch app's rate-con parser** (Anthropic API + its parsing logic) into the demo backend
- Two entry paths: (a) Gmail Chrome extension, (b) manual upload button
- Loads land in a store the demo reads from
- Parser must capture & store **every field** — this is the schema all tabs read:
  `driver name · broker name · pickup city/date · dropoff city/date · rate · loaded miles · deadhead miles · trailer type · RPM · status · CANCELLED flag + reason`
- **Depends on:** nothing — start immediately
- ▶︎ **The second this is live, ping me.** I start dumping 6 months of rate sheets, and I'll send the cancelled loads (with reasons) separately.

**2) Setup / shell**
- Reskin the demo: Golden Mile → **Royal Carriers Inc**, one **Dallas** terminal, 3 drivers, all **OTR**
- Set `ANTHROPIC_API_KEY` on the demo box
- Broker reply in the negotiation flow = **a button we press** (no waiting on a real broker)
- Drivers:

| Driver | Trailer | Truck # | Trailer # | Phone |
|---|---|---|---|---|
| Max | Reefer | 106 | 175070 | 979-481-7575 |
| Paul | Reefer | 107 | 5010 | 469-323-4675 |
| Monu | Dry Van | 109 | 75057 | 469-216-6089 |

- **Depends on:** nothing — can run parallel to #1

---

## TIER 1 — needs the pipe + shell

**3) Base view**
- Driver location comes from the **last rate con's dropoff city** → sets driver position → updates the schedule grid
- "Tell the agent" box: type e.g. *"Paul home Thursday, out Monday"* → LLM parses → updates home-time window → grid re-renders
- **Depends on:** #1 (loads), #2 (reskin)

**4) Opportunity** · *reuse*
- DAT Chrome extension scrape + `/rank-loads-v2` ranker → Find/Fill tab, ranked loads
- **Depends on:** #2 only. Pulls **live DAT**, so it does NOT need my backfill — can start early.

---

## TIER 2 — needs my backfilled loads

**5) Analytics** · *reuse*
- V1 Billings/KPI screens fed real RC PnL: revenue, RPM, deadhead, utilization vs baseline
- **CPM = $2.05** — set it, don't leave it $0.00 or Profit = Revenue
- **Depends on:** #1 + my backfill + PnL data (I'll send)

**6) Network** · *light build*
- Group 6 months of RC loads by lane → RPM, deadhead %, volume, margin → lane-economics view
- **Depends on:** #1 + my backfill

**7) Dispatch** · *reuse + small build*
- Reuse: broker email send, `tel:` call button
- Small build: "Start negotiation" → anchor on avg spot rate → send real email → broker reply updates the rate live, fired by the button from #2
- **Notify driver = SMS, but Twilio is NOT set up.** Don't block on it. The "Notify driver" button shows the pre-filled message + a sent confirmation regardless; if I get Twilio creds in (SID + token + number, ~30 min), wire the live send then. **No WhatsApp** — needs a Meta WABA + template approval (days), drivers don't use it anyway.
- **Depends on:** #2 (roster + button), loads from #1

**8) Planning** · *light build, view only*
- Per-driver week: current load → gap → recommended next → home, with the "why." Visibility, not optimization.
- **Depends on:** #1 (loads) + #4 (uses the ranker for "recommended next")

---

## TIER 3 — needs the cancelled-load data

**9) Learning** · *build — the one genuine net-new tab*
- Top: monthly cancellation / quality-rate trend over 6 months
- Then: 2 clickable cancelled loads showing their features (broker, lane, rate) getting down-weighted. 2–3 more held in reserve.
- **Depends on:** the CANCELLED flag + reason from #1, plus the cancelled cases I send manually

---

## Short version
- **#1 unblocks everything** — build it first and ping me.
- **#4** can run early (live DAT).
- **#5 / #6 / #8** wait on my backfill.
- **#9** waits on my cancelled cases.

Questions → me.
