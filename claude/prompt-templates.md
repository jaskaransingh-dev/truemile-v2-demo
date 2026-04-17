# TrueMile Prompt Templates

Paste these into Claude.ai (architecture/reasoning) or Cline (implementation) at the right moment.
These are working prompts, not documentation. Treat them as tools.

---

## 1. OFFICE HOURS — Before any non-trivial Cline session

Use in Claude.ai browser BEFORE writing a spec for Cline.
Skip for small bug fixes or obvious 1-file changes.
Use any time you're about to build something new or change how a core system works.

```
OFFICE HOURS — TrueMile

What I'm about to build / change:
[one sentence — be specific]

Push back on my thinking before I write a Cline spec:

1. WHAT PROBLEM AM I ACTUALLY SOLVING?
   Is this the real problem or a symptom?
   If this touches the decision engine: does it change constraint ordering, rejection codes,
   score weights, or the candidateLoads → RankedLoad pipeline?
   If this touches the portal: does it change how numeric score dimensions are rendered,
   or is it a column mapping / display fix?
   If this touches schema: what breaks downstream if an enum value or constraint is wrong?
   Challenge my framing if a better one exists.

2. DOES THIS NEED TO BE BUILT NOW?
   Does this unblock shadow testing?
   Does it move the needle toward DAT API readiness?
   Or is this optimization before validation?
   Be direct if I'm building out of order.

3. WHAT'S THE NARROWEST VERSION THAT PROVES THE IDEA?
   What's the smallest slice that gives real signal?
   Stop me if I'm scoping a 3-day build when a 3-hour version answers the question.

4. WHAT ARE THE BLAST RADIUS RISKS?
   Decision engine: does this touch decision-engine-v2.ts scoring weights, rejection codes,
   or the cycleState derivation in dispatch-dev.routes.ts?
   Portal: does this break the results renderer or trailer type handling?
   Schema: does this require a migration? Does it affect MarketSnapshot seed rows or
   the valid_date DESC override mechanism?
   Infrastructure: does this add a new route that needs middleware wiring?
   Flag if any change risks touching stale code: decision-engine.ts, route-sequencer.ts,
   /rank-routes — those are frozen.

5. WHAT AM I ASSUMING THAT I HAVEN'T VERIFIED?
   Flag any assumption about DAT data shape, MarketSnapshot row coverage,
   cycleState derivation logic, cost model behavior (V1 vs V2 split),
   or Prisma schema state that I haven't confirmed against the actual codebase.

6. IMPLEMENTATION OPTIONS
   Give me 2-3 options with honest tradeoffs.
   Flag which one you'd pick and why.
   Flag if any option risks touching frozen code or breaking the seed/override mechanism.

After answering all six: write a tight Cline spec I can paste directly.
No preamble. Just the spec.
```

---

## 2. SESSION START — First message in every Cline session

```
Before touching any code:

1. Read CLAUDE.md in the repo root.
2. Check claude/logs/ — read the most recent 2 dated log files for context
   on what was completed and what's in progress.
3. Load the relevant skill docs for this session:
   - claude/skills/dispatch-engine.md — any work touching decision-engine-v2.ts,
     /rank-loads-v2, scoring logic, rejection codes, or candidateLoads shape
   - claude/skills/market-data.md — any work touching MarketSnapshot,
     dat-ingest.service.ts, or MCI values
   - claude/skills/cost-model.md — any work touching RPM floors,
     minEffectiveRPM, targetRPM, or cost inputs

Session rules — enforce these throughout:
- Active engine is decision-engine-v2.ts and /rank-loads-v2 ONLY.
- Do NOT modify decision-engine.ts, route-sequencer.ts, or /rank-routes. They are frozen.
- Do NOT default missing deadhead to 0. Surface it explicitly.
- Do NOT add reasons[] to V2 output. That is V1 only.
- candidateLoads is the correct request body field name — not 'loads'.
- All service files use kebab-case: constraint-engine.ts, cost-engine.ts, etc.
- origin and destination in DATLoadSnapshot are plain strings ("Dallas, TX") — not objects.

Task for this session:
[paste your spec here]
```

---

## 3. SESSION END — Last message before closing every Cline session

```
Before we close, do the following in order:

STEP 1 — FILE AUDIT
List every file modified or created this session with one line describing what changed.
Flag any unexpected file touched outside:
- backend/src/services/dispatch/
- dispatch-dev.routes.ts
- portal HTML
- prisma/schema.prisma or seed scripts

STEP 2 — RULES CHECK
Confirm each:
- decision-engine.ts, route-sequencer.ts, /rank-routes untouched? (must be YES)
- No new code defaults missing deadhead to 0? (must be YES)
- No reasons[] added to V2 output? (must be YES)
- candidateLoads used correctly in all request shapes? (must be YES)
- New service files use kebab-case? (must be YES)
- origin/destination treated as plain strings, not objects? (must be YES)

STEP 3 — BUG SCAN
For every file modified:
- Unhandled edge cases or missing null checks?
- Async operations without error handling?
- DB queries without a fallback if no row is found?
- New score components that could break the 0–1 constraint?
- Portal changes that could break trailer type rendering or column mapping?
Fix anything clearly broken. Flag anything that needs a decision.

STEP 4 — WRITE SESSION LOG
Create claude/logs/[TODAY'S DATE].md with this exact structure:

# [TODAY'S DATE]

## What was completed
- [bullet per completed thing]

## What's broken / in progress
- [bullet per open item, or "none"]

## Decisions made
- [any architectural or implementation decisions locked in this session]

## Next session starts here
[one sentence — the exact next task]
```

---

## 4. DEBUG CONSTRAINT — Mid-session in Cline when ranking/rejection is wrong

Use when a load isn't being rejected or ranked as expected in the portal.
Paste into Cline mid-session — do not start a new session for this.

```
A load that should be [rejected by VIOLATION_CODE / ranked higher / ranked lower] is not.

Load:
[paste load JSON]

Driver:
[paste driver JSON]

Expected behavior: [one sentence]
Actual behavior: [one sentence — what the engine returned and what rejectedLoads contained]

Check in order:
1. Is the constraint check present in decision-engine-v2.ts?
2. Is the field being read from the correct path in the load object?
3. Is the check happening before scoring (hard reject) or inside scoring (wrong place)?
4. What does the rejectedLoads array actually contain for this load?

Fix the issue. Do not touch decision-engine.ts, route-sequencer.ts, or /rank-routes.
```

---

## QUICK REFERENCE

| Template | Where | When |
|---|---|---|
| Office Hours | Claude.ai browser | Before any non-trivial new build |
| Session Start | Cline — first message | Every session |
| Session End | Cline — last message | Every session |
| Debug Constraint | Cline — mid-session | Load not rejected/ranked as expected in portal |

## LOG FILE STRUCTURE

```
claude/logs/
├── 2026-03-30.md
├── 2026-03-29.md
└── 2026-03-28.md
```

Cline reads the most recent 2 files at session start for continuity.
Do not use SESSION_LOG.md in root — dated files in claude/logs/ only.
