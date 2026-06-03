# Project Update — Golden Mile demo → V2 wiring (frontend)

**Owner:** Jaskaran · **Date:** 2026-06-03 · **Status:** On track

## TL;DR
The Golden Mile demo UI is now wired to the live V2 API. We kept the existing
demo.html as the canonical UI (served through the React console via iframe) and
added a single connector that pulls **real drivers + loads** from the Railway
backend, simplifying the fiction (375 trucks) down to Royal Carriers' three real
drivers — **Max (#106), Monu (#109), Paul (#107)** — and 122 real rate-con loads.
No UI rebuild; per Harpreet's call we deleted/simplified rather than added.

## Shipped this session (wired to real data)
- **View live data sources → Rate Confirmations:** load-level detail for all
  drivers from the rate sheets we've parsed (50+ on record), plus the drop-zone
  to input more rate sheets. Backed by `POST /api/loads/parse-ratecon` + `GET /api/loads`.
- **Plan schedule:** per-driver month calendar built from real load
  pickup/dropoff dates + cities. **Red points mark empty days with no load booked.**
  Month switcher (Feb–May, the months we have rate sheets for).
- **Urgent banner:** highlights drivers running empty after their last booked load.
- **Analytics:** revenue by month, by driver, avg RPM, utilization, and a
  load-level table — all computed live from the 122 loads ($304,752 booked Feb–May).
- **Agent scenarios:** the "tell the agent what changed" input + chips now handle
  "Max's truck broke down" and "Paul home Saturday" and reflect into the calendar
  (truck-down / home-by flags on the driver row).
- **Notify broker:** clicking a booked load opens a pre-drafted email that pulls
  the broker name/email/phone straight from that load's rate sheet.

## Blocked on backend (cleanly stubbed, labelled in-UI)
These are wired up to the seam and will go live the moment the endpoints land:
- **Email send** — pre-draft is real; "Send" is disabled pending Danish's email endpoint.
- **Find & Fill / DAT board** — needs the DAT pull (Chrome extension) + an endpoint;
  currently still the demo's sample loads.
- **Make optimal assignments** — needs the optimizer endpoint; still runs the demo's
  local re-plan animation.
- **Learning engine** — needs backend (recommended/booked/cancelled + reasoning).
- **Schedule persistence** — schedule edits are client-side until a schedule endpoint exists.

## API used today
Only `GET /api/drivers` and `GET /api/loads` (+ `parse-ratecon`) exist, so all of the
above is computed client-side from real load data. Everything else is ready to
swap to a real call behind the same render functions.

## Next
- Wire Find & Fill top-3 + "start negotiation" once the DAT/email endpoints exist.
- Wire "Make optimal assignments" to the optimizer when ready.
- Repurpose the right-rail agent feed from Golden Mile fiction to Royal Carriers signals.
