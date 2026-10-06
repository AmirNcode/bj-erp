# Org chart, personnel import v2, two-level sign-off, negative balances — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin bulk-upload `docs/files/Personnel_CLEAN.csv` locally and see departments,
reporting lines, opening balances, the two-signature approval chain and a browsable org chart.

**Architecture:** Five idempotent migrations (dept codes, negative balance, department-manager
approval step, bulk import v2, org chart read). Pure TS modules carry the rules the UI needs
(`lib/csv/import-rows.ts`, `lib/leave/approvals.ts`, `lib/org/tree.ts`) and are unit-tested; the
SQL is authoritative and mirrors them. UI: import wizard v2, departments manager picker, approval
steps label, print strip, `/organization` page, nav + profile link.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase (Postgres 15, PostgREST, RLS),
next-intl (fa/en), Vitest, Playwright.

**Spec:** `docs/specs/2026-10-05-org-chart-and-personnel-import-design.md`

## Global Constraints

- Dates stored Gregorian; Jalali only at the UI edge (CLAUDE.md convention 1).
- RLS / SECURITY DEFINER functions are the enforcement; UI only hides (convention 2).
- Every user-facing string in `messages/fa.json` **and** `messages/en.json`.
- Migrations: `supabase/migrations/` only, idempotent, applied locally as `supabase_admin`, then
  `npm run schema:dump`. `lib/supabase/types.ts` is hand-edited.
- Department code format: `^[A-Z0-9]{2,4}$`, unique per company.
- Workday 8 h; PTO hours `0–7`; minutes = `(days × hours_per_day + hours) × 60`.
- `manager_id` = supervisor if any, else manager (D7).
- Department sign-off step applies only when the requester's department manager is set, active,
  not the requester and not the requester's direct manager.
- The department step is seeded **inactive**.
- Org chart read exposes only: id, full name, job title, department (id, fa, en), manager id,
  department-manager flag.
- Organization: desktop sidebar item; on mobile reached from Profile (bottom bar keeps 4/5 items).
- **Do not upload `Personnel_CLEAN.csv` through the app** — the owner does that. Reading it with the
  pure validator is allowed.
- Local DB is the owner's test DB: no wipes.

## Review Focus

1. **Forward references in the CSV** (a row before its supervisor) — the importer must sort, not
   reject. Pinned in Task 2 (`sorts managers before reports`).
2. **Department manager inactive** — the department step must not block forever. Pinned in Task 4
   (`department step skipped when department manager inactive`) and the SQL helper.
3. **Negative balance renders twice-signed** ("-1 روز و -4 ساعت"). Pinned in Task 3
   (`formatDuration signs only once`).
4. **Existing seeded/e2e codes longer than 4 chars** break the new CHECK. Pinned in Task 1
   migration regeneration loop + cleanup regex `ZZ%`.
5. **Print form collides two `manager` approvals** in one box. Pinned in Task 4 (department
   approvals go to the strip, keyed by step id).

---

### Task 1: Department codes 2–4 uppercase (FR-46)

**Files:**
- Create: `supabase/migrations/20261005120001_department_codes_upper.sql`
- Modify: `lib/departments/code.ts`, `tests/unit/department-code.test.ts`, `supabase/seed.sql`
  (codes `PROD`, `QC`, `MANT`, `SEC`), `scripts/cleanup-e2e.mjs` (`like('code','ZZ%')`),
  `tests/e2e/_helpers.ts` (comment), departments list shows code read-only
  (`app/[locale]/(app)/manage/departments/DepartmentsCard.tsx`).

**Interfaces — Produces:**
- `DEPARTMENT_CODE_RE = /^[A-Z0-9]{2,4}$/`
- `normalizeDepartmentCode(v: string): string` — trim, ASCII digits, **uppercase**
- `isValidDepartmentCode(v: string): boolean`
- `suggestDepartmentCode(nameEn: string): string` — first 4 `[A-Z0-9]` of uppercased name, '' if <2
- `generateDepartmentCode(nameEn: string, taken: Iterable<string>): string` — base or `DEP`;
  collision → `base.slice(0, 4 - suffix.length) + suffix`, n = 2…

