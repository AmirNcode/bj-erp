# Plan — sign once, Home request details, finance default range

**Spec:** `docs/specs/2026-10-21-sign-once-home-details-design.md` (FR-71, FR-72, FR-62 amended).
**Branch:** `codex/approval-fixes` from `origin/main` @ `bfa638b`.
**Status:** written 2026-10-21; waiting for the owner's go-ahead to implement.

## Ground rules

- Migrations `20261020120000`–`…11` are frozen. New work: `20261021120000_sign_once.sql`,
  `20261021120001_home_dismissed_requests.sql`.
- Database work in a **scratch database** only, never the shared local `postgres` DB (real roster). Use
  `bj_travel` if it still exists and is at `…11`; otherwise create `bj_fixes` from a `pg_dump -Fc` of
  `postgres` (CLAUDE.md "Separate DB for a long-lived branch"). Each migration: dry-run with the SQL tests
  inside `begin … rollback` as `supabase_admin`, then apply with `psql -1`; dump `supabase/schema.sql` with
  `pg_dump -d <scratch>`.
- `lib/supabase/types.ts` is hand-edited for the new functions and table.
- All new strings in `messages/fa.json` and `messages/en.json`, Farsi first.
- Commit only when the owner asks.

## Task 1 — Finance default range (FR-62)

