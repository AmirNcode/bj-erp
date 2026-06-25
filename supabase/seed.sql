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
insert into public.departments (id, company_id, name_fa, name_en, kind) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c0', 'خط تولید الف',      'Production Line A', 'team'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c0', 'کنترل کیفیت',        'Quality Control',   'team'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000c0', 'نگهداری و تعمیرات', 'Maintenance',       'team'),
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000c0', 'حراست',              'Security',          'security')
on conflict (id) do nothing;

-- Work settings: Friday weekend. Keyed on company (no unique constraint -> guard).
insert into public.work_settings (company_id, weekend_days)
select '00000000-0000-0000-0000-0000000000c0', '{5}'
where not exists (
  select 1 from public.work_settings where company_id = '00000000-0000-0000-0000-0000000000c0'
);

-- Leave types: annual (paid, 26d, half-day), sick (paid), unpaid (no balance).
-- Keyed on (company, name_en) since ids are server-generated.
insert into public.leave_types (company_id, name_fa, name_en, is_paid, affects_balance, default_annual_quota_days, allow_half_day)
select '00000000-0000-0000-0000-0000000000c0', 'مرخصی استحقاقی', 'Annual Leave', true, true, 26, true
where not exists (
  select 1 from public.leave_types
  where company_id = '00000000-0000-0000-0000-0000000000c0' and name_en = 'Annual Leave'
);

insert into public.leave_types (company_id, name_fa, name_en, is_paid, affects_balance, allow_half_day)
select '00000000-0000-0000-0000-0000000000c0', 'مرخصی استعلاجی', 'Sick Leave', true, true, true
where not exists (
  select 1 from public.leave_types
  where company_id = '00000000-0000-0000-0000-0000000000c0' and name_en = 'Sick Leave'
);

insert into public.leave_types (company_id, name_fa, name_en, is_paid, affects_balance, allow_half_day)
select '00000000-0000-0000-0000-0000000000c0', 'مرخصی بدون حقوق', 'Unpaid Leave', true, false, true
where not exists (
  select 1 from public.leave_types
  where company_id = '00000000-0000-0000-0000-0000000000c0' and name_en = 'Unpaid Leave'
);