- [ ] **Step 1: Update tests** — flip expectations to uppercase/4-max:

```ts
expect(normalizeDepartmentCode('  prod ')).toBe('PROD');
expect(isValidDepartmentCode('QC')).toBe(true);
expect(isValidDepartmentCode('MANT')).toBe(true);
expect(isValidDepartmentCode('MANT1')).toBe(false); // 5 chars
expect(isValidDepartmentCode('prod')).toBe(false);  // lowercase
expect(suggestDepartmentCode('Production Line B')).toBe('PROD');
expect(suggestDepartmentCode('R & D')).toBe('RD');
expect(generateDepartmentCode('انبار', [])).toBe('DEP');
expect(generateDepartmentCode('Finance', ['FINA'])).toBe('FIN2');
expect(generateDepartmentCode('Finance', ['FINA', 'FIN2'])).toBe('FIN3');
expect(generateDepartmentCode('Finance', [' fina '])).toBe('FIN2');
// suffix ≥ 10 keeps 4 chars
expect(generateDepartmentCode('Finance', ['FINA', ...Array.from({ length: 8 }, (_, i) => `FIN${i + 2}`)])).toBe('FI10');
```

- [ ] **Step 2:** `npx vitest run tests/unit/department-code.test.ts` → FAIL.
- [ ] **Step 3: Implement** in `lib/departments/code.ts` (regex, `toUpperCase`, `MAX_CODE_LENGTH = 4`,
  `FALLBACK_BASE = 'DEP'`, `used` set uppercased). Update header comment: code is the import key
  again (FR-46).
- [ ] **Step 4: Migration**:

```sql
alter table public.departments drop constraint if exists departments_code_format;
update public.departments set code = upper(code) where code <> upper(code);
do $$
declare r record; v_base text; v_cand text; n int;
begin
  for r in select id, company_id, name_en from public.departments where length(code) > 4 or code !~ '^[A-Z0-9]{2,4}$' loop
    v_base := left(upper(regexp_replace(coalesce(r.name_en, ''), '[^A-Za-z0-9]', '', 'g')), 4);
    if length(v_base) < 2 then v_base := 'DEP'; end if;
    v_cand := v_base; n := 2;
    while exists (select 1 from public.departments where company_id = r.company_id and code = v_cand and id <> r.id) loop
      v_cand := left(v_base, 4 - length(n::text)) || n::text; n := n + 1;
    end loop;
    update public.departments set code = v_cand where id = r.id;
  end loop;
end $$;
alter table public.departments add constraint departments_code_format check (code ~ '^[A-Z0-9]{2,4}$');
```

- [ ] **Step 5:** Apply locally, run unit tests → PASS. `seed.sql` codes uppercase (both insert and
  the align `update`). Cleanup script `ZZ%`.
- [ ] **Step 6:** DepartmentsCard: show `code` in a mono `dir="ltr"` chip beside each name.

### Task 2: Import validation v2 (pure) (FR-45)

**Files:**
- Rewrite: `lib/csv/import-rows.ts`
- Rewrite: `tests/unit/csv-import-rows.test.ts`
- Create: `tests/unit/personnel-clean-csv.test.ts` (reads `docs/files/Personnel_CLEAN.csv`
  through the validator — no DB, no upload)

**Interfaces — Produces:**

