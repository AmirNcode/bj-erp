-- =============================================================================
-- Migration: 20260623120005_leave.sql
-- Purpose  : HR leave-management schema: enums, tables, indexes, updated_at
--            trigger, and RLS policies (select-only for transactional tables).
-- Spec     : docs/DATA_MODEL.md  (HR module tables section)
--            docs/PERMISSIONS.md (Policy intent per table)
--            .superpowers/sdd/task-2.1-brief.md
-- Depends  : 20260623120001_core.sql   (companies, profiles, set_updated_at)
--            20260623120002_rls_helpers.sql (private.is_admin, private.is_manager_of,
--                                            private.same_team, private.can_read_all)
-- Note     : NO seed data. Controller seeds work_settings / leave_types / holidays
--            separately for portability.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------

create type public.leave_status as enum ('pending', 'approved', 'rejected', 'cancelled');
create type public.day_part     as enum ('full', 'am', 'pm');
create type public.ledger_entry as enum ('allocation', 'consumption', 'adjustment', 'reversal');

-- ---------------------------------------------------------------------------
-- 2. work_settings
--    One row per company. Drives working-day counting.
--    id · company_id · weekend_days · updated_by · updated_at
-- ---------------------------------------------------------------------------

create table public.work_settings (
  id            uuid        primary key default gen_random_uuid(),
  company_id    uuid        not null references public.companies(id) on delete cascade,
  weekend_days  int[]       not null default '{5}',      -- ISO weekday numbers; 5 = Friday
  updated_by    uuid        references public.profiles(id) on delete set null,
  updated_at    timestamptz not null default now()
);

-- updated_at trigger (reuses public.set_updated_at() from core migration)
create trigger work_settings_set_updated_at
  before update on public.work_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. holidays
--    id · company_id · holiday_date · name_fa · name_en · is_recurring · created_at
-- ---------------------------------------------------------------------------

create table public.holidays (
  id            uuid        primary key default gen_random_uuid(),
  company_id    uuid        not null references public.companies(id) on delete cascade,
  holiday_date  date        not null,
  name_fa       text        not null,
  name_en       text,
  is_recurring  boolean     not null default false,
  created_at    timestamptz not null default now()
);

create index holidays_company_date_idx on public.holidays (company_id, holiday_date);

-- ---------------------------------------------------------------------------
-- 4. leave_types
--    id · company_id · name_fa · name_en · is_paid · affects_balance ·
--    default_annual_quota_days · allow_half_day · allow_hourly · color · active
-- ---------------------------------------------------------------------------

create table public.leave_types (
  id                        uuid        primary key default gen_random_uuid(),
  company_id                uuid        not null references public.companies(id) on delete cascade,
  name_fa                   text        not null,
  name_en                   text,
  is_paid                   boolean     not null default true,
  affects_balance           boolean     not null default true,
  default_annual_quota_days numeric,
  allow_half_day            boolean     not null default false,
  allow_hourly              boolean     not null default false,   -- reserved for future hourly leave
  color                     text,
  active                    boolean     not null default true
);

-- ---------------------------------------------------------------------------
-- 5. leave_allocations
--    id · employee_id · leave_type_id · period_start · period_end ·
--    allocated_days · created_by · created_at
-- ---------------------------------------------------------------------------

