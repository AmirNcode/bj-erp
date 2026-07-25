# Employee Onboarding & Logout UX — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** Ship the four features in `docs/specs/2026-07-13-employee-onboarding-design.md`:
confirmed logout, generated employee codes, manager-scoped employee creation, admin CSV bulk
import with one-time credentials export.

**Architecture:** One migration adds department codes + personnel numbers and rebuilds
`app_create_employee` around a shared `private.create_employee_impl`, which a new admin-only
`app_bulk_create_employees(jsonb)` reuses row-by-row in one transaction. UI: role-adaptive
new-employee form, a departments card in settings, a 3-stage import page with client-side CSV
parsing, and checkbox bulk password regeneration on the employees list.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres RPCs, SECURITY DEFINER), next-intl,
`react-date-object` (Jalali), Vitest, Playwright.

## Global Constraints

- Farsi-first: every new string in **both** `messages/fa.json` and `messages/en.json`, identical key trees.
- Logical CSS only (`start-*`/`end-*`); native `<select>`/checkbox for anything e2e touches.
- Every mutating server action calls `invalidateAppCache()` (`lib/cache/invalidate-app.ts`).
- Ledger writers take `pg_advisory_xact_lock(hashtextextended('leave:' || employee_id, 0))` first.
- Preserve existing `data-testid`s (`settings-logout`, `alloc-days-*`, `done-link`, …).
- Dates in DB are Gregorian; Jalali converts at the UI/import edge.
- No `service_role`; privileged work only via guarded SECURITY DEFINER RPCs.
- e2e users must match cleanup patterns (Task 3 extends them: personnel numbers `999#######`).
- **Commits:** Amir approves commits explicitly. Prepare clean per-task diffs; only commit when he says so.

---

## Batch A — Logout

### Task 1: Relocate logout + confirmation dialog

**Files:**
- Create: `app/[locale]/(app)/profile/LogoutButton.tsx`
- Modify: `app/[locale]/(app)/profile/SettingsForm.tsx` (remove logout button + its `logout` label prop)
- Modify: `app/[locale]/(app)/profile/page.tsx` (render `<LogoutButton>` after the last Card)
- Modify: `messages/fa.json`, `messages/en.json` (`profile.logoutConfirm.*`)
- Modify: `tests/e2e/settings.spec.ts:38` (click confirm after trigger)

**Interfaces:**
- Consumes: `signOut(locale)` from `lib/actions/profile.ts` (unchanged).
- Produces: `<LogoutButton locale labels={{trigger,title,body,cancel,confirm}} />`.

- [ ] **Step 1:** New client component — full-width destructive-outline trigger (keeps
  `data-testid="settings-logout"`) + shadcn `AlertDialog` (`components/ui/alert-dialog.tsx`);
  confirm button `data-testid="logout-confirm"` runs `signOut(locale)` in a transition:

```tsx
'use client';
import { useTransition } from 'react';
import { signOut } from '@/lib/actions/profile';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

type Props = { locale: string; labels: { trigger: string; title: string; body: string; cancel: string; confirm: string } };

export function LogoutButton({ locale, labels }: Props) {
  const [isPending, startTransition] = useTransition();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" data-testid="settings-logout" disabled={isPending}
          className="w-full border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive">
          {labels.trigger}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{labels.title}</AlertDialogTitle>
          <AlertDialogDescription>{labels.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{labels.cancel}</AlertDialogCancel>
          <AlertDialogAction data-testid="logout-confirm"
            className="bg-destructive text-white hover:bg-destructive/90"
            onClick={() => startTransition(async () => { await signOut(locale); })}>
            {labels.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 2:** Strip the logout `<Button>` (and unused `signOut` import + `logout` label) from
  `SettingsForm.tsx`; render `<LogoutButton>` in `page.tsx` after the password Card, inside the
  existing `space-y-4` main. Messages:
  `fa: {trigger:"خروج از حساب", title:"خروج از حساب؟", body:"برای ورود دوباره باید کد پرسنلی و رمز عبور را وارد کنید.", cancel:"انصراف", confirm:"خروج"}`,
  `en: {trigger:"Log out", title:"Log out?", body:"You will need your employee code and password to sign in again.", cancel:"Cancel", confirm:"Log out"}`.
- [ ] **Step 3:** Update `tests/e2e/settings.spec.ts` logout flow: click `settings-logout`, assert
  dialog visible, click `logout-confirm`, assert redirect to `/login`. Add a cancel assertion
  (click `settings-logout`, click the Cancel button, assert still on `/profile`).
- [ ] **Step 4:** Run `npx playwright test tests/e2e/settings.spec.ts --workers=1` → PASS.

---

## Batch B — Codes, personnel numbers, manager-scoped creation

### Task 2: Schema migration + seed updates

**Files:**
- Create: `supabase/migrations/20260713120001_employee_onboarding.sql` (part 1 of the file)
- Modify: `supabase/seed.sql` (department inserts gain `code`; idempotent code backfill updates)

- [ ] **Step 1:** Migration — columns, backfill, constraints:

```sql
-- 1) departments.code — latin prefix for generated employee codes
alter table public.departments add column if not exists code text;

