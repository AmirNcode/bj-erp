# Travel Booking (FR-70) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HR marks approved daily errands as needing travel booking; procurement books them against
the traveller's live personal details and records costs; extensions and cancellations follow HR's
path; `/finance` shows per diem + flight + hotel (or amount lost) per trip.

**Architecture:** Booking is fulfilment after approval, not an approval step. Two new tables
(`travel_bookings`, one per request; `errand_extensions`) with RLS on and **no client policies**;
every read and write goes through guarded SECURITY DEFINER RPCs. Booking state is derived from the
request status plus booking timestamps. A new `travel_booking` catalog permission and a
`procurement` preset role give procurement access.

**Tech Stack:** Next.js App Router + TypeScript, self-hosted Supabase (Postgres 15, PostgREST, RLS),
next-intl (fa default, en), Vitest, SQL scenario scripts in `tests/sql/`.

**Spec:** `docs/specs/2026-10-20-travel-booking-design.md` (approved 2026-10-20). Read it first.

## Global Constraints

- Dates stay Gregorian `date`/`timestamptz` in SQL; Jalali only at the UI edge.
- Amounts are `bigint` whole Rials, `>= 0`, like `leave_requests.per_diem_rials`; parse/format with `lib/leave/perDiem.ts` (`parseRials`, `formatRials`).
- Travel booking applies only to `kind = 'errand' and unit = 'day'` requests.
- Traveller fields placeholder, exactly: `full_name, national_id, birth_date, mobile, gender` (one SQL constant + one TS constant; a unit test keeps them equal).
- Server actions start with `requireCaller(...)`; `if (!c.ok) return c;`.
- Every user-facing string in both `messages/fa.json` and `messages/en.json` (parity test exists).
- Lock order: `private.approval_lock(company)` before `'leave:'||employee` advisory lock.
- New enum value = its own migration, applied before anything uses it.
- A migration is frozen once applied anywhere (local included): dry-run every migration with its `tests/sql` scenario inside `begin … rollback` first; apply only when green.
- Migrations idempotent (`if not exists`, `create or replace`; drop first when a return type changes).
- Audit personal info by field name only, never values.
- `lib/supabase/types.ts` is hand-edited; verify with `npx tsc --noEmit` and `npm run build`.
- Local DB holds the real roster: SQL scenarios build their own synthetic company and roll back; run no e2e that touches real people.
- Commit only when the owner asks; commit lines below are the intended split.

## Coordination with `docs/REFACTOR_PLAN.md`

Another agent is executing the refactor plan in parallel. Before **each** task: pull/rebase, re-read
the files you are about to edit (line numbers drift), and use whatever the refactor has landed:

- **R-12:** new client components call `useTranslations` themselves; no server-built `labels` props.
- **R-07:** action results use `ActionResult<…>` from `lib/errors/db-error.ts` if it exists, else
  `{ ok: true; … } | DbErrorResult`.
- **R-03:** signature and per diem checks in `approveRequest` / `decideExtension` use
  `signatureProblem` / `perDiemProblem` once they exist; don't add another copy.
- **R-05 / Q3:** the finance CSV goes through `downloadCsv` if it exists, keeping `safeCell`.
- **R-06:** numbers via `formatNumber` / `formatRials`; no new `Intl.NumberFormat(`.
- **R-09:** ISO-date helpers from wherever R-09 put them.
- **R-10:** it retires TS mirrors of SQL rules. So the missing-field check lives **only** in SQL
  (`app_travel_missing_fields`); `TRAVELLER_FIELDS` in TS exists for labels and ordering only.
  Don't build on `perDiemApplies` or `isPersonalInfoComplete` (both slated for removal).
- **Shared files** (`lib/actions/leave/approvals.ts`, `DecisionDialogs.tsx`, `ApprovalQueue.tsx`,
  `manage/approvals/page.tsx`, `manage/requests/*`, `FinanceList.tsx`, `MyRequestsList.tsx`,
  `lib/nav/tabs.ts`, `messages/*.json`): don't refactor them in passing; make only this plan's
  edits, so the two branches merge cleanly.

**SQL run recipe** (used by every SQL task; `PGPASSWORD` = `SERVICE`/db password from `deploy/.env`):