```ts
export type ImportColumnKey = 'full_name' | 'personnel_no' | 'job_title' | 'role'
  | 'department_code' | 'department_name_fa' | 'department_name_en'
  | 'supervisor_personnel_no' | 'manager_personnel_no' | 'hire_date' | 'pto_days' | 'pto_hours';
export const IMPORT_COLUMNS: { key: ImportColumnKey; labelFa: string; required: boolean }[];
export function templateHeader(): string[];
export type ImportRow = {
  line: number; full_name: string; personnel_no: string; job_title: string | null;
  role: 'manager' | 'employee'; department_code: string;
  supervisor_personnel_no: string | null; manager_personnel_no: string | null;
  hire_date: string | null; balance_minutes: number;
};
export type ImportDepartment = {
  code: string; name_fa: string; name_en: string;
  create: boolean; generated: boolean;
  /** Set only when the import should assign this department's manager. */
  manager_personnel_no: string | null;
  managerName: string | null;
  /** Existing manager kept although the file implies another. */
  keptExistingManager: boolean;
};
export type RowError = { line: number; field: ImportColumnKey | 'row'; messageKey:
  'missingColumn' | 'required' | 'badPersonnelNo' | 'dupInFile' | 'dupExisting' | 'badDeptCode'
  | 'deptNamesRequired' | 'deptCodeConflict' | 'unknownSupervisor' | 'unknownManager'
  | 'refNotManager' | 'selfReference' | 'cycle' | 'badDate' | 'badRole' | 'badBalance'
  | 'mixedSign' | 'hoursTooLarge' | 'deptManagerTie' };
export type RowWarning = { line: number; messageKey:
  'supervisorManagerMismatch' | 'deptNamesDiffer' | 'deptManagerKept' | 'bothSign';
  params?: Record<string, string> };
export type ImportContext = {
  departments: { code: string; name_fa: string; name_en: string | null; managerPersonnelNo: string | null }[];
  existingEmployees: { personnelNo: string; fullName: string; isManager: boolean }[];
  hoursPerDay: number;
};
export type ImportResult = { rows: ImportRow[]; departments: ImportDepartment[];
  errors: RowError[]; warnings: RowWarning[] };
export function validateImportRows(csvRows: string[][], ctx: ImportContext): ImportResult;
export const parseHireDate; // unchanged
```

Rules (from spec §2/§3): header match unchanged (latin key in parentheses, exact key, or Farsi
label). Department resolution order code→existing / code→new / blank→name match / blank→generate.
`rows` returned in manager-first topological order (by effective manager =
supervisor ?? manager, only in-file references). Errors make `rows` empty-safe: the wizard blocks
on any error. Department manager derivation: per code in file, most common non-empty
`manager_personnel_no` among members whose pno is not any row's `manager_personnel_no`; fallback all
members; tie → `deptManagerTie`; existing manager differs → keep + `deptManagerKept`. `bothSign`
warning: row without supervisor, not itself a dept manager, whose manager ≠ its department's
manager.

- [ ] **Step 1: Write failing tests** (representative; all in `csv-import-rows.test.ts`):

```ts
const H = ['full_name','personnel_no','role','department_code','department_name_fa','department_name_en',
  'supervisor_personnel_no','manager_personnel_no','pto_days','pto_hours'];
const ctx: ImportContext = { departments: [{ code: 'QC', name_fa: 'کنترل کیفیت', name_en: 'Quality Control', managerPersonnelNo: null }],
  existingEmployees: [], hoursPerDay: 8 };
it('sorts managers before reports', () => {
  const r = validateImportRows([H,
    ['Emp', '3', 'employee', 'QC', '', '', '2', '1', '1', '2'],
    ['Sup', '2', 'manager', 'QC', '', '', '', '1', '0', '0'],
    ['Boss', '1', 'manager', 'QC', '', '', '', '', '', '']], ctx);
  expect(r.errors).toEqual([]);
  expect(r.rows.map((x) => x.personnel_no)).toEqual(['1', '2', '3']);
  expect(r.rows[2].balance_minutes).toBe((1 * 8 + 2) * 60);
});
it('rejects a cycle', ...);            // 1→2→1 → messageKey 'cycle'
it('rejects a reference to a non-manager', ...); // 'refNotManager'
it('rejects mixed signs and hours ≥ hoursPerDay', ...); // 'mixedSign', 'hoursTooLarge'
it('accepts negative balances', ...);   // -1,-4 → -720
it('creates a new department from names and generates its code', ...); // code '' + names → create, generated
it('requires names for an unknown code', ...); // 'deptNamesRequired'
it('rejects one new code with two different names', ...); // 'deptCodeConflict'
it('uppercases and validates codes', ...); // 'qc' → existing QC; 'TOOLONG' → 'badDeptCode'
it('derives the department manager, excluding heads', ...);
it('reports a department manager tie', ...);
it('keeps an existing department manager and warns', ...);
it('warns when a supervisor reports to a different manager', ...);
it('warns bothSign for a direct report of a non-department-manager', ...);
it('resolves references to existing employees', ...);
```

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implement `lib/csv/import-rows.ts` (pure; uses `toAsciiDigits`,
  `isValidPersonnelNo`, `parseUserDate`, `normalizeDepartmentCode`, `isValidDepartmentCode`,
  `generateDepartmentCode`).