update public.departments set code = c.v
from (values ('Production Line A','prod'),('Quality Control','qc'),
             ('Maintenance','mant'),('Security','sec')) as c(n,v)
where name_en = c.n and code is null;

-- generic fallback for any other pre-existing department
with slugged as (
  select id, coalesce(nullif(substring(lower(regexp_replace(name_en,'[^a-zA-Z0-9]','','g')) from 1 for 4),''),'dept') as base
  from public.departments where code is null
), numbered as (
  select id, base, row_number() over (partition by base order by id) as rn from slugged
)
update public.departments d
set code = case when n.rn = 1 then n.base else substring(n.base from 1 for 4) || n.rn::text end
from numbered n where d.id = n.id;

alter table public.departments alter column code set not null;
alter table public.departments add constraint departments_code_format check (code ~ '^[a-z0-9]{2,6}$');
create unique index if not exists departments_company_code_key on public.departments (company_id, code);

-- 2) profiles: personnel number (client HR number) + display-only job title
alter table public.profiles add column if not exists personnel_no text;
alter table public.profiles add column if not exists job_title text;
alter table public.profiles add constraint profiles_personnel_no_format
  check (personnel_no is null or personnel_no ~ '^[0-9]{1,10}$');
create unique index if not exists profiles_company_personnel_no_key
  on public.profiles (company_id, personnel_no) where personnel_no is not null;