- `app/[locale]/(app)/finance/page.tsx`: with no `to` parameter, `to` = last day of the month after the
  current one (`months[indexOf(current) + 1]?.gregorianEnd`, falling back to the current month's end).
  `from` stays the current month's start. Update the header comment.
- `FinanceList.tsx`: check that the range selects show the two-month default correctly (no code change
  expected).
- Test: unit test for a small pure helper `defaultFinanceRange(months, today)` in `lib/finance/range.ts`
  (new): mid-month, last month in the list, today missing from the list.
- Docs: FR-62 amendment line in `docs/REQUIREMENTS.md`.

## Task 2 — SQL: sign once (FR-71)

Migration `20261021120000_sign_once.sql`:
1. `create or replace function public.app_request_approval_progress(p_id uuid)`: copy the current definition
   from `schema.sql`. On each open, non-exempt step add `'is_mine', v_allowed` (natural or delegated,
   ignoring the order rule). Set `per_diem_allowed` to `v_allowed and s.role='hr' and r.kind='errand'`.
   Decided, exempt and fallback rows get `'is_mine', false` (fallback: `v_allowed`).
2. New `public.approve_leave_request_steps(p_id uuid, p_step_ids uuid[], p_signature_data text,
   p_signature_authorized boolean, p_per_diem_rials bigint default null) returns void`, `security definer`,
   `search_path ''`:
   - `auth.uid()` required; empty list, null element or duplicate ids → `22023`.
   - Sort ids by `approval_steps.step_order, id` (an id not on this request's company → `42501`).
   - Loop: `perform private.decide_approval_request(p_id, step, auth.uid(), 'approved', p_signature_data,
     p_signature_authorized, false, case when step is the hr step then p_per_diem_rials end, null)`.
     A per diem with no HR step in the list → `22023` (before any write).
   - All in the function's one transaction: any failing step rolls back every earlier one.
   - Grants: revoke from `public, anon`; grant execute to `authenticated`. End with
     `notify pgrst, 'reload schema';`.
3. `approve_leave_request_v2` unchanged (old app during release; admin override and legacy path).

Tests: new `tests/sql/sign-once.sql` (same harness as `hr-head-own-per-diem.sql`):
- Manager = Head of HR: progress shows both steps `is_mine`; one call signs both; request approved; two
  `leave_request_approvals` rows with the same signature; per diem saved on the errand.
- Order enforced, steps manager(A) → named(B) → hr(A): bundle call with A's two steps fails at the hr
  step (`an earlier approval is still required`) and saves nothing.
- Delegated step + own step signed together; delegated row has `evidence_kind = 'delegated'`.
- Errors: empty list, duplicates, foreign step id, per diem without HR step, someone else's step.
- Re-run all `tests/sql/*.sql` on the scratch DB.

## Task 3 — App: sign once (FR-71)

- `lib/leave/approval-context.ts`: `ApprovalProgressRow.is_mine?: boolean`; new pure
  `approvalBundle(progress)`: walk open, non-exempt steps by `step_order`; take a step when `can_approve`,
  or when `is_mine` and every earlier open step was taken; stop at the first open step not taken.
  `ApprovalChoice` gains `stepRole`.
- `lib/actions/leave/approvals.ts`:
  - `getPendingApprovals`: `decision_steps = approvalBundle(progress)` (legacy no-chain fallback kept);
    `per_diem_natural` = any bundled step with `perDiem`.
  - `ApproveRequestInput.stepIds?: string[]` replaces `stepId`. Non-override with one or more ids →
    `approve_leave_request_steps`; override or legacy (no ids) → `approve_leave_request_v2` as now.
    Travel tick unchanged (after the approval).
- `DecisionDialogs.tsx` `ApproveDialog`: replace the approve `StepChoice` with a read-only list
  ("You are signing as: …", delegated steps "on behalf of <name>"); per diem and travel box when any
  bundled step has `perDiem`; `ApproveExtras.stepIds`. `RejectDialog` unchanged.
- Callers: `manage/approvals/ApprovalQueue.tsx`, `home/PendingApprovalsCard.tsx`, `home/page.tsx`
  pass the bundle through unchanged otherwise.
- Messages: `approvals.signingAs`, `approvals.onBehalfOf` (fa + en).
- Tests: unit `approval-bundle.test.ts` (order enforced / not, other person in between, delegated,
  HR-exempt skipped, legacy); update `approval-queue-order.test.ts`, `approval-delegation-actions.test.ts`
  and dialog tests for `stepIds`; new case: two steps → one RPC call with both ids.

## Task 4 — SQL: Remove from Home (FR-72)

Migration `20261021120001_home_dismissed_requests.sql`:
- Table `public.home_dismissed_requests(request_id uuid primary key references public.leave_requests(id)
  on delete cascade, employee_id uuid not null references public.profiles(id) on delete cascade,
  dismissed_at timestamptz not null default now())`. RLS on; select policy `employee_id = auth.uid()`;
  no insert/update/delete policies; grant select to `authenticated`.
- `public.app_dismiss_home_request(p_id uuid) returns void`, `security definer`: caller active; request is
  the caller's and `status = 'rejected'`, else `42501` / `22023`; `insert … on conflict do nothing`.
- SQL tests in `tests/sql/sign-once.sql` (second section): own rejected → ok, twice → ok; pending / other
  person's → refused; another user cannot read the row; deleting the request removes the row
  (`npm run cleanup:e2e` path).
- Docs: `docs/DATA_MODEL.md` (table), `docs/PERMISSIONS.md` (policy + RPC).

## Task 5 — App: Home request details and retention (FR-72)

- New `components/RequestDetails.tsx` (client): the detail block now inside `MyRequestsList` — per diem,
  procurement transport/note, dates, day part/time, unpaid part, tracking number, cover, rejection note,
  `RequestProgress`, both `RequestSignatureViewer`s. `MyRequestsList` renders it; no visible change there.
- `lib/home/board.ts`: `buildHomeBoard` takes `today`, `workSettings`, `dismissedIds`; `recent` = requests
  (newest first) that are not cancelled, not dismissed, and still before their return point:
  `returnToWork(...)` → hide when `today >= date` if `time` is null, `today > date` if `time` is set; when
  `returnToWork` returns null, keep while `today <= end_date`. The 5-row cap goes.
- `lib/actions/leave/requests.ts`: `getMyHomeDismissals()` (ids) and `dismissFromHome(id)` (calls the RPC,
  `invalidateAppCache()`).
- `home/page.tsx`: fetch `getMyTravelBookings()` and `getMyHomeDismissals()` in the same `Promise.all`; pass
  `todayInAppTz()`, work settings (with holidays) and dismissals to `buildHomeBoard`.
- `HomeBoard.tsx` Recent card: summary line as now; **Show more / Show less** toggle in place of the inline
  `RequestProgress`, opening `RequestDetails` (progress open by default); **Remove** button on rejected
  rows (confirm not needed; optimistic hide, error text on failure). Empty state gets a link to the
  Requests tab.
- Messages: `home.showMore`, `home.showLess`, `home.removeFromHome`, `home.removeFailed`,
  `home.openRequests` (fa + en).
- Tests: update `home_board.test.ts` (drop "caps at 5"; add: pending before return shown; approved
  multi-day hidden on return day; hourly same-day shown that day, hidden next day; rejected shown;
  rejected dismissed hidden; cancelled hidden; null return falls back to end date); new
  `home-recent-details.test.tsx` (Show more reveals travel note; Remove only on rejected, calls action);
  `my-requests-list.test.tsx` still passes.

## Task 6 — Verify and document

- `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run build`; all `tests/sql/*.sql` on the
  scratch DB; fa/en key counts match.
- Browser check (if the owner wants one before merge): needs an app stack on the scratch DB (second GoTrue +
  PostgREST + gateway, CLAUDE.md); otherwise the owner checks on Liara after deploy: Head of HR as manager
  signs once; employee's Home shows the trip note under Show more; finance opens on Mehr–Aban.
- Docs: `docs/REQUIREMENTS.md` (FR-71, FR-72, FR-62), `docs/CHANGELOG.md` (Unreleased), `docs/TASKS.md`,
  `docs/AGENT-LOG.md`.

## Order

1 → 2 → 3 → 4 → 5 → 6. Tasks 1 and 4–5 do not depend on 2–3 but share `messages/*.json`; done in order, in
this session.