- [ ] **Step 4:** `personnel-clean-csv.test.ts`: parse the real file with `parseCsv`, validate with
  a context of the 0 existing employees/departments and `hoursPerDay: 8`; assert `errors=[]`,
  `rows.length === 142` (141 staff + CEO), 25 departments all `create`, `warnings` has no `bothSign`, EXEC manager is
  personnel 100, WH manager 128, MCH manager 103, 7 negative balances.
- [ ] **Step 5:** run → PASS.

### Task 3: Negative balances (FR-48)

**Files:**
- Create: `supabase/migrations/20261005120002_negative_leave_balance.sql`
- Modify: `lib/leave/duration.ts`, `tests/unit/duration.test.ts`,
  `app/[locale]/(app)/manage/employees/[id]/EditEmployeeForm.tsx` (drop `min={0}`, allow negative)

- [ ] **Step 1: Test**:

```ts
it('formatDuration signs only once', () => {
  expect(formatDuration(-(8 * 60 + 4 * 60), 8, 'en', L)).toBe('-1 days and 4 hours');
});
```

- [ ] **Step 2:** FAIL → implement: in `formatDuration`, render the first non-zero part signed and
  the rest with `Math.abs`. `minutesToDaysHours` unchanged.
- [ ] **Step 3: Migration** — `create or replace public.set_leave_balance` with the guard changed
  to `if p_target_minutes is null or p_target_minutes < -366 * private.company_minutes_per_day(
  (select company_id from public.profiles where id = p_employee_id)) then raise exception
  'target balance is out of range' ...`. Body otherwise identical (dumped from schema.sql).
  Add `dbErrors` mapping for the new message (`lib/errors/db-error.ts` + messages).
- [ ] **Step 4:** EditEmployeeForm balance input: `min={-366}`.
- [ ] **Step 5:** apply, unit → PASS.

### Task 4: Department manager sign-off (FR-47)

**Files:**
- Create: `supabase/migrations/20261005120003_department_manager_step.sql`
- Modify: `lib/leave/approvals.ts`, `tests/unit/approval-chain.test.ts`,
  `lib/actions/leave/approvals.ts`, `lib/actions/reports.ts`, `lib/actions/settings.ts`,
  `lib/actions/leave/review.ts`, `lib/actions/departments.ts` (+ `setDepartmentManager`),
  `app/[locale]/(app)/manage/approval-steps/ApprovalStepsCard.tsx`, `.../page.tsx`,
  `app/[locale]/(app)/manage/approvals/ApprovalQueue.tsx`,
  `app/[locale]/(print)/print/request/[id]/page.tsx`,
  `app/[locale]/(app)/manage/departments/DepartmentsCard.tsx` (+ manager picker),
  `lib/supabase/types.ts`, `messages/*.json`.

**Interfaces — Produces:**

```ts
export type ManagerScope = 'direct' | 'department';
export type StepLabel = StepRole | 'departmentManager';
// ApprovalStep gains: managerScope?: ManagerScope   (absent = 'direct')
export function stepLabel(step: ApprovalStep): StepLabel;
export function departmentStepApplies(input: { employeeId: string; employeeManagerId: string | null;
  departmentManagerId: string | null; departmentManagerActive: boolean }): boolean;
export function applicableSteps(steps: ApprovalStep[], kind: RequestKind, departmentStepApplies?: boolean): ApprovalStep[];
// FillableInput gains: isDepartmentManager?: boolean; departmentStepApplies?: boolean;
export function outstandingSteps(steps, signed, kind, departmentStepApplies?: boolean): StepLabel[];
// filterApprovable rows gain: employee_department_manager_id: string | null; department_step_applies: boolean
export async function setDepartmentManager(departmentId: string, managerId: string | null);
```