```

- [ ] **Step 2:** `supabase/seed.sql`: add `code` to the departments insert values
  (`prod`,`qc`,`mant`,`sec`) and an idempotent `update ... set code = ... where code is distinct from ...`
  block so old installs align.
- [ ] **Step 3:** Apply to local Docker DB (`docker exec bj-erp-db-1 psql ... -f`), verify:
  `select name_en, code from departments;` → 4 rows with expected codes.

### Task 3: RPC rebuild — shared impl, v2 create, bulk create, cleanup patterns

**Files:**
- Modify: `supabase/migrations/20260713120001_employee_onboarding.sql` (part 2, same file)
- Modify: `lib/supabase/types.ts` (hand-add new columns + function signatures)

**Interfaces (produced, used by Tasks 5–8):**
- `public.app_create_employee(p_personnel_no text, p_full_name text, p_password text, p_company_id uuid, p_department_id uuid default null, p_manager_id uuid default null, p_roles app_role[] default '{employee}', p_hire_date date default null, p_language_pref text default 'fa', p_calendar_pref text default 'jalali', p_job_title text default null) returns uuid` — admin **or manager**; old text-code signature dropped.
- `public.app_bulk_create_employees(p_company_id uuid, p_rows jsonb) returns jsonb` — admin-only; rows `[{personnel_no, full_name, password, department_code, manager_personnel_no?, role: 'manager'|'employee', job_title?, hire_date?, annual_days?, sick_days?}]`; returns `[{personnel_no, employee_code, user_id}]`; raises on first bad row (all-or-nothing).
- `private.allocate_leave_impl(...)` — lock + allocation + ledger + audit, no auth check; public `allocate_leave` becomes guard + call.
- `private.create_employee_impl(...)` — auth.users + identities + profile + roles + audit, no auth check; code composed in-DB as `dept.code || '-' || personnel_no`.

- [ ] **Step 1:** Extract `private.allocate_leave_impl(p_actor uuid, p_employee_id uuid, p_leave_type_id uuid, p_period_start date, p_period_end date, p_days numeric) returns uuid` — body copied from the hardened `allocate_leave` (advisory lock, `leave_allocations` insert, `current_leave_balance` + `leave_ledger` insert, audit row, `auth.uid()` → `p_actor`). Recreate public `allocate_leave` as: admin check → `return private.allocate_leave_impl(auth.uid(), ...)`.
- [ ] **Step 2:** `private.create_employee_impl(p_actor uuid, p_path text, p_company_id uuid, p_department_id uuid, p_manager_id uuid, p_personnel_no text, p_full_name text, p_password text, p_roles app_role[], p_hire_date date, p_language_pref text, p_calendar_pref text, p_job_title text) returns uuid`:
  - validate `p_personnel_no ~ '^[0-9]{1,10}$'` (22023), password ≥ 8, department not null;
  - `select code into v_dept_code from public.departments where id = p_department_id and company_id = p_company_id` — missing → 22023 `department not found or has no code`;
  - `v_code := v_dept_code || '-' || p_personnel_no`; duplicate `personnel_no` (per company) or `employee_code` → 23505;
  - inserts copied from current v1 body (auth.users / auth.identities / profiles / user_roles), profiles insert extended with `personnel_no`, `job_title`;
  - audit row includes `personnel_no` and `p_path`.
- [ ] **Step 3:** Recreate `public.app_create_employee` (new signature above; **first** `drop function if exists public.app_create_employee(text,text,text,uuid,uuid,uuid,public.app_role[],date,text,text);`):

```sql
declare v_caller uuid := auth.uid(); v_dept uuid; v_mgr uuid; v_roles public.app_role[]; v_company uuid; v_uid uuid;
begin
  if private.is_admin(v_caller) then
    v_dept := p_department_id; v_mgr := p_manager_id; v_roles := p_roles; v_company := p_company_id;
  elsif private.has_role(v_caller, 'manager') then
    select department_id, company_id into v_dept, v_company from public.profiles where id = v_caller;
    if v_dept is null then raise exception 'manager has no department' using errcode = '22023'; end if;
    v_mgr := v_caller;                                  -- forced: own team
    v_roles := array['employee']::public.app_role[];    -- forced: employee only
  else
    raise exception 'admin or manager role required' using errcode = '42501';
  end if;

  v_uid := private.create_employee_impl(v_caller,
    case when private.is_admin(v_caller) then 'admin' else 'manager' end,
    v_company, v_dept, v_mgr, p_personnel_no, p_full_name, p_password,
    v_roles, p_hire_date, p_language_pref, p_calendar_pref, p_job_title);

  -- manager path: default quotas so the admin round-trip disappears
  if not private.is_admin(v_caller) then
    perform private.allocate_leave_impl(v_caller, v_uid, lt.id,
              date_trunc('year', current_date)::date,
              (date_trunc('year', current_date) + interval '1 year - 1 day')::date,
              lt.default_annual_quota_days)
    from public.leave_types lt
    where lt.company_id = v_company and lt.active and lt.affects_balance
      and coalesce(lt.default_annual_quota_days, 0) > 0;
  end if;
  return v_uid;