create table public.leave_allocations (
  id              uuid        primary key default gen_random_uuid(),
  employee_id     uuid        not null references public.profiles(id) on delete cascade,
  leave_type_id   uuid        not null references public.leave_types(id) on delete restrict,
  period_start    date        not null,
  period_end      date        not null,
  allocated_days  numeric     not null,
  created_by      uuid        references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 6. leave_requests
--    id · employee_id · leave_type_id · start_date · end_date · day_part ·
--    requested_days · status · reason · decided_by · decided_at · created_at
-- ---------------------------------------------------------------------------

create table public.leave_requests (
  id              uuid                 primary key default gen_random_uuid(),
  employee_id     uuid                 not null references public.profiles(id) on delete cascade,
  leave_type_id   uuid                 not null references public.leave_types(id) on delete restrict,
  start_date      date                 not null,
  end_date        date                 not null,
  day_part        public.day_part      not null default 'full',
  requested_days  numeric              not null,
  status          public.leave_status  not null default 'pending',
  reason          text,
  decided_by      uuid                 references public.profiles(id) on delete set null,
  decided_at      timestamptz,
  created_at      timestamptz          not null default now()
);

create index leave_requests_employee_status_idx on public.leave_requests (employee_id, status);
create index leave_requests_dates_idx           on public.leave_requests (start_date, end_date);

-- ---------------------------------------------------------------------------
-- 7. leave_ledger
--    id · employee_id · leave_type_id · request_id (nullable) · entry_type ·
--    delta_days · balance_after · note · created_at
--    Balance = latest balance_after per (employee, leave_type); not stored elsewhere.
-- ---------------------------------------------------------------------------

create table public.leave_ledger (
  id              uuid                  primary key default gen_random_uuid(),
  employee_id     uuid                  not null references public.profiles(id) on delete cascade,
  leave_type_id   uuid                  not null references public.leave_types(id) on delete restrict,
  request_id      uuid                  references public.leave_requests(id) on delete set null,
  entry_type      public.ledger_entry   not null,
  delta_days      numeric               not null,   -- positive = credit, negative = debit
  balance_after   numeric               not null,
  note            text,
  created_at      timestamptz           not null default now()
);

-- ---------------------------------------------------------------------------
-- 8. Enable Row Level Security on all six tables
-- ---------------------------------------------------------------------------

alter table public.work_settings    enable row level security;
alter table public.holidays         enable row level security;
alter table public.leave_types      enable row level security;
alter table public.leave_allocations enable row level security;
alter table public.leave_requests   enable row level security;
alter table public.leave_ledger     enable row level security;

-- ---------------------------------------------------------------------------
-- 9. RLS policies — config tables (work_settings, holidays, leave_types)
--    SELECT: any authenticated member.
--    INSERT / UPDATE / DELETE: admin only.
-- ---------------------------------------------------------------------------

-- work_settings
create policy "work_settings_select"
  on public.work_settings for select to authenticated using (true);
create policy "work_settings_insert_admin"
  on public.work_settings for insert to authenticated
  with check (private.is_admin(auth.uid()));
create policy "work_settings_update_admin"
  on public.work_settings for update to authenticated
  using (private.is_admin(auth.uid()))
  with check (private.is_admin(auth.uid()));
create policy "work_settings_delete_admin"
  on public.work_settings for delete to authenticated
  using (private.is_admin(auth.uid()));

-- holidays
create policy "holidays_select"
  on public.holidays for select to authenticated using (true);
create policy "holidays_insert_admin"
  on public.holidays for insert to authenticated
  with check (private.is_admin(auth.uid()));
create policy "holidays_update_admin"
  on public.holidays for update to authenticated
  using (private.is_admin(auth.uid()))
  with check (private.is_admin(auth.uid()));
create policy "holidays_delete_admin"
  on public.holidays for delete to authenticated
  using (private.is_admin(auth.uid()));

-- leave_types
create policy "leave_types_select"
  on public.leave_types for select to authenticated using (true);
create policy "leave_types_insert_admin"
  on public.leave_types for insert to authenticated
  with check (private.is_admin(auth.uid()));
create policy "leave_types_update_admin"
  on public.leave_types for update to authenticated
  using (private.is_admin(auth.uid()))
  with check (private.is_admin(auth.uid()));
create policy "leave_types_delete_admin"
  on public.leave_types for delete to authenticated
  using (private.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- 10. RLS policies — transactional tables (SELECT only; writes via SECURITY
--     DEFINER functions added in later tasks).
--
--     INTENTIONAL: No INSERT / UPDATE / DELETE policies on leave_allocations,
--     leave_requests, or leave_ledger. This is the security mechanism:
--       - Clients cannot fabricate requested_days or self-approve requests.
--       - Ledger rows cannot be forged by authenticated clients.
--     All writes to these tables happen through SECURITY DEFINER functions
--     (tasks 2.2 – 2.5) that enforce business rules before writing.
-- ---------------------------------------------------------------------------

-- leave_allocations: own | manager-of | can_read_all
create policy "leave_allocations_select"
  on public.leave_allocations for select to authenticated
  using (
    employee_id = auth.uid()
    or private.is_manager_of(auth.uid(), employee_id)
    or private.can_read_all(auth.uid())
  );

-- leave_requests: own | same_team | can_read_all
create policy "leave_requests_select"
  on public.leave_requests for select to authenticated
  using (
    employee_id = auth.uid()
    or private.same_team(auth.uid(), employee_id)
    or private.can_read_all(auth.uid())
  );

-- leave_ledger: own | manager-of | can_read_all
create policy "leave_ledger_select"
  on public.leave_ledger for select to authenticated
  using (
    employee_id = auth.uid()
    or private.is_manager_of(auth.uid(), employee_id)
    or private.can_read_all(auth.uid())
  );