```bash
# dry run: migration + scenario, all rolled back (the scenario's own begin/rollback wraps it)
cat <(echo 'begin;') supabase/migrations/<file>.sql tests/sql/travel-booking.sql \
  | docker exec -i -e PGPASSWORD="$PGPASSWORD" bj-erp-db-1 psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres -f -
# apply for real once green, then refresh schema + PostgREST
./deploy/bj-deploy update local && npm run schema:dump && docker restart bj-erp-rest-1
```

Expected for a green dry run: only `NOTICE: PASS …` lines, ends with `ROLLBACK`, no `FAIL`.

## Review Focus

1. HR unticks after procurement already saved something → refused (`22023`), booking intact. *(Task 3 test `untick after save refused`.)*
2. A conflicting leave/errand filed for the extra days while an extension waits → HR's approval is refused, extension stays pending. *(Task 5 test `extension approve rechecks conflicts`.)*
3. Trip cancelled while an extension is pending → extension becomes `cancelled`, trip goes to `cancel_undo`. *(Task 6 test `cancel cancels pending extension`.)*
4. HR edits the traveller's national ID after approval → procurement's next read shows the new value. *(Task 4 test `traveller info is live`.)*
5. A procurement holder is the traveller → cannot read their own traveller details, save, finish or settle. *(Task 4 tests `no self-booking …`.)*

---

### Task 1: Procurement role enum value

**Files:**
- Create: `supabase/migrations/20261020120000_procurement_role_enum.sql`

**Interfaces:**
- Produces: `public.app_role` value `'procurement'`.

- [ ] **Step 1:** Write the migration: `alter type public.app_role add value if not exists 'procurement';` with a header comment (FR-70, preset only; `approval_steps_role_allowed` must keep refusing it).
- [ ] **Step 2:** Confirm `approval_steps_role_allowed` does not admit unknown roles: `grep -n "approval_steps_role_allowed" supabase/schema.sql` — expected: an allow-list that does not include `procurement`.
- [ ] **Step 3:** Apply: `./deploy/bj-deploy update local && npm run schema:dump`. Expected: `schema.sql` enum lists `procurement`.
- [ ] **Step 4:** Commit `supabase/migrations/20261020120000_procurement_role_enum.sql supabase/schema.sql` — "Add procurement role enum value (FR-70)".

### Task 2: Tables, permission catalog item, Procurement preset

**Files:**
- Create: `supabase/migrations/20261020120001_travel_booking_tables.sql`
- Create: `tests/sql/travel-booking.sql` (fixture + section "tables & catalog"; later tasks append sections)
- Create: `lib/travel/fields.ts`
- Modify: `lib/permissions/catalog.ts` (SECTIONS, SHAPES, labels), `messages/fa.json`, `messages/en.json`
- Test: `tests/unit/permissions-catalog.test.ts` (existing schema comparison must pass), `tests/unit/travel-fields.test.ts`

**Interfaces:**
- Produces (SQL):
  - `public.travel_bookings(request_id uuid pk → leave_requests on delete cascade, company_id uuid not null, ticked_by uuid, ticked_at timestamptz not null, opened_at timestamptz, transport text check (transport in ('flight','company_car')), flight_cost_rials bigint check >= 0, hotel_cost_rials bigint check >= 0, traveller_note text check (char_length <= 500), first_saved_at timestamptz, done_by uuid, done_at timestamptz, lost_rials bigint check >= 0, lost_note text check (char_length <= 500), settled_by uuid, settled_at timestamptz, updated_at timestamptz not null default now())`
  - `public.errand_extensions(id uuid pk default gen_random_uuid(), request_id uuid not null → leave_requests, company_id uuid not null, old_end_date date not null, new_end_date date not null check (new_end_date > old_end_date), reason text not null check (char_length(btrim(reason)) between 1 and 1000), requested_by uuid not null, requested_at timestamptz not null default now(), status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')), evidence text check (evidence in ('manual','exempt')), decided_by uuid, decided_at timestamptz, signature_data text, signature_consent_at timestamptz, decision_note text, per_diem_before bigint, per_diem_after bigint)`; partial unique index `errand_extensions_one_pending on (request_id) where status = 'pending'`.
  - Both: `enable row level security`, **no policies**, `revoke all … from anon, authenticated`.
  - `private.travel_traveller_fields() returns text[]` → `'{full_name,national_id,birth_date,mobile,gender}'`.
  - `private.travel_booking_state(p_status public.leave_status, b public.travel_bookings) returns text` — `awaiting_approval` (status pending or `opened_at` null), `to_book` (approved, `done_at` null, no approved extension after `opened_at`), `extension` (approved, `done_at` null, an approved extension exists), `done` (approved, `done_at` set), `cancel_undo` (cancelled, `opened_at` set, `settled_at` null), `settled` (cancelled, `settled_at` set), `hidden` (rejected, or cancelled with `opened_at` null).
  - Trigger `travel_booking_open` AFTER UPDATE OF status ON `leave_requests`: when `new.status = 'approved'`, `update travel_bookings set opened_at = coalesce(opened_at, now())`.
  - Catalog: add `'travel_booking'` to `private.permission_keys()`, to the edit-only list in `private.permission_allows`; no deps.
  - `private.seed_company_roles`: add `(p_company,'procurement','preset','Procurement')` and `('procurement','travel_booking','edit')`; backfill every existing company by calling `private.seed_company_roles(id)` for each (idempotent `on conflict do nothing`).