end;
```
  (matching `revoke ... from public, anon; grant execute ... to authenticated;` as v1 had —
  use `perform ... from` via a `for` loop if `perform ... from` syntax complains.)
- [ ] **Step 4:** `public.app_bulk_create_employees(p_company_id uuid, p_rows jsonb) returns jsonb` — admin-only guard; loop `jsonb_array_elements(p_rows)` **in order**; per row resolve `department_code` → dept id, `manager_personnel_no` → profile id (searching existing rows *and* rows created earlier this call via a temp array); role ∈ (`manager`,`employee`) else 22023; call `create_employee_impl`; then `allocate_leave_impl` for `annual_days` → leave type `name_en='Annual Leave'` and `sick_days` → `'Sick Leave'` when > 0 (missing leave type → exception, not skip); append `jsonb_build_object('personnel_no',…,'employee_code',…,'user_id',…)` to result. Whole function = one transaction: any raise rolls back all rows.
- [ ] **Step 5:** Replace `app_cleanup_e2e_users` adding pattern `or employee_code ~ '^[a-z0-9]{2,6}-999[0-9]{7}$'` (10-digit personnel numbers starting `999` are reserved for tests; document in the fn header comment).
- [ ] **Step 6:** Apply full migration to local Docker DB; smoke-test in psql: as-admin create via
  `select app_create_employee('9990000001','Test','Password1!', '<company>', '<dept>');` → code
  `prod-9990000001`; verify ledger rows exist for manager-path create; `select app_cleanup_e2e_users();` removes them.
- [ ] **Step 7:** Hand-extend `lib/supabase/types.ts`: `departments.code: string`,
  `profiles.personnel_no: string | null`, `profiles.job_title: string | null`, replace
  `app_create_employee` args, add `app_bulk_create_employees`.

### Task 4: Code-preview helper (pure) + unit tests

**Files:**
- Create: `lib/employees/code.ts`
- Test: `tests/unit/employee-code.test.ts`

**Interfaces:** `buildEmployeeCode(deptCode: string, personnelNo: string): string`,
`isValidPersonnelNo(v: string): boolean`, `normalizePersonnelNo(v: string): string` (trims,
converts Persian/Arabic-Indic digits ۰-۹ / ٠-٩ → 0-9).

- [ ] **Step 1:** Failing tests: builds `prod-1042`; rejects empty/11-digit/letters; normalizes
  `'۱۰۴۲'` → `'1042'`. **Step 2:** run (fail) → implement (mirror the SQL regexes exactly) → run (pass):
  `npx vitest run tests/unit/employee-code.test.ts`.

### Task 5: Departments card in Manage → Settings

**Files:**
- Create: `app/[locale]/(app)/manage/settings/DepartmentCodesForm.tsx`
- Modify: `app/[locale]/(app)/manage/settings/page.tsx` (admin-only card, fetch departments)
- Modify: `lib/actions/departments.ts` (create if absent) — `updateDepartmentCode(id, code)`
- Modify: `messages/fa.json` + `en.json` (`manage.settings.departments.*`)

- [ ] **Step 1:** Server action: admin check (as in `setActive`), validate `^[a-z0-9]{2,6}$`,
  `update departments set code where id`, audit row (`action: 'set_department_code'`),
  `invalidateAppCache()`; unique-violation → localized error via `dbErr`.
- [ ] **Step 2:** Client card: one row per department (fa name + `<Input dir="ltr">` +
  save button, `data-testid="dept-code-input-<code>"`), inline saved/error text. Render on the
  settings page only when caller is admin (page already knows roles; follow the holidays card's
  fetch pattern).
- [ ] **Step 3:** Manual check on dev server: change QC code → `qc2`, revert; non-admin manager
  does not see the card.

### Task 6: Role-adaptive new-employee form + action v2 + e2e

**Files:**
- Modify: `app/[locale]/(app)/manage/employees/new/page.tsx` (pass `isAdmin`, caller dept/self, dept codes)
- Modify: `app/[locale]/(app)/manage/employees/new/NewEmployeeForm.tsx`
- Modify: `lib/actions/employees.ts` (`createEmployee` v2), `lib/actions/employees-helpers.ts` (drop code validators, add personnel-no ones from Task 4 helper)
- Modify: `messages/*.json` (`manage.employees.personnelNo`, `jobTitle`, `codePreview`, `deptLocked`, `mgrLocked`, `defaultQuotaHint`)
- Test: `tests/e2e/manager-create-employee.spec.ts` (new)

**Interfaces:** `CreateEmployeeInput` becomes `{ personnel_no, full_name, job_title?, department_id?, manager_id?, roles?, hire_date? }`; action passes `p_personnel_no`/`p_job_title`, keeps temp-password return shape.

- [ ] **Step 1:** Action: replace code validation with `normalizePersonnelNo`/`isValidPersonnelNo`; RPC params renamed; allow callers with admin **or** manager role (DB enforces the rest — keep the fast-path check aligned).
- [ ] **Step 2:** Page: fetch departments **with `code`**; compute `isAdmin` from `getCachedRoles`, load caller profile (dept id + name + code, own name) for the manager variant; managers fetch no manager list.
- [ ] **Step 3:** Form: personnel-no input (`data-testid="personnel-no"`, `dir="ltr"`, `inputMode="numeric"`) + job-title input + live read-only preview `<p data-testid="code-preview">{deptCode}-{personnelNo}</p>`; admin variant keeps dept/manager selects (dept now `required`), role checkboxes, allocation section; manager variant renders locked dept + self as plain text, no roles/alloc, hint line for default quotas.
- [ ] **Step 4:** e2e (personnel numbers `999#######` per cleanup contract): login `m-prod`/`Demo!2026` → `/manage/employees/new` → no dept select, locked texts visible → fill name/personnel-no → preview shows `prod-999…` → submit → temp password shown → sign in as the new code → lands on `/home`. Admin spec tweak: existing create-employee spec switches from typing a code to typing a personnel number.
- [ ] **Step 5:** `npx playwright test tests/e2e/manager-create-employee.spec.ts tests/e2e/admin*.spec.ts --workers=1` → PASS (exact admin spec filename: whichever existing spec covered employee creation).

---

## Batch C — CSV import + credentials export

### Task 7: CSV toolkit (pure) + unit tests

**Files:**
- Create: `lib/csv/parse.ts`, `lib/csv/build.ts`, `lib/csv/import-rows.ts`
- Test: `tests/unit/csv-parse.test.ts`, `tests/unit/csv-import-rows.test.ts`

**Interfaces:**
- `parseCsv(text: string): string[][]` — RFC-4180 subset: quoted fields, `""` escapes, CRLF/LF, strips BOM.
- `buildCsv(rows: string[][]): string` — quotes when needed, prepends BOM (Excel+Farsi).
- `IMPORT_COLUMNS` — ordered spec of the 9 columns (`full_name, personnel_no, hire_date, department_code, manager_personnel_no, role, job_title, annual_days, sick_days`).
- `parseImportFile(text, ctx): { rows: ImportRow[]; errors: RowError[] }` where
  `ctx = { deptCodes: string[], existingPersonnelNos: string[] }`;
  `ImportRow = { full_name, personnel_no, hire_date: string /* ISO */, department_code, manager_personnel_no: string|null, role: 'manager'|'employee', job_title: string|null, annual_days: number, sick_days: number }`;
  `RowError = { line: number, field: string, messageKey: string }`.
- Hire date: normalize digits; year `< 1600` → Jalali → convert with
  `new DateObject({ calendar: persian, date: v }).convert(gregorian)` (verify exact API against
  Context7 `/shahabyazdi/react-date-object` before writing); output ISO `YYYY-MM-DD`.
- Validations: required fields; personnel-no format + dupes (in-file, against `existingPersonnelNos`); unknown `department_code`; `manager_personnel_no` must be an earlier in-file row **or** in `existingPersonnelNos`; role whitelist; day counts ≥ 0 numeric.

- [ ] **Step 1:** Failing tests covering: quoted comma field, BOM strip, Persian digits in
  personnel/date columns, Jalali `1404/04/22` → `2025-07-13`, Gregorian passthrough, dup detection,
  forward-manager-reference rejection + backward acceptance, bad role.
  **Step 2:** run (fail) → implement → `npx vitest run tests/unit/csv-*.test.ts` (pass).

### Task 8: Import page + bulk action + credentials download + e2e

**Files:**
- Create: `app/[locale]/(app)/manage/employees/import/page.tsx` (admin gate: non-admin → `redirect('/manage/employees')`)
- Create: `app/[locale]/(app)/manage/employees/import/ImportWizard.tsx`
- Modify: `lib/actions/employees.ts` — `bulkCreateEmployees(rows: ImportRow[])`
- Modify: employees list page — admin-only "Import" link button (`data-testid="import-link"`)
- Modify: `messages/*.json` (`manage.import.*`: title, template, upload, preview headers, errors.*, confirm, credentialsReady, credentialsWarn, download)
- Test: `tests/e2e/bulk-import.spec.ts`

**Interfaces:** `bulkCreateEmployees(rows) → { ok: true; credentials: { fullName; employeeCode; password }[] } | { ok: false; error }` — generates `generateTempPassword()` per row server-side, calls `app_bulk_create_employees` once, `invalidateAppCache()`.

- [ ] **Step 1:** Action: admin fast-check; map rows → jsonb payload (attach passwords); on RPC
  success zip returned `employee_code`s with names+passwords; never log rows/passwords.
- [ ] **Step 2:** Wizard client component, three states:
  (a) template download — `buildCsv` from `IMPORT_COLUMNS` labels (Farsi header row + Latin alias row + example row) via Blob + `URL.createObjectURL`, `data-testid="template-download"`;
  (b) `<input type="file" accept=".csv" data-testid="csv-file">` → `file.text()` → `parseImportFile` with dept codes + existing personnel numbers passed from the server page → preview `<table>` (row status ✓/messages, `data-testid="import-preview"`), import button disabled while `errors.length > 0`;
  (c) on success: credentials table + BOM CSV download `bj-credentials-<yyyymmdd>.csv` (`data-testid="credentials-download"`) + "cannot be re-created" warning; page-leave confirm (`beforeunload`) until downloaded.
- [ ] **Step 3:** e2e: as admin upload a generated 3-row CSV (manager `9991`-series + 2 employees
  referencing them, dept `prod`) → preview clean → import → credentials visible with 3 rows → log
  in as one employee with its generated password; second run of same file → preview shows
  duplicate-personnel-no errors, import disabled. Manager `m-prod` visiting `/manage/employees/import` → redirected.
- [ ] **Step 4:** `npx playwright test tests/e2e/bulk-import.spec.ts --workers=1` → PASS.

### Task 9: Bulk password regeneration on the employees list

**Files:**
- Modify: employees list page + its client table component (checkbox column, admin only)
- Modify: `lib/actions/employees.ts` — `bulkResetPasswords(userIds: string[])`
- Modify: `messages/*.json` (`manage.employees.regen.*`)
- Test: extend `tests/e2e/bulk-import.spec.ts` (regenerate the imported users, download again)

**Interfaces:** `bulkResetPasswords(ids) → { ok: true; credentials: {fullName; employeeCode; password}[] } | { ok: false; error }` — loops existing `app_set_employee_password` RPC with fresh `generateTempPassword()` per user; audit row per user (existing pattern); `invalidateAppCache()`.

- [ ] **Step 1:** Action (admin-only; skip caller's own id — self-lockout guard, return error if
  selection includes self). **Step 2:** UI: header checkbox + row checkboxes
  (`data-testid="emp-check-<code>"`), toolbar button (`data-testid="regen-passwords"`) → AlertDialog
  confirm ("old passwords stop working") → same credentials CSV screen as import.
  **Step 3:** e2e: select the 3 imported users → regenerate → login works with the *new* password,
  fails with the old one.

---

## Batch D — Verification & handoff

### Task 10: Full verification, docs, local-stack apply

- [ ] `npx vitest run` → all unit suites pass (103 existing + new).
- [ ] `npx playwright test --workers=1` → all e2e pass (21 existing + new; needs dev server + reachable DB).
- [ ] `npm run build` + `npm run lint` → clean.
- [ ] fa/en key-tree parity check (`python3` diff of sorted key paths).
- [ ] Apply migration + reseed dept codes to the **local Docker stack**; spot-check with the
  browser (`https://192.168.2.48`): manager create, admin import, logout confirm.
- [ ] Update `docs/CHANGELOG.md` (Unreleased), `docs/TASKS.md`, `docs/DATA_MODEL.md`
  (departments.code, profiles.personnel_no/job_title), `docs/PERMISSIONS.md` (manager create scope).
- [ ] Present diff summary to Amir; commit only on his go.
