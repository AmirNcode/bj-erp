# DATA MODEL

Source of truth for the schema. Postgres (Supabase). All employee-data tables get RLS
(`docs/PERMISSIONS.md`). Column lists are the intended design; exact DDL lands in
`supabase/migrations/` during implementation.

## Conventions

- Primary keys: `uuid` (`gen_random_uuid()`), except `profiles.id` which **equals the Supabase
  auth user id**.
- **Dates are Gregorian.** Whole-day leave uses `date`; timestamps use `timestamptz` (UTC). Jalali
  is render-only — never persisted.
- Soft-state via `active`/`status` columns; hard deletes avoided for employee data (audit).
- Money/units: none in v1.

## Enums

```
app_role        : 'admin' | 'manager' | 'employee' | 'security'
department_kind : 'team' | 'security' | 'office'        -- extensible
leave_status    : 'pending' | 'approved' | 'rejected' | 'cancelled'
day_part        : 'full' | 'am' | 'pm'                  -- hourly added later
ledger_entry    : 'allocation' | 'consumption' | 'adjustment' | 'reversal'
```

## Core tables (shared by all future modules)

### `companies`
`id` · `name` · `created_at`. Single row in v1; modeled for multi-tenant later.

### `departments`
`id` · `company_id → companies` · `name_fa` · `name_en` · `kind department_kind` ·
`manager_id → profiles` (nullable) · `created_at`.
The 3 teams (`kind='team'`) + Security (`kind='security'`).

### `profiles`
`id` (= auth user id) · `company_id` · `employee_code` (unique, the login username) · `full_name` ·
`department_id → departments` · `manager_id → profiles` (self-FK, nullable) · `hire_date` ·
`language_pref` (`fa|en`, default `fa`) · `calendar_pref` (`jalali|gregorian`, default `jalali`) ·
`active bool` · `created_at`.
*Note*: no email required. National ID intentionally omitted unless a later requirement forces it.

### `user_roles`
`id` · `user_id → profiles` · `role app_role` · unique(`user_id`,`role`).
A user may have several rows. RLS uses `has_role(uid, role)`.

### Directory read helper
`get_my_team_directory()` returns the caller's direct manager plus active teammates in the same
department, including role labels and department names for the Home **My Team** card. It is scoped
by `auth.uid()` and grants execute only to `authenticated`.

### `audit_log`
`id` · `actor_id → profiles` · `action` · `entity` · `entity_id` · `before jsonb` · `after jsonb` ·
`created_at`. Written on admin/manager mutations.

## HR module tables

### `work_settings`
`id` · `company_id` **(unique — one row per company, 2026-07-02)** · `weekend_days int[]`
(ISO weekday numbers; default `{5}` = Friday) · `updated_by` · `updated_at`. Drives working-day
counting. The settings UI upserts on `company_id`.

### `holidays`
`id` · `company_id` · `holiday_date date` (Gregorian) · `name_fa` · `name_en` ·
`is_recurring bool` · `created_at`. Seeded with official Iranian (Jalali) public holidays for the
current year(s), stored as their Gregorian equivalents. Admin-editable. **Unique**
(`company_id`,`holiday_date`) (2026-07-02). `is_recurring` is informational only — day counting
matches exact dates, so each year's occurrences must be entered (Jalali recurrence has no fixed
Gregorian month-day); the editor UI says so.

### `leave_types`
`id` · `company_id` · `name_fa` · `name_en` · `is_paid bool` · `affects_balance bool` ·
`default_annual_quota_days numeric` · `allow_half_day bool` · `allow_hourly bool` (default false,
**reserved**) · `color` · `active bool`.
Seed: annual (paid, ~26d, half-day yes), sick (paid), unpaid (no balance).

### `leave_allocations`
`id` · `employee_id → profiles` · `leave_type_id → leave_types` · `period_start date` ·
`period_end date` · `allocated_days numeric` · `created_by` · `created_at`.
The yearly entitlement. Creating one also writes a ledger `allocation` row.

### `leave_requests`
`id` · `employee_id → profiles` · `leave_type_id → leave_types` · `start_date date` ·
`end_date date` · `day_part day_part` · `requested_days numeric` (computed, see below) ·
`status leave_status` (default `pending`) · `reason text` · `decided_by → profiles` (nullable) ·
`decided_at` · `created_at`. Indexes on (`employee_id`,`status`) and (`start_date`,`end_date`).
*Hourly later*: add nullable `start_time`/`end_time` + `requested_hours`; `allow_hourly` gates UI.

### `leave_ledger`
`id` · `employee_id → profiles` · `leave_type_id → leave_types` ·
`request_id → leave_requests` (nullable) · `entry_type ledger_entry` · `delta_days numeric`
(+ for allocation, − for consumption) · `balance_after numeric` · `note` · `created_at`.
**Balance = latest `balance_after` per (employee, leave_type)**, derived not stored elsewhere.
Cancelling an **approved future** request writes a `reversal` row (`+requested_days`) — FR-15.
Index (`employee_id`,`leave_type_id`,`created_at desc`,`id desc`) backs the latest-balance lookup.
**All ledger writes are serialized per employee** via `pg_advisory_xact_lock` inside the definer
functions (2026-07-02), so concurrent approve/allocate/cancel/adjust cannot write stale balances.

## Working-day counting (server-side)

```
requested_days(start, end, day_part, weekend_days, holidays):
    if day_part in ('am','pm'):           # half-day only valid on a single working day
        return 0.5 if is_working_day(start) else 0
    count = number of days in [start, end] where
            weekday(d) NOT in weekend_days AND d NOT in holidays
    return count
```
Implemented as a Postgres function (callable from a Server Action) so the client cannot fabricate
day counts. Approval writes a `consumption` ledger row of `-requested_days` and sets
`balance_after`.

**Submit/approve rules (2026-07-02 hardening):** `submit_leave_request` rejects ranges longer than
366 days and ranges overlapping the employee's own pending/approved requests;
`approve_leave_request` re-checks overlap against approved requests and re-checks the balance
(balance-affecting types can never go negative). Error messages are stable English strings mapped
to fa/en in `lib/errors/db-error.ts` + `messages/*.json` (`dbErrors`).

## Entity relationships (text ER)

```
companies 1─* departments 1─* profiles *─1 profiles(manager)
profiles 1─* user_roles
profiles 1─* leave_allocations *─1 leave_types
profiles 1─* leave_requests   *─1 leave_types
profiles 1─* leave_ledger     *─1 leave_types   leave_requests 1─* leave_ledger
companies 1─* holidays        companies 1─1 work_settings
profiles 1─* audit_log(actor)
```
