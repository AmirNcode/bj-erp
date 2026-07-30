# Leave v2 Replacement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a worker name who covers for them — جانشین on the daily form, جایگزین on the hourly one — chosen from their own department, searchable, and refused if that person is themselves away.

**Architecture:** One nullable `replacement_id` on `leave_requests`. A definer RPC returns the caller's department colleagues **annotated** with availability rather than filtered, so a worker who cannot find their intended cover sees *why*. The server rejects an unavailable pick at submit and re-checks at approval, exactly as the overlap guard is enforced twice. The reverse case — being named as cover and then requesting the same day — is a warning, never a block.

**Tech Stack:** Postgres 15 · Next.js 16 App Router + TypeScript · Vitest · Playwright.

## Prerequisite

Plans 1–3 complete. Same branch, `feat/leave-v2-hourly-accrual-replacement`.

## Global Constraints

Spec §8 plus every constraint from plans 1–3. Binding:

- **D14 — candidates are same-department, active, excluding self.** Any overlapping **pending or
  approved** leave disqualifies them. Strict on purpose: a cover who is absent is not a cover.
- **D15 — no consent gate.** The named person sees "you are covering X" on Home; approval never waits on
  them. With no notification channel in v1, a consent gate would stall requests on an off-shift worker.
- **The asymmetry in spec §2.1 is intentional.** Picking a cover is strict, but being named as one never
  blocks that person's *own* leave request — they are warned, and the manager sees the clash. A
  coworker's paperwork must not veto someone's leave rights. Do not "fix" this.
- **The replacement is not added to `team_leave_calendar`.** That view's exposed column list stays as
  narrow as FR-25 made it.
- Validation in SQL; advisory lock before balance writes; `SECURITY DEFINER` + `search_path = ''`;
  stable English errors mapped in `lib/errors/db-error.ts` + both locales.
- Migrations idempotent, applied as `supabase_admin`; `types.ts` hand-edited; fa/en key trees identical.
- **Any migration that updates seeded `leave_types` rows must also set those columns in
  `supabase/seed.sql`** — `install.sh` seeds *after* migrations (found in plan 3).

### Deviation from spec §9, forced by the environment

The spec specifies a shadcn `Command` inside a `Popover` for the searchable picker. Only `popover.tsx`
exists in `components/ui/`, and adding `command` pulls in `cmdk` through the shadcn CLI — a network
install this machine cannot do (same constraint as `supabase gen types`). The picker is therefore a
**text filter input above a native `<select>`**: genuinely searchable, no new dependency, and it keeps
the repo's "native select so Playwright can `selectOption`" rule. Recorded here rather than silently
substituted.

---

## Task 1: Schema + candidate/conflict reads

**Files:** Create `supabase/migrations/20260729130011_leave_replacement.sql`; modify `lib/supabase/types.ts`.

**Produces:** `leave_requests.replacement_id uuid references profiles(id) on delete set null`, with a
CHECK that it is never the requester; index on `(replacement_id, start_date)`;
`public.get_replacement_candidates(p_start date, p_end date, p_unit leave_unit, p_start_time time, p_end_time time)`
returning `(profile_id uuid, full_name text, employee_code text, unavailable boolean, unavailable_reason text)`;
`public.get_my_cover_conflicts(p_start date, p_end date)` returning the requests the caller is cover for
in that window.

Key points for the migration:

- `check (replacement_id is null or replacement_id <> employee_id)` — naming yourself is meaningless.
- `get_replacement_candidates` is scoped internally to `auth.uid()`'s own department and takes **no
  employee or department argument**, so it cannot enumerate another team. Granted to `authenticated`.
- Availability uses the **same time-aware predicate as the overlap rule** (spec §7.4): a candidate's
  whole-day leave always conflicts; hourly-vs-hourly only when the times intersect.
  `unavailable_reason` is a stable English string (`'on leave'`) mapped in the UI, not a sentence built
  in SQL.
- `get_my_cover_conflicts` powers the warning; it returns rows, and the *caller* decides to warn.

- [ ] **Step 1: Write and apply the migration**; replay it; confirm the CHECK rejects self-naming.
- [ ] **Step 2: Verify the candidate RPC by scenario** (rolled-back, jwt sub set):
  1. a colleague with no leave → `unavailable = false`
  2. that colleague with an approved full-day request in the window → `unavailable = true`, reason `on leave`
  3. with a **pending** request → also `unavailable = true` (D14 counts pending)
  4. hourly request that does **not** intersect the requested hours → `unavailable = false`
  5. the caller themselves → **absent from the result**
  6. someone in another department → **absent from the result**
- [ ] **Step 3: types.ts + `tsc --noEmit`.**
- [ ] **Step 4: Commit.**

---

## Task 2: Enforce it in the write path

