# Approval-fixes review: implementation plan

## Context
- Branch `codex/approval-fixes`, 2 commits ahead of `origin/main` @ `bfa638b` (0 behind): `98c5561` (FR-71 sign
  once, FR-72 Home details, FR-62 finance range) and `26ba3f6` (FR-73 itinerary, org-chart personnel numbers,
  travel-pending badge, extensions on Home, calendar month arrows).
- Review 2026-10-21 found one medium issue: FR-71 is wired into the approvals queue and Home, but the Calendar
  page's Approve button still sends no step ids, so the Head of HR who is also the requester's manager still has
  to sign twice there (the exact production bug FR-71 fixes).
- Docs to read: `CLAUDE.md` only. FR-71 rule: `docs/specs/2026-10-21-sign-once-home-details-design.md` §1 (optional).

## Rules
- Work on `codex/approval-fixes`. One commit per task. Message format: `fix(<area>): <what>` with trailer
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never edit an applied migration. This plan needs no migration.
- Do not refactor or touch anything outside the listed files.
- Stop and ask if a task's "expected" result is not met after 2 attempts.

## Tasks

### T1 — Calendar approve signs every step the caller holds (FR-71) [medium]
- Problem: `app/[locale]/(app)/calendar/CalendarView.tsx:171-172` calls
  `approveRequest(requestId, { signatureData, signatureAuthorized })` with no `stepIds`, so
  `lib/actions/leave/approvals.ts:53` takes the `approve_leave_request_v2` path with `p_step_id: null`, and
  `private.decide_approval_request` signs only the first step the caller can sign. The queue and Home send
  `stepIds` from `approvalBundle()` (`DecisionDialogs.tsx:296`); the calendar does not. The page already loads
  `getPendingApprovals()` (`calendar/page.tsx:56`) but passes on only the ids (`page.tsx:66-67`).
- Files:
  - `lib/leave/approval-context.ts` (add one export after `approvalBundle`)
  - `app/[locale]/(app)/manage/approvals/DecisionDialogs.tsx` (line ~296, use the helper)
  - `app/[locale]/(app)/calendar/page.tsx` (lines ~66-67 and the `<CalendarView … />` props ~line 85)
  - `app/[locale]/(app)/calendar/CalendarView.tsx` (Props ~line 86, `DecideButtons` ~lines 105-172, its two call
    sites ~lines 364 and 483, the `CalendarView({ … })` destructuring ~line 233)
  - `tests/unit/approval-bundle.test.ts`
- Change:
  1. `lib/leave/approval-context.ts`, after `approvalBundle`:
     ```ts
     /** FR-71: the step ids one signature approves (the legacy no-chain choice has none). */
     export function bundleStepIds(choices: ApprovalChoice[] | undefined): string[] {
       return (choices ?? []).flatMap((step) => (step.stepId ? [step.stepId] : []));
     }
     ```
  2. `DecisionDialogs.tsx`: change line 10 `import type { ApprovalChoice } from '@/lib/leave/approval-context';`
     to `import { bundleStepIds, type ApprovalChoice } from '@/lib/leave/approval-context';` and replace
     `steps.flatMap((step) => (step.stepId ? [step.stepId] : []))` with `bundleStepIds(steps)`.
  3. `calendar/page.tsx`: import `bundleStepIds` from `@/lib/leave/approval-context`; next to `decidableIds` add
     ```ts
     const decisionStepIds: Record<string, string[]> =
       approvalsResult && approvalsResult.ok
         ? Object.fromEntries(approvalsResult.requests.map((r) => [r.id, bundleStepIds(r.decision_steps)]))
         : {};
     ```
     and pass `decisionStepIds={decisionStepIds}` to `<CalendarView>`.
  4. `CalendarView.tsx`:
     - Props: add `/** FR-71: per request, the step ids one signature approves. */ decisionStepIds?: Record<string, string[]>;`
       and destructure it in `CalendarView({ … })`.
     - `DecideButtons`: add prop `stepIds: string[]` (type `stepIds: string[];` in its props type) and change the
       approve call to `approveRequest(requestId, { signatureData, signatureAuthorized, stepIds })`.
     - Both call sites: `<DecideButtons id={entry.id} stepIds={decisionStepIds?.[entry.id] ?? []} labels={labels} disabled={isPending} onDecide={decide} />`.
     - An empty array keeps today's behaviour (v2 path: admin override / legacy no-chain), because
       `approveRequest` only uses the steps RPC when `stepIds.length > 0`.
