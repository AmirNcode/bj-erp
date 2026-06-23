-- =============================================================================
-- Migration: 20260623120001_core.sql
-- Purpose  : Core enums, tables, indexes, and updated_at triggers.
-- Spec     : docs/DATA_MODEL.md  (Core tables section)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------

create type public.app_role as enum ('admin', 'manager', 'employee', 'security');
create type public.department_kind as enum ('team', 'security', 'office');

-- ---------------------------------------------------------------------------
-- 2. updated_at trigger function (shared by all tables that carry updated_at)
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. companies
--    id · name · created_at
--    Single row in v1; modelled for multi-tenant later.
-- ---------------------------------------------------------------------------

create table public.companies (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 4. departments
--    id · company_id · name_fa · name_en · kind · manager_id · created_at
--    manager_id FK to profiles is added after profiles is created (see below).
-- ---------------------------------------------------------------------------

create table public.departments (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name_fa    text not null,
  name_en    text not null,
  kind       public.department_kind not null,
  manager_id uuid,                          -- FK to profiles added after profiles
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 5. profiles
--    id (= auth user id) · company_id · employee_code · full_name ·
--    department_id · manager_id (self-FK) · hire_date · language_pref ·
--    calendar_pref · active · created_at
-- ---------------------------------------------------------------------------

create table public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  company_id      uuid not null references public.companies(id) on delete cascade,
  employee_code   text unique not null,
  full_name       text not null,
  department_id   uuid references public.departments(id) on delete set null,
  manager_id      uuid references public.profiles(id) on delete set null,
  hire_date       date,
  language_pref   text not null default 'fa',
  calendar_pref   text not null default 'jalali',
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

-- Now that profiles exists, wire departments.manager_id → profiles
alter table public.departments
  add constraint departments_manager_id_fkey
  foreign key (manager_id) references public.profiles(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 6. user_roles
--    id · user_id · role · unique(user_id, role)
-- ---------------------------------------------------------------------------

create table public.user_roles (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  role    public.app_role not null,
  unique (user_id, role)
);

-- ---------------------------------------------------------------------------
-- 7. audit_log
--    id · actor_id · action · entity · entity_id · before · after · created_at
-- ---------------------------------------------------------------------------

create table public.audit_log (
  id        uuid primary key default gen_random_uuid(),
  actor_id  uuid references public.profiles(id) on delete set null,
  action    text not null,
  entity    text not null,
  entity_id uuid,
  before    jsonb,
  after     jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 8. Indexes
-- ---------------------------------------------------------------------------

create index on public.profiles (department_id);
create index on public.profiles (manager_id);
create index on public.user_roles (user_id);