SQL (migration):

```sql
alter table public.approval_steps add column if not exists manager_scope text not null default 'direct';
alter table public.approval_steps drop constraint if exists approval_steps_manager_scope_valid;
alter table public.approval_steps add constraint approval_steps_manager_scope_valid
  check (manager_scope in ('direct','department')
         and (manager_scope = 'direct' or (role = 'manager' and approver_id is null)));
drop index if exists public.approval_steps_company_role_uniq;
create unique index if not exists approval_steps_company_role_scope_uniq
  on public.approval_steps (company_id, role, manager_scope) where approver_id is null;

create or replace function private.department_manager_for(p_emp uuid) returns uuid
  language sql stable security definer set search_path = '' as $$
  select d.manager_id from public.profiles p
    join public.departments d on d.id = p.department_id
    join public.profiles m on m.id = d.manager_id and m.active
   where p.id = p_emp $$;
create or replace function private.department_step_applies(p_emp uuid) returns boolean ... $$
  select x.dm is not null and x.dm <> p_emp
     and x.dm is distinct from (select manager_id from public.profiles where id = p_emp)
    from (select private.department_manager_for(p_emp) as dm) x $$;
create or replace function private.step_applies(p_scope text, p_emp uuid) returns boolean ... $$
  select p_scope is distinct from 'department' or private.department_step_applies(p_emp) $$;
create or replace function private.is_department_manager_of(p_uid uuid, p_emp uuid) returns boolean ... $$
  select p_uid is not null and private.is_active(p_uid)
     and private.department_manager_for(p_emp) = p_uid $$;
revoke all on function ... from public;   -- private schema, called by definer fns only

-- Seed inactive department step after the direct manager step, once per company.
-- Shifts steps at/after that order by one to make room.
```

Then `create or replace` `approve_leave_request` and `reject_leave_request`, bodies taken from
`supabase/schema.sql` and patched by script with two replacements that must each match ≥1 time:
1. every `v_kind = any(s.applies_to)` → `v_kind = any(s.applies_to) and private.step_applies(s.manager_scope, v_emp)`
2. every `(s.role = 'manager' and v_is_mgr)` →
   `((s.role = 'manager' and s.manager_scope = 'direct' and v_is_mgr) or (s.role = 'manager' and s.manager_scope = 'department' and private.is_department_manager_of(v_uid, v_emp)))`

- [ ] **Step 1: Failing tests** in `approval-chain.test.ts`:

```ts
const direct = { id: 'm', role: 'manager', stepOrder: 1, appliesTo: ['leave','errand'], active: true } as const;
const dept = { id: 'd', role: 'manager', managerScope: 'department', stepOrder: 2, appliesTo: ['leave','errand'], active: true } as const;
const hr = { id: 'h', role: 'hr', stepOrder: 3, appliesTo: ['leave','errand'], active: true } as const;
it('department manager fills the department step after the supervisor', () => {
  expect(fillableStep({ steps: [direct, dept, hr], signed: [{ stepId: 'm', stepRole: 'manager', decision: 'approved' }],
    kind: 'leave', callerRoles: ['manager','employee'], isDirectManager: false, isDepartmentManager: true,
    departmentStepApplies: true, isSelf: false, orderEnforced: false })?.id).toBe('d');
});
it('supervisor cannot fill the department step', ...);   // isDirectManager true, after m signed → null
it('department step not required when it does not apply', ...); // outstandingSteps excludes it
it('outstandingSteps labels the department step', ...);   // ['departmentManager', 'hr']
it('departmentStepApplies: skipped when same as direct manager / self / inactive / null', ...);
it('department step skipped when department manager inactive', ...);
```

