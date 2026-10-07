# Clearance form (FR-54) Implementation Plan

> Executed natively in the session that wrote it (Amir: "write the plan and spec, then build it").
> Steps use checkbox syntax. Repo convention: no commits unless Amir asks — "commit" steps are
> replaced by "stop and verify".

**Goal:** HR files a فرم تسویه حساب for a leaver; listed units sign in parallel, finance signs last,
and the account switches itself off the day after the last working day.

**Architecture:** Three new tables (`separation_units`, `separations`, `separation_signoffs`) written
only through security-definer RPCs; RLS for reads. A pg_cron job calls
`private.apply_due_separations()` nightly. UI lives under `/profile/clearance` plus a print route.

**Tech stack:** Postgres 15 (supabase image) + pg_cron 1.6, PostgREST, Next.js App Router server
actions, next-intl, Vitest, Playwright.

**Spec:** `docs/specs/2026-10-07-clearance-form-design.md`

**Status (2026-10-07): executed.** Deviations from the tasks below, all reflected in the spec:
a third migration `20261007150003_clearance_read.sql` (`app_list_separations`,
`app_get_separation`: signers cannot read the profiles named on a form); a fourth unit kind
`own_department` (the paper's «واحد مربوطه»); `getClearanceSetup` / `getClearanceSummary` /
`getClearanceSignaturesForPrint` in place of the planned context helpers; the print page imports
`PrintToolbar` from the request print folder.

## Global constraints

- Dates stored Gregorian; Jalali only at the UI edge. "Today" in SQL = `(now() at time zone 'Asia/Tehran')::date`.
- New enum value in its own migration file (`20261007150001_finance_role.sql`), used only from `20261007150002_clearance_form.sql`.
- Never edit an applied migration; dry-run in `begin … rollback` as `supabase_admin` first.
- Every RPC: `security definer`, `set search_path to ''`, `revoke all … from public`, `grant execute … to authenticated`.
- New grants go through `private.has_permission(uid, key)`: `separations.manage` (admin, hr), `separations.view` (admin, hr, finance).
- Signature PNG check identical to `leave_request_approvals_signature_shape`; TS side `isValidSignatureData`.
- Server actions start with `requireCaller(...)`; `if (!c.ok) return c;`.
- All user-facing strings in `messages/fa.json` + `messages/en.json` (key `clearance`); no dynamic message keys (explicit maps).
- `lib/supabase/types.ts` is hand-edited.
- FKs to `profiles`: leaver `on delete cascade`; every actor/signer column `on delete set null` (so `app_cleanup_e2e_users` keeps working unchanged).

## Review focus

1. **Cron as no user** — `auth.uid()` is null under pg_cron; `enforce_profile_update_scope` must let the apply function flip `active` (GUC `bj.separation_apply`), and `preserve_active_admin` raising for one row must not abort the others. Test: SQL scenario runs apply with no JWT claims.
2. **Reactivated after apply** — HR reactivates someone whose form already applied; the next nightly run must not switch them off again (`deactivated_at` set). Test: SQL scenario.
3. **Leaver holds hr / finance** — they must not sign their own HR row or finance block. Test: SQL scenario.
4. **Removing the last unsigned row** — status must move to `awaiting_finance`, and an all-signed form with zero non-HR rows still needs the HR row. Test: SQL scenario.
5. **Last working day today vs yesterday** — today's last day must NOT deactivate; yesterday's must, immediately on filing. Test: SQL scenario.

---

### Task 1: Database (migrations + SQL scenarios)

**Files:**
- Create: `supabase/migrations/20261007150001_finance_role.sql`
- Create: `supabase/migrations/20261007150002_clearance_form.sql`
- Create: `tests/sql/fr54-clearance.sql`
- Modify: `supabase/schema.sql` (regenerated), `lib/supabase/types.ts` (hand-edited)

**Interfaces produced (SQL):**
- `public.app_create_separation(p_employee_id uuid, p_reason text, p_last_working_day date, p_father_name text, p_birth_cert_no text, p_note text, p_rows jsonb) returns uuid` — rows: `[{"name_fa","name_en","department_id"?,"signer_id"?}]`
- `public.app_update_separation(p_id uuid, p_reason text, p_last_working_day date, p_note text) returns void`
- `public.app_set_separation_signoffs(p_id uuid, p_rows jsonb) returns void` — rows: `[{"id"?,"name_fa","name_en","department_id"?,"signer_id"?}]`; rows with `id` keep identity (signed ones must be unchanged)
- `public.app_sign_separation_row(p_row_id uuid, p_signature_data text, p_signature_authorized boolean, p_note text) returns void`
- `public.app_sign_separation_finance(p_id uuid, p_signature_data text, p_signature_authorized boolean, p_note text, p_settlement_date date) returns void`
- `public.app_cancel_separation(p_id uuid) returns void`
- `public.app_save_separation_units(p_units jsonb) returns void` — `[{"id"?,"kind","name_fa","name_en","department_id"?,"signer_id"?,"active"}]`; the hr unit may only be renamed
- `public.app_separation_warnings(p_employee_id uuid) returns jsonb` — `{pending_requests:int, direct_reports:int, manages_departments:int, approval_steps:int}`
- `private.apply_due_separations(p_id uuid default null) returns int`
- error texts (for `lib/errors/db-error.ts`): `employee already has an open clearance form`, `cannot file a clearance form for yourself`, `not allowed to file a clearance form for this employee`, `invalid reason`, `form is not open for changes`, `row is not yours to sign`, `row already signed`, `signed rows cannot be changed`, `form is not awaiting finance`, `you cannot sign your own clearance form`, `form already applied`, `row has no signer yet`, `the HR row cannot be removed`

- [ ] **Step 1: Write `tests/sql/fr54-clearance.sql`** — same harness as `tests/sql/fr51-hr-employee-admin.sql` (`fx` temp table, `pg_temp.try_as`, PASS/FAIL notices, `rollback`). Fixtures: admin, hr, finance, mgr (department manager of dept D), worker (in D), it_person, other. Scenarios:
  1. employee/manager cannot call create → 42501; hr can; hr cannot file for self; hr cannot file for an admin; admin can file for hr.
  2. second create for the same employee → error; after cancel → allowed.
  3. HR row is added automatically, exactly one, even when `p_rows` contains a row named HR.
  4. department row resolves signer = department manager; department with no manager → signer null.
  5. personal info write-back: empty father_name gets filled; a present one is not overwritten.
  6. sign: non-signer → error; signer → ok; second sign → `row already signed`; hr signs HR row; admin signs HR row; leaver who holds hr cannot sign HR row.
  7. unassigned row cannot be signed (`row has no signer yet`).
  8. status: after last row signed → `awaiting_finance`; finance before that → error; finance (not leaver) → `completed`; non-finance → 42501.
  9. set_signoffs: removing the last unsigned row moves to `awaiting_finance`; changing a signed row → error; removing HR row impossible.
  10. visibility: worker (leaver) reads own form; it_person (signer) reads it; other reads 0 rows; finance reads all.
  11. apply: last day = today → not applied; last day = yesterday at create → `active=false`, `deactivated_at` set, pending leave cancelled, approved leave untouched.
  12. apply with NO jwt claims (cron) deactivates a due form whose filing used `update` to move the date into the past.
  13. reactivate after apply, run apply again → stays active.
  14. cancel after apply → `form already applied`.
  15. units: hr saves units; HR unit cannot be removed or deactivated; employee cannot save.
- [ ] **Step 2: Dry-run** the scenarios without the migration → expect errors (functions missing).
- [ ] **Step 3: Write migration 1** (`alter type public.app_role add value if not exists 'finance';`).
- [ ] **Step 4: Write migration 2**: extension `pg_cron`; tables + checks + indexes + RLS; `has_permission` (re-create with the two new keys, keeping the four existing ones verbatim); `enforce_profile_update_scope` (re-create verbatim from `supabase/schema.sql` plus, at the top: `if coalesce(current_setting('bj.separation_apply', true), '') = 'on' then` allow only an `active` true→false change); RPCs above; seed `separation_units` for every company; `cron.schedule('bj-apply-separations', '35 20 * * *', 'select private.apply_due_separations()')`.
- [ ] **Step 5: Dry-run** migration 1, then (`begin; \i migration2; \i scenarios; rollback`) → all PASS. Fix until green.
- [ ] **Step 6: Apply locally** with `./deploy/bj-deploy update local` (from the main checkout), restart `bj-erp-rest-1`, `npm run schema:dump`, re-run scenarios on the migrated DB → all PASS; re-run `tests/sql/fr51-hr-employee-admin.sql` and `tests/sql/fr52-53-signature-personal-info.sql` → still PASS.
- [ ] **Step 7: Hand-edit `lib/supabase/types.ts`**: three tables, the RPCs' Args/Returns, `app_role` gets `"finance"`. `npx tsc --noEmit` clean.

### Task 2: Pure helpers + finance role in TS

**Files:**
- Create: `lib/clearance/model.ts`, `tests/unit/clearance-model.test.ts`
- Modify: `lib/employees/editCapabilities.ts` (`ROLES` + `'finance'`), `app/[locale]/(app)/manage/employees/page.tsx` (`ROLE_ORDER`), `app/[locale]/(app)/layout.tsx` (`ROLE_PRIORITY`), `tests/unit/edit-capabilities.test.ts`

**Interfaces produced (`lib/clearance/model.ts`):**
```ts
export const SEPARATION_REASONS = ['resignation','dismissal','contract_end','abandonment','redundancy'] as const;
export type SeparationReason = (typeof SEPARATION_REASONS)[number];
export type SeparationStatus = 'in_progress' | 'awaiting_finance' | 'completed' | 'cancelled';
export type UnitKind = 'hr' | 'department' | 'person';
export type SignoffRow = { id: string; isHr: boolean; nameFa: string; nameEn: string; departmentId: string | null; signerId: string | null; signerName: string | null; sortOrder: number; signedBy: string | null; signedByName: string | null; signedAt: string | null; note: string | null };
export type DraftRow = { key: string; unitId: string | null; isHr: boolean; nameFa: string; nameEn: string; departmentId: string | null; signerId: string | null };
export function isSeparationReason(v: unknown): v is SeparationReason;
/** Rows a new form starts with: active units in order, department units resolved to that department's manager. */
export function draftRowsFromUnits(units: UnitRow[], departmentManagers: Map<string, string | null>): DraftRow[];
/** Can this caller sign this row? (mirror of the SQL rule, for showing the button) */
export function canSignRow(row: SignoffRow, caller: { id: string; roles: string[] }, leaverId: string, status: SeparationStatus): boolean;
export function canSignFinance(caller: { id: string; roles: string[] }, leaverId: string, status: SeparationStatus): boolean;
export function rowsPayload(rows: DraftRow[]): Array<{ id?: string; name_fa: string; name_en: string; department_id?: string; signer_id?: string }>;
```
- [ ] Step 1: failing tests: reasons guard; draft rows (inactive skipped, order kept, department → manager, missing manager → null signer, HR row first and locked); `canSignRow` (signer yes, other no, HR row for hr/admin, leaver never, signed never, not in_progress never, unassigned never); `canSignFinance`; `rowsPayload` drops the HR row and empty optionals.
- [ ] Step 2: run `npx vitest run tests/unit/clearance-model.test.ts` → FAIL.
- [ ] Step 3: implement. Step 4: PASS. Add `finance` to the three role lists and the edit-capabilities test; `npm run test:unit` green.

### Task 3: Server actions

**Files:**
- Create: `lib/actions/clearance.ts`
- Modify: `lib/errors/db-error.ts` (keys for the Task 1 error texts), `messages/*.json` (`errors.*`)

**Interfaces produced:**
```ts
getClearanceOverview(): Promise<{ ok: true; awaiting: ClearanceListItem[]; mine: ClearanceListItem | null; all: ClearanceListItem[] | null; canManage: boolean } | { ok: false; error: string }>
getClearanceAwaitingCount(): Promise<number>
getClearance(id: string): Promise<{ ok: true; form: ClearanceDetail } | { ok: false; error: string }>
getClearanceSignature(kind: 'row' | 'finance', id: string): Promise<{ ok: true; signatureData: string; consentAt: string } | { ok: false; error: string }>
getNewClearanceContext(): Promise<{ ok: true; employees: {id,name,personnelNo}[]; units: UnitRow[]; departments: {id,nameFa,nameEn,managerId}[]; people: {id,name}[] } | { ok: false; error: string }>
getLeaverPrefill(employeeId: string): Promise<{ ok: true; fatherName: string | null; birthCertNo: string | null; hireDate: string | null; warnings: Warnings } | { ok: false; error: string }>
createClearance(input: { employeeId; reason; lastWorkingDay; fatherName; birthCertNo; note; rows: DraftRow[] }): Promise<{ ok: true; id: string } | { ok: false; error: string }>
updateClearance(id, { reason, lastWorkingDay, note }), setClearanceRows(id, rows), cancelClearance(id)
signClearanceRow(rowId, { signatureData, signatureAuthorized, note })
signClearanceFinance(id, { signatureData, signatureAuthorized, note, settlementDate })
saveClearanceUnits(units: UnitRow[])
```
Every action: `requireCaller`, validate input shape (reason guard, ISO date regex, signature via `isValidSignatureData`), call RPC, `dbErr(error.message)`, `invalidateAppCache()` after writes. Reads go through RLS-scoped selects; list queries never select `signature_data`.
- [ ] Steps: write, `npx tsc --noEmit`, lint.

### Task 4: Profile entry, list page, Home card

**Files:**
- Create: `app/[locale]/(app)/profile/clearance/page.tsx`, `app/[locale]/(app)/profile/ClearanceCard.tsx`, `app/[locale]/(app)/home/ClearanceAwaitingCard.tsx`
- Modify: `app/[locale]/(app)/profile/page.tsx`, `app/[locale]/(app)/home/page.tsx` (+ `HomeBoard.tsx` if cards are placed there), `messages/*.json`

Card shown when roles include admin/hr/finance or the overview has awaiting/mine. List page: three sections, status badges, links to detail; "New form" + "Default rows" when `canManage`.
- [ ] Steps: build, check in browser as admin.

### Task 5: New-form page

**Files:** Create `app/[locale]/(app)/profile/clearance/new/page.tsx`, `.../new/NewClearanceForm.tsx`, `app/[locale]/(app)/profile/clearance/_components/RowsEditor.tsx` (shared with Task 6), `messages/*.json`.

Employee native `<select>` (searchable by typing), reason radios, `PersianDateField`, father/birth-cert inputs (read-only when prefilled), note textarea, `RowsEditor` (HR row locked; others: name fa/en, signer select of active people; add custom row; remove), warnings box. Submit → `createClearance` → redirect to detail.
- [ ] Steps: build, file a form in the browser for a throwaway employee.

### Task 6: Detail page, signing, edit, cancel

**Files:** Create `app/[locale]/(app)/profile/clearance/[id]/page.tsx`, `.../[id]/SignRowDialog.tsx`, `.../[id]/FinanceDialog.tsx`, `.../[id]/ManageActions.tsx`, `.../[id]/SignatureView.tsx`, `messages/*.json`.

Header facts + reason + last day + status + deactivated note; unused leave via `getEmployeeBalances` (admin/hr) — finance also needs it, so `getClearance` returns balances computed through a security-definer read allowed for `separations.view` (`app_separation_balances(p_id) returns table(leave_type_id, name_fa, name_en, balance_minutes)`, added to Task 1 migration). Rows table; sign dialogs reuse `RequestSignatureFields`; manage actions: edit reason/date, edit rows (`RowsEditor`), cancel (AlertDialog).
- [ ] Steps: build; sign through every row and finance in the browser.

### Task 7: Default rows editor

**Files:** Create `app/[locale]/(app)/profile/clearance/units/page.tsx`, `.../units/UnitsEditor.tsx`, `messages/*.json`. Kind select (department/person), department or person select, name fa/en, active, up/down order; HR row rename only. Save → `saveClearanceUnits`.

### Task 8: Print page

**Files:** Create `app/[locale]/(print)/print/clearance/[id]/page.tsx` (reuses `PrintToolbar` via import from the request print folder), `messages/*.json` (`print.clearance.*`). Layout per spec §2; footnote for the blank approver box.

### Task 9: e2e

**Files:** Create `tests/e2e/clearance.spec.ts`. Admin creates hr, finance, it-person, leaver A, leaver B (throwaway `999…`). hr files A with yesterday's last day → A cannot log in. hr files B with a future day, rows: HR + one person row (it-person) → it-person signs, hr signs HR row, finance signs → completed; print page shows the rows. Run `--workers=1` with regression specs `hr-employee-admin`, `signature-personal-info`, `approval`.

### Task 10: Docs + verification

REQUIREMENTS FR-54, DATA_MODEL, PERMISSIONS, CHANGELOG, TASKS, AGENT-LOG, CLAUDE.md gotcha (pg_cron job + GUC). Final: `npm run lint`, `npx tsc --noEmit`, `npm run test:unit`, `npm run build`, `npm run test:deploy`.
