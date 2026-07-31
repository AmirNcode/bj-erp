-- =============================================================================
-- Migration: 20260729130005_leave_policy.sql
-- Purpose  : Per-employee leave policy + the bookkeeping monthly accrual needs
--            (spec §6.1). No accrual logic yet — that is …130006.
--
-- Decisions: rate and caps are PER EMPLOYEE, defaulted from the leave type (D1);
--            the carryover cap defaults to 9 days = 4320 minutes, which is
--            ماده ۶۶ of the Iranian labour code (D6).
--
-- Idempotent. Postgres 15. Apply as supabase_admin.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. A forfeited carryover is its own kind of entry, never an admin adjustment.
-- ---------------------------------------------------------------------------
alter type public.ledger_entry add value if not exists 'carryover_forfeit';

-- ---------------------------------------------------------------------------
-- 2. leave_types: company defaults that pre-fill the employee forms.
--    480 = one 8h day. Annual defaults to 1 day/month with a 12-day year — the
--    client's stated policy — but every employee can override it.
-- ---------------------------------------------------------------------------
alter table public.leave_types
  add column if not exists default_accrual_minutes_per_month int,
  add column if not exists default_annual_cap_minutes        int,
  add column if not exists default_carryover_cap_minutes     int not null default 4320;

update public.leave_types
   set default_accrual_minutes_per_month = 480,
       default_annual_cap_minutes        = 5760
 where name_en = 'Annual Leave'
   and default_accrual_minutes_per_month is null;

-- Sick leave is certified, not accrued: rate 0, no cap.
update public.leave_types
   set default_accrual_minutes_per_month = 0
 where name_en = 'Sick Leave'
   and default_accrual_minutes_per_month is null;

-- ---------------------------------------------------------------------------
-- 3. leave_ledger.period_month — which month an accrual or forfeiture belongs
--    to. NULL for every other entry type (opening allocations, consumption,
--    reversals, admin adjustments).
--
--    The partial unique index below is the whole idempotency guarantee for lazy
--    accrual: posting the same month twice is impossible, not merely unlikely.
-- ---------------------------------------------------------------------------
alter table public.leave_ledger
  add column if not exists period_month date;

create unique index if not exists leave_ledger_period_uniq
  on public.leave_ledger (employee_id, leave_type_id, entry_type, period_month)
  where period_month is not null;

-- Reports must read period_month, never created_at: a lazily-posted row is
-- created whenever someone happens to open a page, possibly months after the
-- period it belongs to.
create index if not exists leave_ledger_period_month_idx
  on public.leave_ledger (employee_id, leave_type_id, period_month)
  where period_month is not null;

-- ---------------------------------------------------------------------------
-- 4. employee_leave_policies
-- ---------------------------------------------------------------------------
create table if not exists public.employee_leave_policies (
  id                        uuid        primary key default gen_random_uuid(),
  employee_id               uuid        not null references public.profiles(id)    on delete cascade,
  leave_type_id             uuid        not null references public.leave_types(id) on delete restrict,
  accrual_minutes_per_month int         not null default 0,
  annual_cap_minutes        int,
  carryover_cap_minutes     int         not null default 4320,
  -- Always the gregorian_start of a jalali_months row; validated in the setter.
  accrual_start_month       date        not null,
  created_by                uuid        references public.profiles(id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint employee_leave_policies_rate_sane
    check (accrual_minutes_per_month >= 0 and accrual_minutes_per_month <= 100000),
  constraint employee_leave_policies_caps_sane
    check ((annual_cap_minutes is null or annual_cap_minutes >= 0) and carryover_cap_minutes >= 0),
  constraint employee_leave_policies_uniq
    unique (employee_id, leave_type_id)
);

create index if not exists employee_leave_policies_employee_idx
  on public.employee_leave_policies (employee_id);

-- `create or replace` (PG14+) so a replay does not fail on an existing trigger.
create or replace trigger employee_leave_policies_set_updated_at
  before update on public.employee_leave_policies
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. RLS — mirrors leave_allocations: readable by the employee, their manager,
--    security and admin. NO client write policies; writes go through the
--    definer setter in …130006.
-- ---------------------------------------------------------------------------
alter table public.employee_leave_policies enable row level security;

drop policy if exists "employee_leave_policies_select" on public.employee_leave_policies;
create policy "employee_leave_policies_select"
  on public.employee_leave_policies for select to authenticated
  using (
    employee_id = auth.uid()
    or private.is_manager_of(auth.uid(), employee_id)
    or private.can_read_all(auth.uid())
  );
