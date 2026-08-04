-- =============================================================================
-- supabase/seed.sql — portable CONFIG baseline (idempotent).
--
-- Seeds the shared config a fresh (e.g. self-hosted) database needs: the company,
-- its departments, leave types, and work settings. Safe to re-run; a no-op against
-- the already-configured demo project.
--
-- Employees (need the auth write-path) and holidays are seeded separately by
-- scripts/seed-demo.mjs, which signs in as admin and calls the guarded RPCs.
-- =============================================================================

-- Company (fixed id; matches the demo).
insert into public.companies (id, name)
values ('00000000-0000-0000-0000-0000000000c0', 'BJ Manufacturing')
on conflict (id) do nothing;

-- Departments: 3 teams + Security (fixed ids; matches the demo).
-- `code` used to be the latin prefix of generated employee codes (prod-1042).
-- Since 20260730130002 it prefixes nothing and no human types it; the column
-- stays NOT NULL + unique, so these fixed values are still supplied here.
insert into public.departments (id, company_id, name_fa, name_en, kind, code) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c0', 'خط تولید الف',      'Production Line A', 'team',     'prod'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c0', 'کنترل کیفیت',        'Quality Control',   'team',     'qc'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000c0', 'نگهداری و تعمیرات', 'Maintenance',       'team',     'mant'),
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000c0', 'حراست',              'Security',          'security', 'sec')
on conflict (id) do nothing;

-- Older installs created these rows before `code` existed — align them.
update public.departments set code = c.v
from (values ('00000000-0000-0000-0000-0000000000d1','prod'),
             ('00000000-0000-0000-0000-0000000000d2','qc'),
             ('00000000-0000-0000-0000-0000000000d3','mant'),
             ('00000000-0000-0000-0000-0000000000d4','sec')) as c(i,v)
where id = c.i::uuid and code is distinct from c.v;

-- Work settings: Friday weekend. Keyed on company (no unique constraint -> guard).
insert into public.work_settings (company_id, weekend_days)
select '00000000-0000-0000-0000-0000000000c0', '{5}'
where not exists (
  select 1 from public.work_settings where company_id = '00000000-0000-0000-0000-0000000000c0'
);

-- Leave types: annual (paid, 26d, half-day), sick (paid), unpaid (no balance).
-- Keyed on (company, name_en) since ids are server-generated.
-- Accrual + hourly columns are set EXPLICITLY here, not left to the migrations
-- that backfill them. deploy/install.sh applies migrations BEFORE this seed, so on
-- a fresh install those UPDATE statements match zero rows and these types would
-- otherwise land with allow_hourly = false and null accrual defaults — hourly
-- silently unavailable and nobody accruing. (Found 2026-07-29.)
insert into public.leave_types (company_id, name_fa, name_en, is_paid, affects_balance, default_annual_quota_days, allow_half_day, allow_hourly, default_accrual_minutes_per_month, default_annual_cap_minutes, default_carryover_cap_minutes)
select '00000000-0000-0000-0000-0000000000c0', 'مرخصی استحقاقی', 'Annual Leave', true, true, 26, true, true, 480, 5760, 4320
where not exists (
  select 1 from public.leave_types
  where company_id = '00000000-0000-0000-0000-0000000000c0' and name_en = 'Annual Leave'
);

-- Sick leave: certified, not accrued, and never hourly (the paper hourly form
-- offers only استحقاقی and بدون حقوق).
insert into public.leave_types (company_id, name_fa, name_en, is_paid, affects_balance, allow_half_day, allow_hourly, default_accrual_minutes_per_month, default_carryover_cap_minutes)
select '00000000-0000-0000-0000-0000000000c0', 'مرخصی استعلاجی', 'Sick Leave', true, true, true, false, 0, 4320
where not exists (
  select 1 from public.leave_types
  where company_id = '00000000-0000-0000-0000-0000000000c0' and name_en = 'Sick Leave'
);

insert into public.leave_types (company_id, name_fa, name_en, is_paid, affects_balance, allow_half_day, allow_hourly, default_carryover_cap_minutes)
select '00000000-0000-0000-0000-0000000000c0', 'مرخصی بدون حقوق', 'Unpaid Leave', true, false, true, true, 4320
where not exists (
  select 1 from public.leave_types
  where company_id = '00000000-0000-0000-0000-0000000000c0' and name_en = 'Unpaid Leave'
);
