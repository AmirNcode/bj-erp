-- FR-55 (1/4): roles, role_permissions, user_roles.role_id, exactly one admin.
-- Spec: docs/specs/2026-10-07-configurable-roles-design.md (D1, D9, D11).
-- Catalog and presets include the 2026-10-12 owner requirements (main's FR-56..63):
-- items absences (R), finance (R) and personal_info_own (E, the FR-63 "may edit
-- own personal information" switch, an explicit exception to D3); HR also edits
-- work_settings and holidays, Security reads absences, Finance reads finance.
-- 2026-10-13 (main's FR-65, owner ruling (a)): item special_leave (E, grant
-- marriage / bereavement leave; reads people and adds to a balance), and HR
-- also holds special_leave edit, absences read and finance read, so the HR
-- preset covers Security and Finance and D4 lets HR act on their holders.
-- seed_company_roles runs for every existing company below, so the presets
-- reach existing companies in this same migration.
-- Add-first: the enum column user_roles.role stays (nullable, filled for built-ins
-- by a trigger), so has_role(), approval steps, the token hook and the app still
-- running during the deploy keep working.

-- ── catalog ─────────────────────────────────────────────────────────────────
create function private.permission_keys() returns setof text
    language sql immutable set search_path to '' as $$
  select unnest(array['people','people_create','passwords','role_manager','role_assign',
    'personal_info','personal_info_own','clearance','departments','leave_balances','leave_accrual',
    'special_leave','leave_requests','calendar','reports','absences','approval_steps','work_settings',
    'holidays','finance']);
$$;

create function private.permission_allows(p_key text, p_level text) returns boolean
    language sql immutable set search_path to '' as $$
  select case
    when p_key in ('people_create','passwords','role_manager','role_assign','leave_accrual',
                   'personal_info_own','special_leave')
      then p_level = 'edit'
    when p_key in ('calendar','reports','absences','finance') then p_level = 'read'
    when p_key in ('people','personal_info','clearance','departments','leave_balances',
                   'leave_requests','approval_steps','work_settings','holidays')
      then p_level in ('read','edit')
    else false
  end;
$$;

-- D6: (key, the key's level at which the rule applies, needs at least read).
create function private.permission_deps() returns table (key text, key_level text, needs text)
    language sql immutable set search_path to '' as $$
  values
    ('people_create','read','people'), ('passwords','read','people'),
    ('role_manager','read','people'), ('role_assign','read','people'),
    ('personal_info','read','people'), ('clearance','edit','people'),
    ('departments','read','people'), ('leave_balances','read','people'),
    ('leave_accrual','read','departments'), ('leave_requests','read','people'),
    ('approval_steps','read','people'), ('reports','read','people'),
    ('reports','read','leave_balances'), ('reports','read','leave_requests'),
    ('absences','read','people'), ('absences','read','leave_requests'),
    ('special_leave','read','people'), ('special_leave','read','leave_balances');
$$;

revoke all on function private.permission_keys() from public, anon;
revoke all on function private.permission_allows(text, text) from public, anon;
revoke all on function private.permission_deps() from public, anon;
grant execute on function private.permission_keys() to authenticated;
grant execute on function private.permission_allows(text, text) to authenticated;
grant execute on function private.permission_deps() to authenticated;

-- ── tables ──────────────────────────────────────────────────────────────────
create table public.roles (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  system_key  public.app_role,
  kind        text not null check (kind in ('system','preset','custom')),
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint roles_system_key_kind check ((system_key is not null) = (kind in ('system','preset'))),
  constraint roles_name_shape check (name ~ '^[A-Za-z0-9][A-Za-z0-9 &/-]{0,39}$')
);
create unique index roles_company_system_key_uniq on public.roles (company_id, system_key)
  where system_key is not null;
create unique index roles_company_name_uniq on public.roles (company_id, lower(name));

create table public.role_permissions (
  role_id     uuid not null references public.roles(id) on delete cascade,
  permission  text not null,
  level       text not null check (level in ('read','edit')),
  primary key (role_id, permission),
  constraint role_permissions_catalog check (private.permission_allows(permission, level))
);

-- ── seeding (D9: presets = today's grants) ──────────────────────────────────
create function private.seed_company_roles(p_company uuid) returns void
    language plpgsql security definer set search_path to '' as $$
begin
  insert into public.roles (company_id, system_key, kind, name) values
    (p_company, 'admin', 'system', 'Admin'), (p_company, 'manager', 'system', 'Manager'),
    (p_company, 'employee', 'system', 'Employee'), (p_company, 'hr', 'preset', 'HR'),
    (p_company, 'security', 'preset', 'Security'), (p_company, 'finance', 'preset', 'Finance')
  on conflict do nothing;

  insert into public.role_permissions (role_id, permission, level)
  select r.id, v.permission, v.level
    from public.roles r
    join (values
      ('hr','people','edit'), ('hr','people_create','edit'), ('hr','role_manager','edit'),
      ('hr','personal_info','edit'), ('hr','clearance','edit'), ('hr','departments','edit'),
      ('hr','leave_balances','edit'), ('hr','leave_accrual','edit'), ('hr','leave_requests','read'),
      ('hr','calendar','read'), ('hr','reports','read'), ('hr','approval_steps','edit'),
      ('hr','work_settings','edit'), ('hr','holidays','edit'), ('hr','special_leave','edit'),
      ('hr','absences','read'), ('hr','finance','read'),
      ('security','people','read'), ('security','leave_balances','read'),
      ('security','leave_requests','read'), ('security','calendar','read'),
      ('security','absences','read'),
      ('finance','clearance','read'), ('finance','finance','read')
    ) as v(system_key, permission, level) on r.system_key = v.system_key::public.app_role
   where r.company_id = p_company
  on conflict do nothing;
end $$;
revoke all on function private.seed_company_roles(uuid) from public, anon, authenticated;

select private.seed_company_roles(id) from public.companies;

create function private.companies_seed_roles() returns trigger
    language plpgsql security definer set search_path to '' as $$
begin
  perform private.seed_company_roles(new.id);
  return new;
end $$;
create trigger companies_seed_roles after insert on public.companies
  for each row execute function private.companies_seed_roles();

-- ── user_roles.role_id ──────────────────────────────────────────────────────
alter table public.user_roles add column role_id uuid references public.roles(id) on delete cascade;
update public.user_roles ur
   set role_id = r.id
  from public.profiles p, public.roles r
 where p.id = ur.user_id and r.company_id = p.company_id and r.system_key = ur.role;
do $$
begin
  if exists (select 1 from public.user_roles where role_id is null) then
    raise exception 'FR-55: user_roles rows without a matching role';
  end if;
end $$;
alter table public.user_roles alter column role_id set not null;
alter table public.user_roles alter column role drop not null;
alter table public.user_roles add constraint user_roles_user_id_role_id_key unique (user_id, role_id);

-- Built-in rows carry both; custom rows carry role_id only. Enum-only inserts
-- (old app, create_employee_impl, bulk import, fixtures) get role_id here.
create function private.user_roles_sync() returns trigger
    language plpgsql security definer set search_path to '' as $$
declare
  v_company uuid := (select company_id from public.profiles where id = new.user_id);
  v_role_company uuid;
begin
  if new.role_id is null then
    if new.role is null then
      raise exception 'role or role_id required' using errcode = '23502';
    end if;
    select id into new.role_id from public.roles
     where company_id = v_company and system_key = new.role;
    if new.role_id is null then
      raise exception 'no % role for this company', new.role using errcode = '23503';
    end if;
  else
    select system_key, company_id into new.role, v_role_company from public.roles where id = new.role_id;
    if v_role_company is distinct from v_company then
      raise exception 'role belongs to another company' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger user_roles_sync before insert or update on public.user_roles
  for each row execute function private.user_roles_sync();

-- ── D1: exactly one admin ───────────────────────────────────────────────────
do $$
begin
  if (select count(*) from public.user_roles where role = 'admin') > 1 then
    raise exception 'FR-55: more than one admin role row exists; resolve before deploying';
  end if;
end $$;
create unique index user_roles_one_admin on public.user_roles ((true)) where role = 'admin';

-- ── access ──────────────────────────────────────────────────────────────────
alter table public.roles enable row level security;
alter table public.role_permissions enable row level security;
revoke all on public.roles, public.role_permissions from anon, authenticated;
grant select on public.roles, public.role_permissions to authenticated, supabase_auth_admin;

create policy roles_select on public.roles for select to authenticated
  using (private.is_active((select auth.uid()))
         and company_id = (select company_id from public.profiles where id = (select auth.uid())));
create policy roles_select_auth_admin on public.roles for select to supabase_auth_admin using (true);
create policy role_permissions_select on public.role_permissions for select to authenticated
  using (exists (select 1 from public.roles r where r.id = role_id));
create policy role_permissions_select_auth_admin on public.role_permissions
  for select to supabase_auth_admin using (true);