- [ ] **Step 2:** FAIL → implement TS.
- [ ] **Step 3:** migration; apply; dump schema; check with psql inside `begin … rollback` that the
  patched functions contain `step_applies` 4+ times.
- [ ] **Step 4:** actions: steps selects add `manager_scope`; approvals action embeds
  `departments!profiles_department_id_fkey(name_fa, name_en, manager_id, manager:profiles!departments_manager_id_fkey(active))`
  and passes `departmentStepApplies` / `isDepartmentManager`; reports fetch `step_id`; review fetch
  `step_id` + scope; print form: department-scope approvals go to the strip labelled
  `departmentManager`, never into the manager box.
- [ ] **Step 5:** ApprovalStepsCard label via `stepLabel`, test id `approval-step-department-manager`,
  no delete button for it; Add dialog `usedRoles` ignores it. Departments card: manager select
  (active manager-role profiles) calling `setDepartmentManager` (admin, RLS `departments_update_admin`).
- [ ] **Step 6:** unit → PASS; `npx tsc --noEmit`.

### Task 5: Bulk import v2 — SQL, action, wizard (FR-45)

**Files:**
- Create: `supabase/migrations/20261005120004_bulk_import_v2.sql`
- Modify: `lib/actions/employees.ts` (`BulkImportRow`, `bulkCreateEmployees(rows, departments, balanceAsOf)`),
  `lib/supabase/types.ts`, `app/[locale]/(app)/manage/employees/import/page.tsx`,
  `.../ImportWizard.tsx`, `messages/*.json`, `docs/files/bj-employees-template.csv`,
  `docs/files/Personnel_CLEAN.csv` (rename the two department-name headers),
  `tests/e2e/bulk-import.spec.ts`.

**Interfaces:**
- SQL `public.app_bulk_create_employees(p_company_id uuid, p_rows jsonb, p_departments jsonb, p_balance_as_of date) returns jsonb`
  (drops the 2-arg version).
- Row JSON: `{full_name, personnel_no, job_title, role, department_code, supervisor_personnel_no, manager_personnel_no, hire_date, balance_minutes, password}`.
- Department JSON: `{code, name_fa, name_en, create, manager_personnel_no}`.

SQL behaviour: admin or hr; hr may not create departments or set managers (`raise 42501`);
`p_balance_as_of` required and ≤ Tehran today; departments with `create` inserted (code upper,
kind `team`); rows in order: dept by code, manager pno = coalesce(supervisor, manager) resolved in
profiles, `create_employee_impl(... roles ...)`; non-zero `balance_minutes` → advisory lock +
`adjustment` ledger row note `'opening balance as of ' || p_balance_as_of` + audit; annual type
default accrual > 0 → `employee_leave_policies` row (`accrual_start_month` = first
`jalali_months.gregorian_start` strictly after the month containing `p_balance_as_of`, created_by
caller, on conflict do nothing); after rows, `update departments set manager_id = … where code = …
and manager_id is null` for each department entry with `manager_personnel_no`.

- [ ] **Step 1:** migration; apply; verify in `begin; … rollback;` with a 3-row synthetic payload
  (forward-sorted, one negative balance, one new department) that profiles, ledger, policy and
  department manager land as expected. **Not the client CSV.**
- [ ] **Step 2:** action + types.
- [ ] **Step 3:** page passes `departments` (code, names, manager pno), `existingEmployees`
  (pno, name, isManager via `user_roles`), `hoursPerDay`.
- [ ] **Step 4:** wizard: balance-date `PersianDateField` (required, max today) with live
  "accrual starts from <Jalali month>" line; new-departments panel + acknowledgement checkbox
  (`import-new-departments`, `import-ack-departments`); department managers panel
  (`import-dept-managers`); warnings table (`import-warnings`); updated example rows; submit
  disabled until no errors + date + ack (when departments are created).
- [ ] **Step 5:** e2e `bulk-import.spec.ts` rewritten to the new template (new `zz` department via
  names, supervisor row after its report, negative balance) — selects date, ticks ack.
- [ ] **Step 6:** `npx tsc --noEmit`, unit → PASS.