- Produces (TS): `lib/travel/fields.ts` → `export const TRAVELLER_FIELDS = ['full_name','national_id','birth_date','mobile','gender'] as const; export type TravellerField = typeof TRAVELLER_FIELDS[number];` (labels and order only; the missing check is SQL's). `PermKey` gains `'travel_booking'`, section key `'procurement'` with items `['travel_booking']`, shape `'E'`.

- [ ] **Step 1: Failing unit tests.** `tests/unit/travel-fields.test.ts`:
  - `TRAVELLER_FIELDS matches schema.sql` — read `supabase/schema.sql`, regex the body of `travel_traveller_fields`, expect `{full_name,national_id,birth_date,mobile,gender}`.
- [ ] **Step 2: Failing SQL section** in `tests/sql/travel-booking.sql` (fixture copied from `tests/sql/hr-head-own-per-diem.sql`: company, dept, users `admin, mgr, hr, hr2, head (hr head), proc (procurement preset), proc2, worker`, with `worker.manager_id = mgr`; helpers `fx/login/as_scalar/expect/assert/sig/err`, plus `pg_temp.daily(actor, start, end)` wrapping `submit_daily_errand_request_v2`). Tests:
  - `procurement preset seeded` — roles row `system_key='procurement', kind='preset'` with `travel_booking/edit`.
  - `travel_booking is edit-only` — `private.permission_allows('travel_booking','read')` false, `'edit'` true.
  - `client cannot read travel_bookings` — `as_scalar('proc','select count(*) from public.travel_bookings')` starts with `ERROR 42501`.
  - `state derivation` — table of (status, opened/done/settled, extension) → expected state strings, all seven.
- [ ] **Step 3:** Run unit tests: `npx vitest run tests/unit/travel-fields.test.ts tests/unit/permissions-catalog.test.ts` — expected FAIL. Dry-run SQL — expected FAIL (missing objects).
- [ ] **Step 4:** Write the migration and the TS changes listed in Interfaces; fa/en labels for the section «تدارکات»/"Procurement" and item «رزرو سفر»/"Travel booking" following the existing catalog label keys.
- [ ] **Step 5:** Dry-run SQL → all PASS; but do **not** apply yet (`schema.sql` is regenerated in Task 3; the unit test's schema check runs after apply). 
- [ ] **Step 6:** Commit with Task 3 (one apply covers Tasks 2–3).

### Task 3: Ticking — at HR's step, after approval, untick, missing-info warning

**Files:**
- Create: `supabase/migrations/20261020120002_travel_booking_tick.sql`
- Modify: `tests/sql/travel-booking.sql` (section "tick")
- Modify: `lib/actions/leave/approvals.ts` (`approveRequest`), `lib/supabase/types.ts`
- Create: `lib/actions/travel.ts`
- Modify: `app/[locale]/(app)/manage/approvals/DecisionDialogs.tsx`, `app/[locale]/(app)/manage/approvals/ApprovalQueue.tsx`, `lib/actions/leave/approvals.ts` (`getPendingApprovals` row gains `travel_eligible: boolean`, `missing_travel_fields: string[]`)
- Modify: `app/[locale]/(app)/manage/requests/RequestsReview.tsx` (toggle on approved daily errands)
- Test: `tests/unit/travel-tick-dialog.test.tsx`

**Interfaces:**
- Produces (SQL):
  - `private.is_travel_hr(p_uid uuid, p_request uuid) returns boolean` — active, same company, `p_uid <> employee_id`, and `private.is_admin(p_uid) or private.has_role(p_uid,'hr')`.
  - `public.app_set_travel_booking(p_request uuid, p_on boolean) returns void` — requires `is_travel_hr`; request is daily errand, status `pending|approved`, `end_date >= today (Tehran)`. On: upsert row (`ticked_by/at`, `opened_at = now()` if already approved). Off: refused `22023 'booking already started'` when `first_saved_at` is not null; else delete row. Audit `travel_booking.tick` / `travel_booking.untick`.
  - `public.app_travel_missing_fields(p_request uuid) returns text[]` — requires `is_travel_hr`; returns the subset of `travel_traveller_fields()` empty for the request's employee (`full_name` from `profiles`, rest from `employee_personal_info`).
- Produces (TS, `lib/actions/travel.ts`): `setTravelBooking(requestId: string, on: boolean): Promise<{ok:true}|{ok:false;error:string}>`, `getTravelMissingFields(requestId: string): Promise<{ok:true; fields: TravellerField[]}|{ok:false;error:string}>`.
- `ApproveExtras` gains `travelBooking: boolean`; `approveRequest` input gains `travelBooking?: boolean` and, **after** a successful approve RPC, calls `app_set_travel_booking(id, true)` when true (a failure here returns `{ok:false, error}` with the approval already saved; the message tells HR to tick it from Requests).

- [ ] **Step 1: Failing SQL tests:**
  - `hr ticks pending daily errand` → row exists, `opened_at` null; after the chain finishes `opened_at` not null (trigger).
  - `tick on hourly errand refused` → `22023`; `tick on leave refused` → `22023`.
  - `manager cannot tick` → `42501`; `own request cannot tick` (hr2 files, hr2 ticks) → `42501`.
  - `tick after approval opens at once` — approved via admin override, then hr ticks → `opened_at` not null.
  - `tick after end refused` — errand whose `end_date < today` → `22023`.
  - `untick before save` → row gone; `untick after save refused` — set `first_saved_at` via Task 4 RPC (or direct as superuser in this section) → `22023`, row intact.
  - `missing fields` — worker with no national ID or birth date → `{national_id,birth_date}` (in `travel_traveller_fields()` order; blank/whitespace counts as missing); after filling → `{}`.
- [ ] **Step 2: Failing unit test** `tests/unit/travel-tick-dialog.test.tsx`: render the approve dialog with a step `perDiem: true` on a daily errand row (`travel_eligible: true`, `missing_travel_fields: ['national_id']`):
  - checkbox «نیاز به رزرو سفر» present, unchecked;
  - ticking shows the warning listing the localized field name and a link to `/manage/employees/<employeeId>` personal info; Approve stays enabled;
  - `onApprove` receives `travelBooking: true`.
  - With `travel_eligible: false` the checkbox is absent.
- [ ] **Step 3:** Run both → FAIL.
- [ ] **Step 4:** Implement migration, actions, dialog, queue wiring, and a «نیاز به رزرو سفر» switch on `/manage/requests` rows that are approved daily errands (visible to hr/admin; disabled with tooltip once booking started). Switching it on there shows the same missing-info warning from `getTravelMissingFields` before saving. `travel_eligible` = `kind='errand' && unit='day'` and the chosen step is the hr step (`perDiem` flag).
- [ ] **Step 5:** Dry-run Tasks 2+3 migrations with the scenario → PASS. Apply both, `npm run schema:dump`, restart rest. Run `npx vitest run tests/unit/travel-fields.test.ts tests/unit/permissions-catalog.test.ts tests/unit/travel-tick-dialog.test.tsx` → PASS. `npx tsc --noEmit` → 0.
- [ ] **Step 6:** Commit Tasks 2–3 — "Travel booking tables, permission and HR tick (FR-70)".

### Task 4: Procurement page — list, live traveller details, save, done

**Files:**
- Create: `supabase/migrations/20261020120003_travel_booking_procurement.sql`
- Modify: `tests/sql/travel-booking.sql` (section "procurement")
- Modify: `lib/actions/travel.ts`, `lib/supabase/types.ts`, `lib/nav/tabs.ts`, `messages/*.json`
- Create: `app/[locale]/(app)/procurement/page.tsx`, `app/[locale]/(app)/procurement/ProcurementList.tsx`, `app/[locale]/(app)/procurement/[id]/page.tsx`, `app/[locale]/(app)/procurement/[id]/BookingForm.tsx`
- Modify: `app/[locale]/(app)/request/MyRequestsList.tsx` (traveller sees transport + note)
- Test: `tests/unit/nav_tabs.test.ts` (extend), `tests/unit/booking-form.test.tsx`

**Interfaces:**
- Produces (SQL):
  - `private.is_procurement(p_uid uuid, p_request uuid) returns boolean` — active, same company, `p_uid <> employee_id`, `private.is_admin(p_uid) or private.has_perm(p_uid,'travel_booking','edit')`. **No `can_act_on`** (spec §3).
  - `public.app_travel_bookings() returns table(request_id uuid, serial_year int, serial_seq int, employee_name text, personnel_no text, department_name_fa text, department_name_en text, errand_location text, start_date date, end_date date, state text, transport text, flight_cost_rials bigint, hotel_cost_rials bigint, lost_rials bigint, done_at timestamptz)` — caller must hold `travel_booking` edit (or admin); company rows with state not in (`awaiting_approval`,`hidden`); excludes the caller's own trips. No personal fields.
  - `public.app_travel_booking(p_request uuid) returns jsonb` — `is_procurement` required; trip fields, description, state, booking fields, approved extension reasons, and `traveller` object **only when open**: open = state in (`to_book`,`extension`,`cancel_undo`) or (`done` and `end_date >= today`). `traveller` keys exactly `travel_traveller_fields()`, read live.
  - `public.app_save_travel_booking(p_request uuid, p_transport text, p_flight bigint, p_hotel bigint, p_note text, p_done boolean) returns void` — `is_procurement`; state in (`to_book`,`extension`) or (`done` and `end_date >= today`); `p_done` requires transport and both costs non-null; a `done` booking may only be saved with `p_done = true` (`22023` otherwise); sets `first_saved_at` once and `done_by/at` when `p_done`. Audit `travel_booking.save` with `{done, transport}` (no costs needed in audit beyond the row).
  - `public.my_travel_bookings() returns table(request_id uuid, transport text, traveller_note text)` — caller's own requests with `done_at` not null and status approved. No costs.
- Produces (TS): `listTravelBookings()`, `getTravelBooking(id)`, `saveTravelBooking(input: {requestId: string; transport: 'flight'|'company_car'; flightCostRials: number; hotelCostRials: number; note: string; done: boolean})`, `getMyTravelBookings()`. Nav: `TabKey`/`ManageKey` gain `'procurement'` (`/procurement`), allowed by `can(perms,'travel_booking','edit')`; tab for holders without a Manage group, Manage item otherwise — same rule as `FINANCE_TAB`.

- [ ] **Step 1: Failing SQL tests:**
  - `procurement sees approved ticked trip as to_book`; `pending ticked trip not listed`; `unticked trip not listed`.
  - `traveller info is live` — read `traveller.national_id`, update `employee_personal_info.national_id` as hr, read again → new value.
  - `traveller fields exactly the placeholder five` — `jsonb_object_keys(traveller)` sorted = sorted constant.
  - `no self-booking` — proc files a daily errand, gets ticked and approved: `app_travel_booking` → `42501`; `app_save_travel_booking` → `42501`; list excludes it; proc2 can book it.
  - `employee without permission refused` → `42501`.
  - `done needs transport and costs` → `22023`; `company car with 0 flight cost` → ok, state `done`.
  - `done trip after end is read-only` — save → `22023`.
  - `done trip after end hides traveller` — set dates in the past (superuser), `traveller` key absent, costs still present.
  - `traveller sees note not costs` — `my_travel_bookings()` row has note and transport; function has no cost columns.
- [ ] **Step 2: Failing unit tests:** `nav_tabs.test.ts` — `procurement preset gets a Procurement tab`, `hr with travel_booking gets it under Manage`, `employee gets none`. `booking-form.test.tsx` — transport radio required for «رزرو شد»; flight cost input disabled and set to 0 when company car chosen; Rials parsed via `parseRials`, invalid input shows the existing per diem invalid message pattern; «ذخیره» saves without done.
- [ ] **Step 3:** Run → FAIL.
- [ ] **Step 4:** Implement migration, actions, nav, pages. List groups by state in the order To book, Extension: update the booking, Cancelled: undo the booking, Done; each row links to `/procurement/[id]`. Detail shows trip, traveller block (or "details hidden — trip closed"), form. Page guard: `requireCaller({ perm: ['travel_booking','edit'] })`. Add a Home count card for holders (to_book + extension + cancel_undo) beside `PendingApprovalsCard`. My Requests shows «وسیله سفر» + note under a done daily errand.
- [ ] **Step 5:** Dry-run → PASS; apply, dump, restart rest; `npx vitest run tests/unit/nav_tabs.test.ts tests/unit/booking-form.test.tsx tests/unit/main-nav.test.tsx` → PASS; `npx tsc --noEmit` → 0.
- [ ] **Step 6:** Commit — "Procurement booking page with live traveller details (FR-70)".

### Task 5: Extension — manager requests, HR decides

**Files:**
- Create: `supabase/migrations/20261020120004_errand_extensions.sql`
- Modify: `tests/sql/travel-booking.sql` (section "extension")
- Modify: `lib/actions/travel.ts`, `lib/supabase/types.ts`, `messages/*.json`
- Create: `app/[locale]/(app)/manage/approvals/ExtendTripDialog.tsx`, `app/[locale]/(app)/manage/approvals/ExtensionDecisionCard.tsx`
- Modify: `app/[locale]/(app)/manage/approvals/page.tsx` (two new sections), `lib/actions/leave/progress.ts` + the FR-64 progress component (extension block), `app/[locale]/(print)/print/request/[id]/page.tsx` (extension line), `app/[locale]/(app)/request/MyRequestsList.tsx` (pending extension note)
- Modify: the `team_leave_calendar` view (in this migration) to add pending extension days
- Test: `tests/unit/extend-trip-dialog.test.tsx`

**Interfaces:**
- Produces (SQL):
  - `public.app_extendable_trips() returns table(request_id uuid, serial_year int, serial_seq int, employee_name text, errand_location text, start_date date, end_date date, pending_extension boolean)` — caller's direct reports (`profiles.manager_id = caller`; admin: company), approved daily errands with an opened booking, `end_date >= today`.
  - `public.app_request_errand_extension(p_request uuid, p_new_end date, p_reason text) returns uuid` — caller is the employee's direct manager or admin (not the employee); state ∈ (`to_book`,`extension`,`done`); `end_date >= today`; `p_new_end > end_date`; no pending extension; overlap check on `(end_date + 1, p_new_end)` against the employee's other `pending|approved` requests (same predicate as `submit_leave_impl`, day unit). Inserts `pending`. **If** `approval_request_policy.hr_exempt_step_ids` for the request is non-empty → decide at once via the internal approve path with `evidence = 'exempt'`, no signature, per diem untouched. Audit `errand_extension.request`.
  - `public.app_pending_errand_extensions() returns table(extension_id uuid, request_id uuid, serial_year int, serial_seq int, employee_name text, errand_location text, start_date date, old_end_date date, new_end_date date, reason text, requested_by_name text, per_diem_rials bigint, delegation_uncovered boolean)` — hr role holders and admin, company, excluding the caller's own trips. `delegation_uncovered` = an `approval_delegations` row with `source_request_id = request` and `revoked_at is null`.
  - `public.app_decide_errand_extension(p_extension uuid, p_approve boolean, p_signature_data text, p_signature_authorized boolean, p_per_diem_rials bigint default null, p_note text default null) returns void` — `is_travel_hr` on the request; approve requires signature (same validation as `private.attach_request_signature`), takes `approval_lock(company)` then the employee lock, **re-runs the overlap check** (refuse `22023 'overlapping leave request exists'`, extension stays pending), sets `leave_requests.end_date = new_end_date`, recomputes `requested_minutes` via `public.compute_requested_minutes(company, start_date, new_end, 'full', 'day', null, null, 'errand')`, sets `travel_bookings.done_at = null`, and when `p_per_diem_rials` is not null sets `per_diem_rials` and `per_diem_by_requester = false` (recording `per_diem_before/after`). Reject stores the note. Audit `errand_extension.approve|reject`.
  - `public.request_errand_extensions(p_id uuid) returns table(new_end_date date, old_end_date date, reason text, status text, evidence text, requested_by_name text, decided_by_name text, decided_at timestamptz)` — same visibility as `request_approval_progress(p_id)`.
  - `team_leave_calendar`: append rows for pending extensions (`start_date = old_end_date + 1`, `end_date = new_end_date`, status `pending`) with the view's existing column list and visibility filter.
- Produces (TS): `listExtendableTrips()`, `requestExtension({requestId, newEndDate, reason})`, `listPendingExtensions()`, `decideExtension({extensionId, approve, signatureData, signatureAuthorized, perDiemRials, note})`, `getRequestExtensions(requestId)`.

- [ ] **Step 1: Failing SQL tests:**
  - `manager requests extension` → pending row; `employee cannot request own` → `42501`; `other manager refused` → `42501`.
  - `new end must be later` → `22023`; `second pending refused` → `23505` or `22023`; `ended trip refused` → `22023`; `unbooked (no tick) refused` → `22023`.
  - `extension request overlap refused` — worker has approved leave on `end_date + 1` → `22023`.
  - `extension approve rechecks conflicts` — request extension, then worker files leave on an extra day, hr approves → `22023`, extension still `pending`, `end_date` unchanged.
  - `hr approves` → `end_date` = new, `requested_minutes` recomputed, booking state `extension`, `old_end_date` kept on the row; with per diem 900000 → `per_diem_rials = 900000`, `per_diem_by_requester = false`.
  - `hr rejects` → status `rejected`, `end_date` unchanged, booking state unchanged.
  - `approve without signature refused` → `22023`.
  - `head of hr trip extension is exempt` — head files with own per diem 500000 (FR-68 path), approved, admin ticks, manager requests extension → status `approved`, `evidence = 'exempt'`, `per_diem_rials = 500000`, `per_diem_by_requester = true`.
  - `delegation_uncovered flag` — head's trip with a temporary delegation sourced from it → `true`.
  - `calendar shows pending extension days` — `team_leave_calendar` has a `pending` row for the extra days.
- [ ] **Step 2: Failing unit test** `extend-trip-dialog.test.tsx`: Jalali date picker refuses dates `<= end_date` (inline error), reason required (trimmed), submit calls `requestExtension` with ISO date. `ExtensionDecisionCard` shows reason, old → new dates, the delegation warning when `delegation_uncovered`, per diem input prefilled empty, signature required to approve.
- [ ] **Step 3:** Run → FAIL.
- [ ] **Step 4:** Implement. `/manage/approvals` gains «تمدید ماموریت» sections: "Trips you can extend" (managers/admin, from `app_extendable_trips`) and "Extension requests" (hr/admin, from `app_pending_errand_extensions`). Progress component lists extensions under the steps. Print form adds under the dates: «تمدید تا {date} — {reason}» per approved extension. My Requests shows «درخواست تمدید تا {date} در انتظار تأیید» when pending.
- [ ] **Step 5:** Dry-run → PASS; apply, dump, restart rest; `npx vitest run tests/unit/extend-trip-dialog.test.tsx tests/unit/paper-form.test.ts tests/unit/my-requests-list.test.tsx` → PASS; `npx tsc --noEmit` → 0.
- [ ] **Step 6:** Commit — "Errand trip extensions: manager request, HR decision (FR-70)".

### Task 6: Cancellation, settlement, finance

**Files:**
- Create: `supabase/migrations/20261020120005_travel_cancel_finance.sql`
- Modify: `tests/sql/travel-booking.sql` (section "cancel & finance")
- Modify: `lib/actions/travel.ts`, `lib/actions/finance.ts` (type only), `lib/supabase/types.ts`, `app/[locale]/(app)/finance/FinanceList.tsx`, `app/[locale]/(app)/procurement/[id]/page.tsx` (settle form), `app/[locale]/(app)/manage/requests/RequestsReview.tsx` (HR cancel on travel trips), `messages/*.json`
- Create: `app/[locale]/(app)/procurement/[id]/SettleForm.tsx`, `lib/travel/totals.ts`
- Test: `tests/unit/travel-totals.test.ts`, `tests/unit/finance-travel-columns.test.tsx`

**Interfaces:**
- Produces (SQL):
  - `public.cancel_leave_request(p_id uuid)` — recreate from the **current** `supabase/schema.sql` body, adding one admit branch: `private.is_travel_hr(v_uid, p_id)` and the request has a `travel_bookings` row and `start_date > today`; and, inside the existing locked section after the status flips, `update errand_extensions set status = 'cancelled' where request_id = p_id and status = 'pending'`. Everything else unchanged.
  - `public.app_settle_travel_booking(p_request uuid, p_lost bigint, p_note text) returns void` — `is_procurement`; state `cancel_undo`; `p_lost >= 0`; sets `lost_rials`, `lost_note`, `settled_by/at`. Audit `travel_booking.settle`.
  - `public.finance_approved_requests(p_from date, p_to date)` — drop and recreate; same columns plus `travel_state text, transport text, flight_cost_rials bigint, hotel_cost_rials bigint, lost_rials bigint, status public.leave_status`. Rows: as today, **minus** approved requests with a booking whose state ≠ `done`, **plus** cancelled requests with state `settled` (per diem returned as null for those).
- Produces (TS): `settleTravelBooking({requestId, lostRials, note})`; `lib/travel/totals.ts` → `tripTotal(row: Pick<FinanceRow,'status'|'per_diem_rials'|'flight_cost_rials'|'hotel_cost_rials'|'lost_rials'>): number` — cancelled: `lost_rials ?? 0`; else `per_diem + flight + hotel`, nulls as 0.

- [ ] **Step 1: Failing SQL tests:**
  - `hr cancels future travel trip` → status `cancelled`, booking state `cancel_undo`; `hr cannot cancel non-travel request` → `42501`; `hr cannot cancel started trip` → `42501`/`22023` (whichever the admit branch yields — assert not ok and status unchanged).
  - `cancel cancels pending extension` → extension `cancelled`.
  - `requester cancels own booked trip` → `cancel_undo`.
  - `cancel of never-approved ticked trip` → state `hidden`, not in `app_travel_bookings()`.
  - `settle` → state `settled`; `settle 0 allowed`; `settle twice refused` → `22023`.
  - `finance excludes to_book trip`, `finance includes done trip with costs`, `finance includes settled trip with lost only` (per diem null), `finance unchanged for non-travel errand`.
- [ ] **Step 2: Failing unit tests:** `travel-totals.test.ts` — `done trip sums per diem + flight + hotel` (500000+3000000+2000000 → 5500000); `company car hotel only` (0 flight); `cancelled uses lost only` (lost 400000, per diem 500000 → 400000); `nulls count as 0`. `finance-travel-columns.test.tsx` — rows render transport label, flight, hotel, lost, total; cancelled row shows «لغو شده» badge; CSV header gains the five columns; totals row sums `tripTotal`.
- [ ] **Step 3:** Run → FAIL.
- [ ] **Step 4:** Implement migration (cancel body copied from `schema.sql` at implementation time, not from memory), settle form («چیزی رزرو نشده بود» button = 0), HR cancel button on `/manage/requests` for travel trips (reuse `RequestCancelButton`), finance columns + CSV + totals.
- [ ] **Step 5:** Dry-run full `tests/sql/travel-booking.sql` plus `tests/sql/hr-head-own-per-diem.sql` and `tests/sql/approval-delegation.sql` against the new migration (regressions) → PASS. Apply, dump, restart rest. `npm run test:unit` → all pass; `npm run lint` → 0; `npx tsc --noEmit` → 0; `npm run build` → success.
- [ ] **Step 6:** Commit — "Travel trip cancellation, settlement and finance columns (FR-70)".

### Task 7: Docs and manual check

**Files:**
- Modify: `docs/REQUIREMENTS.md` (FR-70), `docs/DATA_MODEL.md` (two tables, state derivation, finance columns), `docs/PERMISSIONS.md` (catalog item, preset, RPC gates, no `can_act_on`, no self-booking, HR travel cancel branch), `docs/CHANGELOG.md`, `docs/TASKS.md` (open: confirm traveller field list with procurement), `docs/AGENT-LOG.md`; spec status → implemented.

- [ ] **Step 1:** Write the docs. FR-70 one paragraph in the existing style, citing the spec.
- [ ] **Step 2:** Manual walk-through on the local stack (LAN URL from `deploy/.env`) with synthetic users only — never real roster people: manager approves → HR ticks with missing-info warning → procurement books company car + hotel → finance shows totals → manager extends → HR approves → procurement updates → HR cancels another trip → procurement settles. Screenshot procurement detail and finance.
- [ ] **Step 3:** Commit docs — "Document travel booking (FR-70)". Push only when the owner asks (push to `main` deploys to Liara).