**Files:** Create `supabase/migrations/20260729130012_leave_replacement_guard.sql`.

`private.submit_leave_impl` gains a `p_replacement_id` parameter, and both wrappers pass it through.
Validation, after the advisory lock:

1. must be an **active profile in the caller's own department**, and not the caller →
   `replacement must be an active colleague in your department`
2. must have **no overlapping pending or approved leave** (same time-aware predicate) →
   `replacement is on leave during this period`

`approve_leave_request` re-checks rule 2 at decision time and raises
`replacement is on leave during this period` — the cover may have booked leave between submission and
approval, and approving anyway would silently produce an absent cover.

- [ ] **Step 1: Write and apply**; replay.
- [ ] **Step 2: Verify**: submit naming an available colleague (accepted); naming one who is away
  (rejected, exact string); naming someone from another department (rejected); naming yourself
  (rejected); then make an approved cover go on leave and confirm **approval** now fails.
- [ ] **Step 3: Map both errors** in `db-error.ts` + both locales.
- [ ] **Step 4: Commit.**

---

## Task 3: The picker, on both request screens

**Files:** Create `lib/leave/replacement.ts` (pure filter helper) + `tests/unit/replacement.test.ts`;
create `app/[locale]/(app)/request/_components/ReplacementPicker.tsx`; modify both request forms and
their pages; modify `lib/actions/leave.ts`; `messages/*`.

- `filterCandidates(candidates, query)` — case-insensitive match on name or employee code, pure and
  unit-tested. Unavailable candidates are **kept** and rendered `disabled` with their reason.
- `ReplacementPicker` is shared by both forms (the one component both screens use; the *screens* stay
  separate per D13, the control does not need to be duplicated).
- Optional field: an empty selection is valid and must submit as `null`.
- `getReplacementCandidates(...)` server action wraps the RPC; the form re-fetches when the date or
  times change, because availability depends on them.

- [ ] Steps: failing test for `filterCandidates` → implement → picker component → wire into both forms
  and both actions → labels in both locales → gates → commit.

---

## Task 4: Surfacing — Home, approvals, and the reverse warning

**Files:** `lib/home/board.ts` (+ its test), `home/page.tsx`, `HomeBoard.tsx`, `ApprovalQueue.tsx`,
`MyRequestsList.tsx`, `lib/actions/leave.ts`.

- **Home, for the named person:** "you are covering X on <dates>" for pending/approved requests where
  `replacement_id = auth.uid()`. A new read (`getMyCoverDuties`) plus a card; D15's whole point is that
  this is never a surprise.
- **Approvals:** show the cover's name on the card, and a flag when that person has leave overlapping
  the request (`get_my_cover_conflicts` is per-caller; the approval card uses the candidate check for
  the specific pair). The manager decides.
- **Own request rows:** show the cover's name, and warn on the request screens when the requester is
  themselves someone's cover in the chosen window (spec §2.1 — warn, never block).
- Keep every existing `data-testid`.

- [ ] Steps: extend the reads → board view-model + its unit test → render → gates → commit.

---

## Task 5: E2E and docs

- [ ] **`tests/e2e/replacement.spec.ts`** — two employees in one department; A names B and it submits; B
  is given approved leave over the same dates; A's next attempt to name B is **refused** with the mapped
  message; B sees "you are covering" on Home for the first request. Reserved `999#######` range, and
  both employees must land in the **same department** for the candidate list to include them.
- [ ] **Docs** — DATA_MODEL (`replacement_id`, the two RPCs, the deliberate asymmetry), FR-28 in
  REQUIREMENTS, CHANGELOG, TASKS, AGENT-LOG.
- [ ] **Full gates**, real counts recorded. Commit.

---

## Deployment note

Additive: one nullable column, two new RPCs, one changed writer signature. No backfill. Existing
requests simply have no cover, which is correct — the field is optional and was never collected before.

## Self-Review

**Spec coverage (§8):** `replacement_id` (T1) · candidates annotated not filtered, same-department,
excluding self (T1) · pending **and** approved disqualify (T1, D14) · submit-time rejection + approval
re-check (T2) · reverse case warns only (T4, §2.1) · "you are covering X" on Home (T4, D15) · never added
to `team_leave_calendar` (Constraints).

**Not here:** serials (plan 5).

**Type consistency:** `replacementId` in TS ↔ `replacement_id` in SQL. `unavailable` is a boolean and
`unavailable_reason` a stable English key, localized in the UI — never a Farsi sentence from SQL.

**Risk flagged:** the candidate check and the submit-time guard must use the *same* predicate. If they
drift, the UI will offer someone the server then rejects — confusing, and exactly the kind of split that
Task 2's scenarios exist to catch. Both live in this plan's two migrations; keep the predicate textually
identical.