### Task 6: Org chart (FR-44)

**Files:**
- Create: `supabase/migrations/20261005120005_org_chart.sql`, `lib/org/tree.ts`,
  `tests/unit/org-tree.test.ts`, `app/[locale]/(app)/organization/page.tsx`,
  `app/[locale]/(app)/organization/OrgChart.tsx`, `lib/actions/org.ts`
- Modify: `lib/nav/tabs.ts`, `tests/unit/nav_tabs.test.ts`, `tests/unit/main-nav.test.tsx`,
  `app/[locale]/(app)/_components/MainNav.tsx`, `.../nav-icons.tsx`, `app/[locale]/(app)/layout.tsx`,
  `app/[locale]/(app)/profile/page.tsx`, `lib/supabase/types.ts`, `messages/*.json`.

**Interfaces — Produces:**

```ts
export type OrgPerson = { id: string; fullName: string; jobTitle: string | null;
  departmentId: string | null; departmentNameFa: string | null; departmentNameEn: string | null;
  managerId: string | null; isDepartmentManager: boolean };
export type OrgIndex = { byId: Map<string, OrgPerson>; children: Map<string, OrgPerson[]>; roots: OrgPerson[] };
export function buildOrgIndex(people: OrgPerson[]): OrgIndex;
export function chainTo(index: OrgIndex, id: string): OrgPerson[];   // root first, excludes id, cycle-safe
export function reportsOf(index: OrgIndex, id: string): OrgPerson[];
export function searchPeople(index: OrgIndex, query: string, limit?: number): OrgPerson[];
export function normalizeFaName(s: string): string; // ي→ی, ك→ک, ZWNJ→space, collapse spaces, lowercase
```

SQL `public.get_org_chart()` returns `(profile_id, full_name, job_title, department_id,
department_name_fa, department_name_en, manager_id, is_department_manager)`; active profiles of the
caller's company; `manager_id` nulled when the manager is inactive; grant `authenticated`, revoke
`public`/`anon`.

- [ ] **Step 1: Failing tests** `org-tree.test.ts`: roots (missing/absent manager), children sorted
  by Farsi name, `chainTo` root-first, cycle stops, `reportsOf`, `searchPeople('علي')` matches
  `علی`, ZWNJ-insensitive, limit.
- [ ] **Step 2:** FAIL → implement → PASS.
- [ ] **Step 3:** migration; apply; dump.
- [ ] **Step 4:** nav: `TabKey` + `'organization'`; `BASE` gets it after calendar with
  `desktopOnly: true`; MainNav renders desktop-only items with `hidden md:block`; icon; label.
  Tests: `tabsForRoles` includes organization for every role; main-nav test asserts the item is
  `hidden md:block`.
- [ ] **Step 5:** page + OrgChart client component: focus from `?p=`, default self; breadcrumb chain
  (`org-chain-item`), focus card (`org-focus`; "شما" badge on self, "مدیر واحد" badge), reports grid
  (`org-report-card`, report counts), search (`org-search`, results `org-search-result`), top view
  listing roots (`org-roots`). `router.push` on navigation so Back works.
- [ ] **Step 6:** Profile page card linking to `/organization` (`md:hidden`, `profile-org-link`).
- [ ] **Step 7:** `npx tsc --noEmit`, unit, lint → PASS.

### Task 7: Docs, schema, verification

- [ ] `npm run schema:dump`; `npm run lint`; `npm run test:unit`; `npm run build`.
- [ ] Run e2e: `bulk-import`, `department`, approval-related specs (`--workers=1`), against local stack.
- [ ] Docs: `DATA_MODEL.md` (departments code + manager_id, approval_steps.manager_scope, negative
  balances, bulk import), `PERMISSIONS.md` (get_org_chart, department step), `REQUIREMENTS.md`
  FR-44…48, `CHANGELOG.md`, `TASKS.md`, spec status → Accepted, `AGENT-LOG.md`.
- [ ] Hand-off notes for the owner: activate the department step after import; local DB conflicts
  (personnel 101, codes PROD/QC) before uploading the CSV.