- Test: in `tests/unit/approval-bundle.test.ts` import `bundleStepIds` too and add
  ```ts
  describe('bundleStepIds (FR-71)', () => {
    it('drops the legacy no-chain choice and keeps order', () => {
      expect(bundleStepIds(approvalBundle([
        step('mgr', 1, { can_approve: true, is_mine: true }),
        step('hr', 2, { is_mine: true, step_role: 'hr' }),
      ]))).toEqual(['mgr', 'hr']);
      expect(bundleStepIds([{ stepId: null, stepRole: 'manager', label: 'manager', name: null, principalName: null, delegated: false, perDiem: false }])).toEqual([]);
      expect(bundleStepIds(undefined)).toEqual([]);
    });
  });
  ```
- Verify:
  - `npx vitest run tests/unit/approval-bundle.test.ts tests/unit/sign-once.test.tsx` → all pass.
  - `rm -rf .next/dev/types && npx tsc --noEmit` → exit 0.
  - `npm run lint` → exit 0.
  - `npx playwright test tests/e2e/calendar.spec.ts --workers=1` → passes (it approves through the calendar).

## Final verification
Run on the branch after T1 (baseline on `origin/main` @ `bfa638b`: every command below exited 0; unit 961 passed /
5 skipped; branch before fixes: unit 1014 passed):
1. `npm ci`
2. `npm run lint`
3. `rm -rf .next/dev/types && npx tsc --noEmit`
4. `npm run test:unit`
5. `npm run build`
6. `npm audit --omit=dev` (expect `found 0 vulnerabilities`)
7. `npm run test:deploy`
8. SQL (local DB, each file rolls back itself), with `PGPW` = `POSTGRES_PASSWORD` from `deploy/.env`:
   `for f in sign-once approval-delegation hr-head-own-per-diem travel-booking travel-itinerary fr55-roles-permissions; do docker exec -i -e PGPASSWORD="$PGPW" bj-erp-db-1 psql -U supabase_admin -d postgres -q -v ON_ERROR_STOP=1 < tests/sql/$f.sql > /dev/null 2>&1 && echo "$f ok" || echo "$f FAIL"; done`
   → all `ok` (before fixes: 38 / 165 / 24 / 217 / 46 / 355 PASS).
9. `npx playwright test tests/e2e/approval.spec.ts tests/e2e/approval-step-person.spec.ts tests/e2e/home.spec.ts tests/e2e/leave.spec.ts tests/e2e/calendar.spec.ts tests/e2e/errand.spec.ts --workers=1`
   (no `accrual.spec`); then `npm run cleanup:e2e`. Results must match the review's e2e row in the AGENT-LOG entry.

## Finish
- Append the `docs/AGENT-LOG.md` entry.
- Push `codex/approval-fixes` and open a PR into `main`. The body covers: intent (FR-71, FR-72, FR-62 amendment,
  FR-73, org-chart personnel numbers, travel-pending badge, extensions on Home, calendar month arrows), the fix
  made (T1), check results, remaining risks (see the review's PR notes below).
- Never merge.

## PR notes (low, no task)
- `private.decide_approval_request` turns an admin's call into a full override when the admin can no longer sign
  a step they picked; `approve_leave_request_steps` inherits this from `approve_leave_request_v2` (not new).
- Calendar approve still has no per diem / travel tick for an errand's HR step (unchanged from main).
- Editing a booking finished before FR-73 now requires the structured itinerary (v2 refuses `done` with a null
  itinerary); spec only promises the traveller keeps the old note box.
- `get_org_chart()` now shows personnel numbers to every signed-in colleague (owner decision, widens D8).
