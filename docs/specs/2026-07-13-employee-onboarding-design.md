# Employee Onboarding & Logout UX — Design Record

- **Date:** 2026-07-13
- **Status:** Approved (design reviewed with owner; spec-review gate waived by owner)
- **Scope:** Logout relocation + confirmation · department codes + auto employee codes ·
  manager-scoped employee creation · admin CSV bulk import with one-time credentials export
- **Builds on:** `2026-06-23-hr-timeoff-design.md`, hardening migration `20260702120001`

## 1. Goals

1. Prevent accidental logout (button placement + confirmation).
2. Let **managers** onboard employees into *their own team only* — no admin round-trip.
3. Standardise login codes: generated, never hand-typed, derived from department + personnel number.
4. Let **admins** onboard the whole company from one CSV and hand out credentials on paper.

Explicitly out of scope (owner-approved): an `hr` role (postponed until the HR module grows);
renaming existing users' codes; any change to leave-request flows.

## 2. Decisions taken with the owner

| Question | Decision |
|---|---|
| Department prefix source | New Latin `code` column on `departments`, admin-editable in Manage → Settings. Backfilled for existing rows. |
| Personnel number | Typed by the creator (client's real HR number, digits only, unique). Not auto-assigned. |
| "Admin or HR" for privileged roles | Admin-only in v1. No `hr` role yet. |
| Credentials export timing | Generated + downloaded **at import time only** (passwords are bcrypt-hashed, unrecoverable later). Recovery path = bulk regenerate. |

## 3. Feature A — Logout: relocate + confirm

- Remove the logout button from `SettingsForm` (preferences card).
- New `LogoutButton` client component rendered at the very bottom of
  `app/[locale]/(app)/profile/page.tsx`, **outside any Card** — full-width, destructive-outline
  styling.
- Pressing it opens a shadcn **AlertDialog**: title "خروج از حساب؟" / "Log out?", body copy, actions
  **Cancel** / **Log out**. Only the confirm action calls the existing `signOut(locale)` server
  action.
- Test-id contract: the page-level button keeps `data-testid="settings-logout"`; the dialog confirm
  button gets `data-testid="logout-confirm"`. Any e2e spec that logs out is updated to click both.
- New message keys under `profile.logoutConfirm.*` in **both** `fa.json` and `en.json`
  (key trees stay byte-identical).

## 4. Feature B — Codes, personnel numbers, manager-scoped creation

### 4.1 Schema (one migration)

```
departments.code    text    — lowercase latin, ^[a-z0-9]{2,6}$, unique per company, not null
profiles.personnel_no text  — digits ^[0-9]{1,10}$, unique, nullable (pre-existing users lack one)
profiles.job_title  text    — free text, display-only, nullable
```

- Backfill `departments.code` from a slug of `name_en` (first 4 alphanumeric chars, lowercase,
  numeric suffix on collision), then set `not null`. `supabase/seed.sql` gains explicit codes for
  the seeded departments (`prod`, `qc`, `mant`, `sec`).
- Employee code formula, single source of truth **in the database**:
  `employee_code = departments.code || '-' || personnel_no` (e.g. `prod-1042`). Client shows a
  read-only live preview computed the same way (pure helper in `lib/employees/code.ts`,
  unit-tested, kept trivially in sync).
- Existing profiles keep their `employee_code`; `personnel_no` stays null for them.

### 4.2 `app_create_employee` v2 (SECURITY DEFINER, replaces v1)

Old signature dropped (avoids PostgREST overload ambiguity). New parameters: `p_personnel_no`,
`p_job_title` replace `p_employee_code`; the rest unchanged.

In-DB authorization branches — **RLS/definer logic is the enforcement, UI only mirrors it**:

| Caller | Allowed |
|---|---|
| admin | any department, any manager, any role set (as today) |
| manager (non-admin) | department forced = caller's `department_id`; `manager_id` forced = caller; roles forced = `{employee}`; department must have a `code` |
| anyone else | rejected (42501) |

- Code is composed in-DB from the department's `code` + validated `personnel_no`; uniqueness checks
  on both `personnel_no` and the resulting `employee_code` (23505 on conflict).
- **Manager path also seeds default leave allocations** in the same transaction: for each active
  `leave_types` row with `affects_balance` and a positive `default_annual_quota_days`, insert the
  allocation ledger rows. Follows the mandatory ledger pattern: `pg_advisory_xact_lock` on the new
  employee id before writing (memory: all ledger writers lock first).
- Admin path keeps the existing UI-driven allocation step (unchanged behavior).
- Audit log entry as today, now including `personnel_no` and the acting path (`admin`/`manager`).

### 4.3 UI

- **Manage → Settings**: new admin-only "Departments" card — each department row shows Farsi name +
  editable code input, saved via a new guarded server action (`updateDepartmentCode` →
  admin-checked update; departments RLS already restricts writes to admin). Validation mirrors
  `^[a-z0-9]{2,6}$`.
- **Manage → Employees → New** (`NewEmployeeForm`) becomes role-adaptive; the server page passes
  `isAdmin`:
  - Both paths: full name, **personnel number** (digits), **job title** (text), hire date,
    read-only **code preview** (`prod-1042` updates as you type).
  - Admin only: department select, manager select, role checkboxes, allocation inputs — as today.
  - Manager: department + manager rendered as fixed text (own department, self); no role or
    allocation inputs; hint that default quotas apply.
- Nav/guards: `/manage` layout already admits managers; the employees list page must not break for
  managers (it lists their team per existing RLS).

## 5. Feature C — Bulk CSV import + credentials export (admin-only)

### 5.1 Import page — `/manage/employees/import`

Admin-only (server-checked; managers get redirected). Three stages on one page:

1. **Template**: download button generates the CSV client-side (UTF-8 **with BOM** so Excel renders
   Farsi) — headers in Farsi with a Latin alias row, one example row. Columns:
   `full_name, personnel_no, hire_date, department_code, manager_personnel_no, role, job_title,
   annual_days, sick_days`.
2. **Upload + preview**: file parsed **client-side** (`lib/csv/parse.ts`, hand-rolled RFC-4180
   subset: quoted fields, BOM strip, CRLF; Persian/Arabic-Indic digits normalised; Jalali vs
   Gregorian hire dates auto-detected by year `< 1600` → converted via `react-date-object`).
   Preview table shows every row with per-row validation errors: bad/duplicate `personnel_no`
   (within file **and** against DB), unknown `department_code`, unknown manager reference, bad
   date, bad role (only `manager`/`employee` allowed in CSV), negative day counts. Import button
   disabled until zero errors.
3. **Confirm → create**: rows sent as JSON to a server action → single RPC
   `app_bulk_create_employees(jsonb)` — **one transaction, all-or-nothing** (any failure rolls the
   whole import back; partial companies are worse than a retry). Reuses v2 creation logic per row,
   in file order, so a row may reference a manager defined earlier in the same file
   (`manager_personnel_no` resolves against DB **or** already-processed rows). Allocations from
   `annual_days` / `sick_days` map to the seeded leave types by `name_en`
   (`'Annual Leave'` / `'Sick Leave'` — the stable keys `seed.sql` itself uses); missing types
   fail the import loudly rather than skipping.
   Passwords: generated server-side per row (existing `generateTempPassword`), **returned once** in
   the action result, never logged/stored.
4. **Credentials download**: success screen immediately offers
   `bj-credentials-<date>.csv` (full name, employee code, password; BOM for Excel) plus a
   prominent "this file cannot be re-created — store it safely" warning. Fa/en.

### 5.2 Password regeneration (recovery path)

- Employees list (`/manage/employees`) gets admin-only row checkboxes + a
  **"Regenerate passwords"** bulk action → confirm dialog (old passwords stop working) → server
  action loops the existing `app_set_employee_password` RPC with fresh generated passwords →
  same one-time credentials CSV download.

### 5.3 Server surface

- `app_bulk_create_employees(p_rows jsonb) returns jsonb` — SECURITY DEFINER, admin-only, iterates
  rows with the same validation/locking as v2 single-create; returns `[{personnel_no,
  employee_code, user_id}]`; raises on first invalid row (all-or-nothing).
- Server actions: `bulkCreateEmployees(rows)` (admin), `bulkResetPasswords(userIds)` (admin) — both
  call `invalidateAppCache()` (cache invariant).

## 6. Testing

- **Unit (Vitest):** code preview helper (formula + validation), CSV parser (quotes, BOM, CRLF,
  Persian digits), hire-date detection/conversion (Jalali ↔ Gregorian), CSV row validator
  (duplicates, unknown refs, in-file manager forward/backward references), credentials CSV builder.
- **e2e (Playwright, serial):**
  - Logout: cancel keeps session, confirm ends it.
  - Manager (`m-prod` / `Demo!2026`): create employee → dept/manager locked, code preview matches,
    new user can log in, appears in team; cannot reach `/manage/employees/import` (redirect).
  - Admin: import a 3-row CSV (manager row + 2 employees referencing it) → preview clean → import →
    credentials returned → new employee logs in with generated password.
  - Throwaway users must match the e2e cleanup patterns in `app_cleanup_e2e_users()` — extend that
    function's pattern list for generated-style codes (e.g. reserve dept code `zz` + personnel
    range for tests) so the suite still self-cleans.
- Existing 103 unit + 21 e2e specs keep passing; `settings-logout` testid preserved.

## 7. Risks & mitigations

- **Excel mangles the CSV** (encoding, Persian digits, Jalali dates): BOM output, digit
  normalisation, both-calendar parsing, and a validation preview that shows exactly what will be
  created before anything is written.
- **Lost credentials file**: bulk regenerate path (5.2).
- **Manager privilege escalation**: enforced inside the SECURITY DEFINER function, not the UI;
  covered by an e2e attempt and the definer's forced-parameter branch.
- **Ledger races**: advisory-lock pattern reused for in-create allocations.
- **PostgREST function overloading**: old `app_create_employee` signature explicitly dropped.
