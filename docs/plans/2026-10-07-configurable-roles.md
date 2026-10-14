# Configurable roles and permissions (FR-55) Implementation Plan

> **Built 2026-10-13.** Migration names below (`20261007160001`..`160005`) were renamed to
> `20261013200001`..`200005` when the branch was rebased onto main; the catalog grew from 16 to 20
> items and `personnel_no` was dropped. The spec's Status section lists every amendment.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> Repo convention: **no commits unless Amir asks**. Every "Commit" step below is "stop, run the
> listed checks, report"; Amir commits.

**Goal:** Admin creates and edits roles in Settings › Roles with a three-way toggle per access item, and no path can produce a second admin.

**Architecture:** A `roles` table (system, preset, custom rows) and a `role_permissions` table replace hard-coded grants. `user_roles` gains `role_id` and keeps its enum column for built-ins. Every catalog-area SQL gate calls `private.has_perm(uid, key, level)`. Every write that acts on a person also calls `private.can_act_on(caller, target)`, the subset rule. The app reads an `app_perms` JWT claim through `lib/auth/permissions.ts`. One pure TS catalog drives the editor UI, the nav and the capability checks.

**Tech stack:** Postgres 15 (Supabase image), PostgREST, GoTrue token hook, Next.js 16 App Router server actions, React 19, next-intl, `radix-ui` 1.6 (ToggleGroup, Collapsible, DropdownMenu, Tooltip), lucide-react, Vitest, Playwright.

**Spec:** `docs/specs/2026-10-07-configurable-roles-design.md`. Read it before any task. Decision
ids (D1–D12) below refer to it.

## Spec amendment made by this plan (confirm with Amir at handoff)

**`personnel_no` is dropped from the v1 catalog. It now has 16 items.**
- No screen changes a personnel number today, not even for the admin. The login email is derived
  from the personnel number at creation, so changing `profiles.personnel_no` alone would desync
  the login.
- A toggle with no feature behind it would mislead, so the column stays admin-only in SQL, as
  today.
- Task 13 updates the spec's catalog table, D6 table and preset table to match.

## Global Constraints

- Migrations are forward-only. Never edit an applied migration. Dry-run each one, plus every
  `tests/sql/*`, inside `begin … rollback` as `supabase_admin` before
  `./deploy/bj-deploy update local`. Then run `npm run schema:dump` and hand-edit
  `lib/supabase/types.ts`.
- **Add first:** the old app keeps working during deploy. Keep `private.has_permission(uid, text)`
  with its legacy keys, and keep `public.app_set_user_roles(uuid, app_role[])`.
- **Every new RPC:**
  - `language plpgsql` or `sql`, `security definer`, `set search_path to ''`.
  - `revoke all on function … from public, anon;` then `grant execute … to authenticated;`.
  - Errors carry `errcode '42501'` (not allowed) or `'22023'` (invalid input) with an English
    message.
- **Every new private helper:** `security definer`, `set search_path to ''`, execute to
  `authenticated` only (plus `supabase_auth_admin` where the token hook needs it).
- All `auth.uid()` calls in policies are written `(select auth.uid())`.
- Audit rows go to `public.audit_log (actor_id, action, entity, entity_id, before, after)` inside
  the same transaction.
- **Permission levels:** `read` < `edit`, ints 1 < 2, absence = 0. Keys, exactly:
  `people, people_create, passwords, role_manager, role_assign, personal_info, clearance,
  departments, leave_balances, leave_accrual, leave_requests, calendar, reports, approval_steps,
  work_settings, holidays`.
- **Role names:** English only, regex `^[A-Za-z0-9][A-Za-z0-9 &/-]{0,39}$`, unique per company
  ignoring case. Built-ins: `Admin`, `Manager`, `Employee`, `HR`, `Security`, `Finance`.
- **Server actions:** start with `requireCaller(...)`, then `if (!c.ok) return c;`.
- **User-facing strings** go in both `messages/fa.json` and `messages/en.json`. Namespaces:
  `rolesAdmin` (screens) and `permissions` (catalog). The existing `roles` namespace (role labels)
  gets English values in **both** files (D11).
- **e2e:** only `999…` throwaway users (the local DB holds the real roster). Run with
  `--workers=1`. Never run `accrual.spec`.
- `docs/files/` is never committed. Every session appends to `docs/AGENT-LOG.md`.

## Review Focus

1. **The old app writing `user_roles` without `role_id`** during the deploy window, and old SQL
   (`create_employee_impl`, bulk import, the fixtures) inserting `(user_id, role)`. Expect the sync
   trigger to fill `role_id`. Test: a Task 1 scenario inserts an enum-only row and reads back
   `role_id`.
2. **A company created after the migration** (the fixture "other company", a future deploy). Expect
   its six roles to be seeded automatically, so role inserts for its users work. Test: a Task 1
   scenario.
3. **A deactivated holder of a strong role being reactivated by someone weaker.** Expect a refusal,
   because the target's levels ignore `active`. Test: Task 2 subset matrix, "helpdesk may not
   reactivate a deactivated hr".
4. **Editing a preset** so hr loses `people`. Expect hr's profile writes to be refused at once
   through RLS, while their nav shows stale items until token refresh. Test: Task 2 scenario
   "preset edit takes effect immediately in SQL".
5. **The admin transferring to someone who already holds `admin`** (impossible, since there is one)
   **or to themselves, or the old admin's stale token.** Expect self-transfer to be refused, and the
   old admin's next action to be refused by SQL even with a stale `app_roles` claim. Test: Task 3
   transfer scenarios plus "old admin refused after transfer".

---

## File structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261007160001_roles_tables.sql` | roles, role_permissions, catalog fns, seeding, `user_roles.role_id` + sync, one-admin index |
| `supabase/migrations/20261007160002_roles_helpers.sql` | `perm_level`, `has_perm`, `reads_*`, `can_act_on`, `role_within`, legacy alias, `app_my_permissions`, token hook |
| `supabase/migrations/20261007160003_roles_gates.sql` | every policy, trigger and RPC guard moved to `has_perm` / `can_act_on` (+D7) |
| `supabase/migrations/20261007160004_roles_rpcs.sql` | role editor RPCs, new `app_set_user_roles`, `app_transfer_admin`, `app_create_employee` with role ids |
| `tests/sql/fr55-roles-permissions.sql` | all FR-55 SQL scenarios |
| `lib/permissions/catalog.ts` | pure catalog, dependency raising, section summary and bulk, subset check |
| `lib/auth/permissions.ts` | `getCachedPermissions`, `can` (server only) |
| `lib/auth/context.ts` | `requireCaller({ perm })` |
| `lib/nav/tabs.ts` | nav from roles + perms |
| `lib/employees/editCapabilities.ts` | capabilities from perms, D3–D5 mirror |
| `lib/actions/roles.ts` | roles server actions |
| `app/[locale]/(app)/settings/_components/SettingsTabs.tsx` | General / Roles tabs |
| `app/[locale]/(app)/settings/roles/*` | list, editor pages, components |
| `components/ui/tri-state-toggle.tsx` | the three-way segmented control |

---

### Task 1: Roles tables, seeding, `user_roles.role_id`, one admin

**Files:**
- Create: `supabase/migrations/20261007160001_roles_tables.sql`
- Create: `tests/sql/fr55-roles-permissions.sql` (section "tables")
- Modify: `tests/sql/fr51-hr-employee-admin.sql`, `tests/sql/fr52-53-signature-personal-info.sql`,
  `tests/sql/fr54-clearance.sql` (drop the one-admin index inside their transaction)

**Interfaces:**
- Produces:
  - Tables `public.roles(id, company_id, system_key app_role null, kind, name, created_at,
    updated_at)` and `public.role_permissions(role_id, permission, level)`.
  - Column `public.user_roles.role_id uuid not null`.
  - Functions `private.permission_keys() → setof text`, `private.permission_allows(text, text) →
    bool`, `private.permission_deps() → table(key text, key_level text, needs text)`,
    `private.seed_company_roles(uuid)`.
  - Index `public.user_roles_one_admin`.

- [ ] **Step 1: Write the failing SQL scenarios.** Create `tests/sql/fr55-roles-permissions.sql`
  with the header, `fx` table, `pg_temp.try_as`, `pg_temp.expect` and `pg_temp.id` copied verbatim
  from `tests/sql/fr51-hr-employee-admin.sql` lines 1–50. Change the title comment to
  `-- FR-55 scenarios: configurable roles, permissions, exactly one admin.` Then add:

```sql
-- ── fixtures ────────────────────────────────────────────────────────────────
do $$
declare
  v_company uuid := (select company_id from public.profiles where employee_code = 'admin');
  v_dept    uuid := (select id from public.departments where company_id = v_company order by code limit 1);
  r record;
begin
  insert into fx values ('company', v_company), ('dept', v_dept);
  insert into fx values ('admin', (select id from public.profiles where employee_code = 'admin'));
  for r in
    select * from (values
      ('hr',      'hr',       true,  '9990000951'),
      ('hr_off',  'hr',       false, '9990000952'),
      ('mgr',     'manager',  true,  '9990000953'),
      ('emp',     'employee', true,  '9990000954'),
      ('emp2',    'employee', true,  '9990000955'),
      ('help',    'employee', true,  '9990000956'),
      ('deptmgr', 'employee', true,  '9990000957'),
      ('sec',     'security', true,  '9990000958'),
      ('fin',     'finance',  true,  '9990000959'),
      ('super',   'employee', true,  '9990000960')
    ) as t(k, role, active, code)
  loop
    insert into fx values (r.k, gen_random_uuid());
    insert into auth.users (id, email, encrypted_password)
      values ((select id from fx where k = r.k), r.code || '@fixture.invalid', extensions.crypt('Fixture!2026', extensions.gen_salt('bf')));
    insert into public.profiles (id, company_id, employee_code, full_name, department_id, manager_id, active, personnel_no, must_change_password)
    values ((select id from fx where k = r.k), v_company, r.code, 'FR55 ' || r.k, v_dept,
            case when r.k = 'emp' then (select id from fx where k = 'mgr') end,
            r.active, r.code, false);
    -- Enum-only insert, as the old app and older SQL do: the sync trigger fills role_id.
    insert into public.user_roles (user_id, role) values ((select id from fx where k = r.k), r.role::public.app_role);
    if r.role <> 'employee' then
      insert into public.user_roles (user_id, role) values ((select id from fx where k = r.k), 'employee');
    end if;
  end loop;
end $$;
```

```sql
-- ── tables (Task 1) ─────────────────────────────────────────────────────────
select pg_temp.expect('six roles seeded for the company',
  (select count(*)::text from public.roles where company_id = (select id from fx where k = 'company')), '6');
select pg_temp.expect('enum-only insert gets role_id',
  (select count(*)::text from public.user_roles ur join public.roles r on r.id = ur.role_id
    where ur.user_id = (select id from fx where k = 'hr') and r.system_key = 'hr'), '1');
select pg_temp.expect('hr preset has 12 permissions',
  (select count(*)::text from public.role_permissions rp join public.roles r on r.id = rp.role_id
    where r.company_id = (select id from fx where k = 'company') and r.system_key = 'hr'), '12');
select pg_temp.expect('security preset has 4, finance 1',
  (select string_agg(n::text, ',' order by k) from (
     select r.system_key::text k, count(*) n from public.role_permissions rp join public.roles r on r.id = rp.role_id
      where r.company_id = (select id from fx where k = 'company') and r.system_key in ('security','finance') group by 1) s), '1,4');
do $$
declare v_new uuid;
begin
  insert into public.companies (name) values ('FR55 Other Co') returning id into v_new;
  insert into fx values ('other_company', v_new);
end $$;
select pg_temp.expect('a new company gets its six roles',
  (select count(*)::text from public.roles where company_id = (select id from fx where k = 'other_company')), '6');
do $$
begin
  begin
    insert into public.user_roles (user_id, role) values ((select id from fx where k = 'emp2'), 'admin');
    raise notice 'FAIL second admin insert: got ok, want 23505';
  exception when unique_violation then
    raise notice 'PASS second admin insert: got 23505, want 23505';
  end;
end $$;
select pg_temp.expect('clients cannot insert roles directly (even the admin)',
  pg_temp.try_as('admin', $q$insert into public.roles (company_id, kind, name) values ((select id from fx where k='company'),'custom','Clerk')$q$),
  '42501');
do $$
begin
  begin
    insert into public.roles (company_id, kind, name) values ((select id from fx where k='company'), 'custom', 'حسابداری');
    raise notice 'FAIL non-latin role name: got ok, want 23514';
  exception when check_violation then
    raise notice 'PASS non-latin role name: got 23514, want 23514';
  end;
end $$;
select pg_temp.expect('permission catalog check',
  (select private.permission_allows('calendar','edit')::text || private.permission_allows('people','read')::text), 'falsetrue');

rollback;
```

  Keep `rollback;` as the file's last line. Every later task inserts its sections **above** it.

- [ ] **Step 2: Run it to see it fail.**

  Run:
  ```bash
  ( export PGPASSWORD="$(grep '^POSTGRES_PASSWORD=' deploy/.env | cut -d= -f2-)"; docker exec -i -e PGPASSWORD bj-erp-db-1 psql -U supabase_admin -d postgres -q ) < tests/sql/fr55-roles-permissions.sql
  ```
  Expected: `ERROR: relation "public.roles" does not exist`.

- [ ] **Step 3: Write the migration.** Create
  `supabase/migrations/20261007160001_roles_tables.sql`:

```sql
-- FR-55 (1/4): roles, role_permissions, user_roles.role_id, exactly one admin.
-- Spec: docs/specs/2026-10-07-configurable-roles-design.md (D1, D9, D11).
-- Add-first: the enum column user_roles.role stays (nullable, filled for built-ins
-- by a trigger), so has_role(), approval steps, the token hook and the app still
-- running during the deploy keep working.

-- ── catalog ─────────────────────────────────────────────────────────────────
create function private.permission_keys() returns setof text
    language sql immutable set search_path to '' as $$
  select unnest(array['people','people_create','passwords','role_manager','role_assign',
    'personal_info','clearance','departments','leave_balances','leave_accrual','leave_requests',
    'calendar','reports','approval_steps','work_settings','holidays']);
$$;

create function private.permission_allows(p_key text, p_level text) returns boolean
    language sql immutable set search_path to '' as $$
  select case
    when p_key in ('people_create','passwords','role_manager','role_assign','leave_accrual')
      then p_level = 'edit'
    when p_key in ('calendar','reports') then p_level = 'read'
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
    ('reports','read','leave_balances'), ('reports','read','leave_requests');
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
      ('security','people','read'), ('security','leave_balances','read'),
      ('security','leave_requests','read'), ('security','calendar','read'),
      ('finance','clearance','read')
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
```

- [ ] **Step 4: Fix the three older SQL test files.** In each of
  `tests/sql/fr51-hr-employee-admin.sql`, `tests/sql/fr52-53-signature-personal-info.sql` and
  `tests/sql/fr54-clearance.sql`, insert directly after the line `begin;`:

```sql
-- FR-55 allows one admin row (user_roles_one_admin). These scenarios predate it
-- and need a second admin fixture; the drop is rolled back with everything else.
drop index public.user_roles_one_admin;
```

- [ ] **Step 5: Dry-run the migration, then apply it.**

  1. Dry-run the migration plus all four SQL files inside one transaction:
     ```bash
     ( export PGPASSWORD="$(grep '^POSTGRES_PASSWORD=' deploy/.env | cut -d= -f2-)"; { echo 'begin;'; cat supabase/migrations/20261007160001_roles_tables.sql; echo 'rollback;'; } | docker exec -i -e PGPASSWORD bj-erp-db-1 psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q )
     ```
     Expected: no error.
  2. Apply: `./deploy/bj-deploy update local`, then `docker restart bj-erp-rest-1`.
  3. Run the four `tests/sql/*.sql` files with the Step 2 command.
     Expected: every line `PASS`; fr51, fr52-53 and fr54 unchanged.

- [ ] **Step 6: Stop and report.** Show the PASS lines. Do not commit.

---

### Task 2: Permission helpers, gates and the subset rule

**Files:**
- Create: `supabase/migrations/20261007160002_roles_helpers.sql`
- Create: `supabase/migrations/20261007160003_roles_gates.sql`
- Modify: `tests/sql/fr55-roles-permissions.sql` (sections "helpers" and "gates")

**Interfaces:**
- Consumes: Task 1 tables and functions.
- Produces:
  - `private.perm_level(uuid, text) → int`.
  - `private.has_perm(uuid, text, text default 'edit') → bool`.
  - `private.reads_people(uuid)`, `private.reads_balances(uuid)`, `private.reads_calendar(uuid)`.
  - `private.can_act_on(uuid, uuid) → bool`, `private.role_within(uuid role_id, uuid uid) → bool`.
  - `public.app_my_permissions() → jsonb`.
  - Token hook claim `app_perms` (`{"people":"edit",…}`).

- [ ] **Step 1: Add the failing scenarios** above `rollback;`. A "Helpdesk" custom role is
  inserted directly as superuser (the RPC arrives in Task 3):

```sql
-- ── helpers + gates (Task 2) ────────────────────────────────────────────────
do $$
declare v_role uuid;
begin
  insert into public.roles (company_id, kind, name) values ((select id from fx where k='company'), 'custom', 'Helpdesk') returning id into v_role;
  insert into public.role_permissions values (v_role, 'people', 'read'), (v_role, 'passwords', 'edit');
  insert into fx values ('r_help', v_role);
  insert into public.user_roles (user_id, role_id) values ((select id from fx where k='help'), v_role);
  -- 'super': every catalog item at its highest level (D2 checks)
  insert into public.roles (company_id, kind, name) values ((select id from fx where k='company'), 'custom', 'Everything') returning id into v_role;
  insert into public.role_permissions select v_role, k, case when private.permission_allows(k,'edit') then 'edit' else 'read' end from private.permission_keys() k;
  insert into fx values ('r_super', v_role);
  insert into public.user_roles (user_id, role_id) values ((select id from fx where k='super'), v_role);
  update public.departments set manager_id = (select id from fx where k='deptmgr') where id = (select id from fx where k='dept');
end $$;

select pg_temp.expect('perm_level: hr people edit, help passwords edit, emp none',
  (select private.perm_level((select id from fx where k='hr'),'people')::text
       || private.perm_level((select id from fx where k='help'),'passwords')::text
       || private.perm_level((select id from fx where k='emp'),'people')::text), '220');
select pg_temp.expect('admin perm_level is max per key',
  (select private.perm_level((select id from fx where k='admin'),'calendar')::text
       || private.perm_level((select id from fx where k='admin'),'people')::text), '12');
select pg_temp.expect('legacy key alias still answers',
  (select private.has_permission((select id from fx where k='hr'),'employees.edit')::text
       || private.has_permission((select id from fx where k='fin'),'separations.view')::text
       || private.has_permission((select id from fx where k='sec'),'employees.edit')::text), 'truetruefalse');
-- subset rule (D4)
select pg_temp.expect('helpdesk acts on a plain employee',
  (select private.can_act_on((select id from fx where k='help'), (select id from fx where k='emp2'))::text), 'true');
select pg_temp.expect('helpdesk not on a manager (relationship power)',
  (select private.can_act_on((select id from fx where k='help'), (select id from fx where k='mgr'))::text), 'false');
select pg_temp.expect('helpdesk not on a department manager',
  (select private.can_act_on((select id from fx where k='help'), (select id from fx where k='deptmgr'))::text), 'false');
select pg_temp.expect('helpdesk not on hr (more permissions)',
  (select private.can_act_on((select id from fx where k='help'), (select id from fx where k='hr'))::text), 'false');
select pg_temp.expect('helpdesk may not reactivate a deactivated hr',
  (select private.can_act_on((select id from fx where k='help'), (select id from fx where k='hr_off'))::text), 'false');
select pg_temp.expect('nobody acts on the admin, not even Everything',
  (select private.can_act_on((select id from fx where k='super'), (select id from fx where k='admin'))::text), 'false');
select pg_temp.expect('never on yourself',
  (select private.can_act_on((select id from fx where k='hr'), (select id from fx where k='hr'))::text), 'false');
select pg_temp.expect('hr acts on security and finance (parity)',
  (select private.can_act_on((select id from fx where k='hr'), (select id from fx where k='sec'))::text
       || private.can_act_on((select id from fx where k='hr'), (select id from fx where k='fin'))::text), 'truetrue');
select pg_temp.expect('hr not on helpdesk (passwords hr lacks)',
  (select private.can_act_on((select id from fx where k='hr'), (select id from fx where k='help'))::text), 'false');
-- gates
select pg_temp.expect('helpdesk resets an employee password',
  pg_temp.try_as('help', format('select public.app_set_employee_password(%s, %L)', pg_temp.id('emp2'), 'Temp!2026x')), 'ok:1');
select pg_temp.expect('helpdesk may not reset a manager',
  pg_temp.try_as('help', format('select public.app_set_employee_password(%s, %L)', pg_temp.id('mgr'), 'Temp!2026x')), '42501');
select pg_temp.expect('helpdesk may not edit a profile (people read only)',
  pg_temp.try_as('help', format('update public.profiles set job_title = %L where id = %s', 'x', pg_temp.id('emp2'))), '42501');
select pg_temp.expect('security reads profiles company-wide (parity)',
  pg_temp.try_as('sec', 'select 1 from public.profiles where full_name like ''FR55 %'''), 'ok:10');
select pg_temp.expect('finance does not read profiles company-wide (parity)',
  pg_temp.try_as('fin', format('select 1 from public.profiles where id = %s', pg_temp.id('emp2'))), 'ok:0');
select pg_temp.expect('hr reads leave_requests base rows (parity)',
  pg_temp.try_as('hr', 'select 1 from public.leave_requests limit 1'), (select case when exists (select 1 from public.leave_requests) then 'ok:1' else 'ok:0' end));
select pg_temp.expect('D7: hr may not appoint themselves department manager',
  pg_temp.try_as('hr', format('update public.departments set manager_id = %s where id <> %s and company_id = %s',
    pg_temp.id('hr'), pg_temp.id('dept'), pg_temp.id('company'))), '42501');
select pg_temp.expect('D2: Everything holds every catalog item yet is not admin (approval override keys on is_admin)',
  (select (private.has_perm((select id from fx where k='super'),'approval_steps','edit')
           and not private.is_admin((select id from fx where k='super')))::text), 'true');
select pg_temp.expect('D2: Everything may not read the audit log',
  pg_temp.try_as('super', 'select 1 from public.audit_log limit 1'), 'ok:0');
select pg_temp.expect('D2: Everything may not bulk-import in update mode',
  pg_temp.try_as('super', format($q$select public.app_bulk_import_employees(%s, 'update', '[]'::jsonb, '[]'::jsonb, null, false, '{}'::uuid[], '[]'::jsonb, '{}'::text[])$q$,
    pg_temp.id('company'))), '42501');
-- preset edits take effect immediately (Review Focus 4)
delete from public.role_permissions
 where role_id = (select id from public.roles where company_id = (select id from fx where k='company') and system_key='hr')
   and permission = 'people';
select pg_temp.expect('hr without people is refused at once',
  pg_temp.try_as('hr', format('update public.profiles set job_title = %L where id = %s', 'x', pg_temp.id('emp2'))), 'ok:0');
insert into public.role_permissions
  select id, 'people', 'edit' from public.roles where company_id = (select id from fx where k='company') and system_key='hr';
-- app_my_permissions / hook
select pg_temp.expect('app_my_permissions for helpdesk',
  pg_temp.try_as('help', $q$do $d$ begin if public.app_my_permissions() <> '{"people":"read","passwords":"edit"}'::jsonb then raise exception 'x' using errcode='P0001'; end if; end $d$$q$), 'ok:0');
select pg_temp.expect('token hook emits app_perms',
  (select (public.custom_access_token_hook(jsonb_build_object('user_id',(select id from fx where k='help'),'claims','{}'::jsonb))
            -> 'claims' -> 'app_perms')::text), '{"people": "read", "passwords": "edit"}');
select pg_temp.expect('token hook: inactive user gets nothing',
  (select (public.custom_access_token_hook(jsonb_build_object('user_id',(select id from fx where k='hr_off'),'claims','{}'::jsonb))
            -> 'claims' ->> 'app_roles')), '[]');
```

- [ ] **Step 2: Run the file.** Expected: `ERROR: function private.perm_level … does not exist`.

- [ ] **Step 3: Write `20261007160002_roles_helpers.sql`:**

```sql
-- FR-55 (2/4): permission helpers, the subset rule, the legacy alias, the token claim.

create function private.perm_level(uid uuid, p_key text) returns int
    language sql stable security definer set search_path to '' as $$
  -- Ignores `active` on purpose: a deactivated holder keeps their latent levels,
  -- so someone weaker cannot reactivate them (D4). Callers add is_active.
  select case
    when exists (select 1 from public.user_roles where user_id = uid and role = 'admin') then
      case when private.permission_allows(p_key, 'edit') then 2
           when private.permission_allows(p_key, 'read') then 1 else 0 end
    else coalesce((
      select max(case rp.level when 'edit' then 2 else 1 end)
        from public.user_roles ur
        join public.role_permissions rp on rp.role_id = ur.role_id
       where ur.user_id = uid and rp.permission = p_key), 0)
  end;
$$;

create function private.has_perm(uid uuid, p_key text, p_level text default 'edit') returns boolean
    language sql stable security definer set search_path to '' as $$
  select private.is_active(uid)
     and private.perm_level(uid, p_key) >= case p_level when 'edit' then 2 else 1 end;
$$;

create function private.reads_people(uid uuid) returns boolean
    language sql stable security definer set search_path to '' as $$
  select private.has_role(uid, 'manager') or private.has_perm(uid, 'people', 'read');
$$;
create function private.reads_balances(uid uuid) returns boolean
    language sql stable security definer set search_path to '' as $$
  select private.has_role(uid, 'manager') or private.has_perm(uid, 'leave_balances', 'read');
$$;
create function private.reads_calendar(uid uuid) returns boolean
    language sql stable security definer set search_path to '' as $$
  select private.has_role(uid, 'manager') or private.has_perm(uid, 'calendar', 'read');
$$;

-- D4. Admin callers never reach this: every call site checks is_admin first.
create function private.can_act_on(p_caller uuid, p_target uuid) returns boolean
    language sql stable security definer set search_path to '' as $$
  select p_caller is distinct from p_target
     and private.is_active(p_caller)
     and exists (select 1 from public.profiles t
                   join public.profiles c on c.id = p_caller and c.company_id = t.company_id
                  where t.id = p_target)
     and not exists (select 1 from public.user_roles where user_id = p_target and role = 'admin')
     and not exists (select 1 from private.permission_keys() k
                      where private.perm_level(p_target, k) > private.perm_level(p_caller, k))
     and (not exists (select 1 from public.user_roles where user_id = p_target and role = 'manager')
          or private.has_perm(p_caller, 'role_manager', 'edit'))
     and (not exists (select 1 from public.departments where manager_id = p_target)
          or private.has_perm(p_caller, 'departments', 'edit'));
$$;

-- D5. May p_uid add or remove this role? (company checked by the caller)
create function private.role_within(p_role_id uuid, p_uid uuid) returns boolean
    language sql stable security definer set search_path to '' as $$
  select case (select system_key from public.roles where id = p_role_id)
    when 'admin' then false
    when 'manager' then private.has_perm(p_uid, 'role_manager', 'edit')
    else private.has_perm(p_uid, 'role_assign', 'edit')
         and not exists (
           select 1 from public.role_permissions rp
            where rp.role_id = p_role_id
              and case rp.level when 'edit' then 2 else 1 end > private.perm_level(p_uid, rp.permission))
  end;
$$;

-- Legacy keys (FR-51..54 call sites), kept for the deploy window; dropped next release.
create or replace function private.has_permission(uid uuid, p_permission text) returns boolean
    language sql stable security definer set search_path to '' as $$
  select case p_permission
    when 'employees.edit'     then private.has_perm(uid, 'people', 'edit')
    when 'departments.edit'   then private.has_perm(uid, 'departments', 'edit')
    when 'accruals.run'       then private.has_perm(uid, 'leave_accrual', 'edit')
    when 'roles.manager'      then private.has_perm(uid, 'role_manager', 'edit')
    when 'personal_info.view' then private.has_perm(uid, 'personal_info', 'read')
    when 'personal_info.edit' then private.has_perm(uid, 'personal_info', 'edit')
    when 'separations.manage' then private.has_perm(uid, 'clearance', 'edit')
    when 'separations.view'   then private.has_perm(uid, 'clearance', 'read')
    else false
  end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'private.perm_level(uuid, text)', 'private.has_perm(uuid, text, text)',
    'private.reads_people(uuid)', 'private.reads_balances(uuid)', 'private.reads_calendar(uuid)',
    'private.can_act_on(uuid, uuid)', 'private.role_within(uuid, uuid)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- The token hook runs as supabase_auth_admin.
grant usage on schema private to supabase_auth_admin;
grant execute on function private.perm_level(uuid, text), private.permission_keys(),
  private.permission_allows(text, text) to supabase_auth_admin;
grant select (active) on public.profiles to supabase_auth_admin;

create function public.app_my_permissions() returns jsonb
    language sql stable security definer set search_path to '' as $$
  select coalesce(jsonb_object_agg(k, case l when 2 then 'edit' else 'read' end), '{}'::jsonb)
    from (select k, private.perm_level(auth.uid(), k) l from private.permission_keys() k) s
   where l > 0 and private.is_active(auth.uid());
$$;
revoke all on function public.app_my_permissions() from public, anon;
grant execute on function public.app_my_permissions() to authenticated;

create or replace function public.custom_access_token_hook(event jsonb) returns jsonb
    language plpgsql stable set search_path to '' as $$
declare
  v_uid    uuid := (event->>'user_id')::uuid;
  v_active boolean;
  claims   jsonb;
  roles    jsonb;
  perms    jsonb;
  locale   text;
begin
  select p.active, p.language_pref into v_active, locale from public.profiles p where p.id = v_uid;
  v_active := coalesce(v_active, false);

  select coalesce(jsonb_agg(role order by role), '[]'::jsonb) into roles
    from public.user_roles where user_id = v_uid and role is not null and v_active;

  select coalesce(jsonb_object_agg(k, case l when 2 then 'edit' else 'read' end), '{}'::jsonb) into perms
    from (select k, private.perm_level(v_uid, k) l from private.permission_keys() k) s
   where l > 0 and v_active;

  claims := jsonb_set(coalesce(event->'claims', '{}'::jsonb), '{app_roles}', roles);
  claims := jsonb_set(claims, '{app_perms}', perms);
  -- Constrain to the locales the app routes (see the previous definition's note).
  claims := jsonb_set(claims, '{app_locale}',
    to_jsonb(case when locale in ('fa', 'en') then locale else 'fa' end));
  return jsonb_set(event, '{claims}', claims);
end;
$$;
```

- [ ] **Step 4: Write `20261007160003_roles_gates.sql`.** For each object below:
  1. Copy its **current** definition from `supabase/schema.sql`. For policies, drop and recreate.
     For functions, use `create or replace` with an identical signature.
  2. Change **only** the guard shown.
  3. Start the file with a comment that names the spec and says "only the guards change; bodies are
     copied from schema.sql at 6240e3c".

  **Broad reads** (replace `private.can_read_all((select auth.uid()))` with the helper given):

  | Object | New guard |
  |---|---|
  | policy `profiles_select` | `private.reads_people(…)` |
  | policy `user_roles_select` | `private.reads_people(…)` |
  | policy `leave_ledger_select` | `private.reads_balances(…)` |
  | policy `leave_allocations_select` | `private.reads_balances(…)` |
  | policy `employee_leave_policies_select` | `private.reads_balances(…)` |
  | view `team_leave_calendar` (`create or replace view`, same column list) | in its WHERE, `private.can_read_all(auth.uid())` → `private.reads_calendar(auth.uid())` |

  **`leave_requests` reads.** For policies `leave_requests_select` and
  `leave_request_approvals_select`, replace the literal clauses
  `private.has_role(uid,'security') or private.is_admin(uid) or private.has_role(uid,'hr')` with
  `private.has_perm((select auth.uid()), 'leave_requests', 'read')`. Keep own and
  `is_manager_of`.

  **Function guards:**

  | Function | Current guard (schema.sql line) | New guard |
  |---|---|---|
  | `private.enforce_profile_update_scope` editor branch | `has_permission(v_uid,'employees.edit')` + same company + no admin row (581–587) | `private.has_perm(v_uid,'people','edit') and private.can_act_on(v_uid, new.id)`. Same column list. `personnel_no` stays admin-only. |
  | `private.enforce_department_update_scope` | after the same-company manager check (524–531) | add D7: `if not private.is_admin(auth.uid()) and new.manager_id = auth.uid() and (tg_op = 'INSERT' or new.manager_id is distinct from old.manager_id) then raise exception 'you cannot appoint yourself department manager' using errcode = '42501'; end if;` |
  | `public.allocate_leave` | `is_admin or has_role hr` (1603) + not self (1609) | `private.is_admin(v_uid) or (private.has_perm(v_uid,'leave_balances','edit') and private.can_act_on(v_uid, p_employee_id))` |
  | `public.set_leave_balance` | 4143 / 4149 | same as above |
  | `public.set_employee_leave_policy` | 4082 / 4088 | same as above |
  | `public.accrue_employee_leave` | 1406–1408 | `private.is_manager_of(v_uid, p_employee_id) or private.has_perm(v_uid,'leave_balances','read')` |
  | `public.accrue_all_leave` | 1360 | `private.has_perm(v_uid,'leave_accrual','edit')` |
  | policies `approval_steps_insert_config` / `_update_config` / `_delete_config` | admin or hr | `private.has_perm((select auth.uid()),'approval_steps','edit')` |
  | `public.search_approver_candidates` | 4047 | `private.has_perm(auth.uid(),'approval_steps','edit')` |
  | policies `work_settings_insert_admin` / `_update_admin` / `_delete_admin` | `is_admin` | `private.has_perm((select auth.uid()),'work_settings','edit')`. Recreate under the same names. |
  | policies `holidays_insert_admin` / `_update_admin` / `_delete_admin` | `is_admin` | `private.has_perm((select auth.uid()),'holidays','edit')`. Same names. |
  | policy `employee_personal_info_select`, fn `app_export_personal_info` | `personal_info.view` | unchanged (legacy alias covers it). Rewrite to `has_perm(…,'personal_info','read')` for clarity. |
  | policy `employee_personal_info_update` USING | `personal_info.edit` + admin-target check | `employee_id = (select auth.uid()) or private.is_admin((select auth.uid())) or (private.has_perm((select auth.uid()),'personal_info','edit') and private.can_act_on((select auth.uid()), employee_id))` |
  | `public.app_import_personal_info` | 2648, 2670–2673 | per row: `private.is_admin(v_uid) or private.can_act_on(v_uid, v_target)`, keeping the `personal_info.edit` call gate as `has_perm` |
  | `private.separation_manageable` | 1058–1067 | `private.is_admin(uid) or (private.has_perm(uid,'clearance','edit') and private.can_act_on(uid, <leaver>))` |
  | `private.can_read_separation` | 373 | `has_perm(uid,'clearance','read')` in place of `separations.view` |
  | `public.app_save_separation_units`, `public.app_separation_warnings` | `separations.manage` | `private.has_perm(v_uid,'clearance','edit')` |
  | `public.app_set_employee_password` | `is_admin` (2891) | `private.is_admin(v_uid) or (private.has_perm(v_uid,'passwords','edit') and private.can_act_on(v_uid, p_user_id))`. Keep the existing `must_change_password` logic. |
  | `public.app_bulk_set_employee_passwords` | `is_admin` (2159) | the call gate: `private.is_admin(v_uid) or private.has_perm(v_uid,'passwords','edit')`. In the validation loop, for a non-admin, every target must pass `private.can_act_on`, else raise 42501 `'not allowed on <personnel no>'` before any update. |
  | `public.app_bulk_create_employees`, `public.app_bulk_import_employees` | `is_admin or has_role hr` (1649, 1854) | `private.is_admin(v_uid) or private.has_perm(v_uid,'people_create','edit')`. The non-admin branch keeps today's hr clamps (employee only, no departments). update/replace stay `is_admin` (1867). |
  | `public.cancel_leave_request` | owner or `is_admin` (3562) | owner, or `private.has_perm(v_uid,'leave_requests','edit')` |

  `app_create_employee` is rewritten in Task 3. `app_set_user_roles` is rewritten in Task 3.

- [ ] **Step 5: Dry-run both migrations in one transaction, then apply.**
  1. Dry-run: `{ echo begin; cat …160002…; cat …160003…; echo rollback; }`, the same pattern as
     Task 1.
  2. Apply with `./deploy/bj-deploy update local`, then `docker restart bj-erp-rest-1`.
  3. Run all four `tests/sql/*.sql`.
  Expected: all PASS. fr51, fr52-53 and fr54 green proves preset parity.

- [ ] **Step 6: Stop and report.**

---

### Task 3: Role editor RPCs, role assignment, admin transfer, create employee

**Files:**
- Create: `supabase/migrations/20261007160004_roles_rpcs.sql`
- Modify: `tests/sql/fr55-roles-permissions.sql` (section "rpcs")
- Modify: `supabase/schema.sql` (`npm run schema:dump`), `lib/supabase/types.ts`

**Interfaces:**
- Consumes: Task 2 helpers.
- Produces:
  - `public.app_list_roles() returns table(id uuid, system_key text, kind text, name text, holders int, permissions jsonb)`.
  - `public.app_role_holders(p_role_id uuid) returns table(user_id uuid, full_name text, personnel_no text)`.
  - `public.app_save_role(p_id uuid, p_name text, p_permissions jsonb) returns uuid`.
  - `public.app_delete_role(p_id uuid) returns table(full_name text, personnel_no text)`.
  - `public.app_set_user_role_ids(p_user_id uuid, p_role_ids uuid[]) returns void`.
  - `public.app_transfer_admin(p_target uuid, p_personnel_no text, p_password text) returns void`.
  - `public.app_create_employee(…, p_role_ids uuid[] default null)`.

  **Naming deviation from the spec:** the new assignment RPC is named `app_set_user_role_ids`.
  Overloading `app_set_user_roles` with a `uuid[]` argument breaks PostgREST's name-based
  resolution, because both overloads take `(p_user_id, p_roles)`-style named args. Task 13 updates
  the spec's wording.

- [ ] **Step 1: Add the failing scenarios** above `rollback;`:

```sql
-- ── rpcs (Task 3) ───────────────────────────────────────────────────────────
select pg_temp.expect('admin creates a role',
  pg_temp.try_as('admin', $q$select public.app_save_role(null, 'Clerk', '{"people":"read","holidays":"edit"}')$q$), 'ok:1');
select pg_temp.expect('Everything may not create a role (D2)',
  pg_temp.try_as('super', $q$select public.app_save_role(null, 'Clerk2', '{}')$q$), '42501');
select pg_temp.expect('dependency rule: reports without people refused',
  pg_temp.try_as('admin', $q$select public.app_save_role(null, 'Bad', '{"reports":"read"}')$q$), '22023');
select pg_temp.expect('unknown key refused',
  pg_temp.try_as('admin', $q$select public.app_save_role(null, 'Bad', '{"nope":"edit"}')$q$), '22023');
select pg_temp.expect('invalid level refused',
  pg_temp.try_as('admin', $q$select public.app_save_role(null, 'Bad', '{"calendar":"edit"}')$q$), '22023');
select pg_temp.expect('non-latin name refused',
  pg_temp.try_as('admin', $q$select public.app_save_role(null, 'منشی', '{}')$q$), '22023');
select pg_temp.expect('duplicate name (case-insensitive) refused',
  pg_temp.try_as('admin', $q$select public.app_save_role(null, 'helpdesk', '{}')$q$), '22023');
select pg_temp.expect('preset rename ignored, permissions saved',
  pg_temp.try_as('admin', format($q$select public.app_save_role(%s, 'Renamed', '{"people":"read","calendar":"read"}')$q$,
    quote_literal((select id from public.roles where company_id=(select id from fx where k='company') and system_key='security')))), 'ok:1');
select pg_temp.expect('security preset kept its name',
  (select name from public.roles where company_id=(select id from fx where k='company') and system_key='security'), 'Security');
select pg_temp.expect('system role not editable',
  pg_temp.try_as('admin', format($q$select public.app_save_role(%s, 'Manager', '{}')$q$,
    quote_literal((select id from public.roles where company_id=(select id from fx where k='company') and system_key='manager')))), '22023');
-- assignment (D5)
select pg_temp.expect('hr gives manager',
  pg_temp.try_as('hr', format('select public.app_set_user_role_ids(%s, array[%s, %s]::uuid[])', pg_temp.id('emp2'),
    quote_literal((select id from public.roles where company_id=(select id from fx where k='company') and system_key='employee')),
    quote_literal((select id from public.roles where company_id=(select id from fx where k='company') and system_key='manager')))), 'ok:1');
select pg_temp.expect('hr may not give Helpdesk (outside hr)',
  pg_temp.try_as('hr', format('select public.app_set_user_role_ids(%s, array[%s, %s]::uuid[])', pg_temp.id('emp'),
    quote_literal((select id from public.roles where company_id=(select id from fx where k='company') and system_key='employee')),
    pg_temp.id('r_help'))), '42501');
select pg_temp.expect('nobody gives admin through assignment, not even the admin',
  pg_temp.try_as('admin', format('select public.app_set_user_role_ids(%s, array[%s]::uuid[])', pg_temp.id('emp'),
    quote_literal((select id from public.roles where company_id=(select id from fx where k='company') and system_key='admin')))), '42501');
select pg_temp.expect('old enum signature cannot add admin',
  pg_temp.try_as('admin', format($q$select public.app_set_user_roles(%s, array['employee','admin']::public.app_role[])$q$, pg_temp.id('emp'))), '42501');
select pg_temp.expect('old enum signature keeps custom roles',
  (select (pg_temp.try_as('admin', format($q$select public.app_set_user_roles(%s, array['employee']::public.app_role[])$q$, pg_temp.id('help')))
           || ':' || exists (select 1 from public.user_roles where user_id=(select id from fx where k='help') and role_id=(select id from fx where k='r_help'))::text)), 'ok:1:true');
-- create employee
select pg_temp.expect('helpdesk may not create employees',
  pg_temp.try_as('help', $q$select public.app_create_employee('9990000970','x','Temp!2026x',(select id from fx where k='company'))$q$), '42501');
select pg_temp.expect('create with admin role refused',
  pg_temp.try_as('admin', format($q$select public.app_create_employee('9990000971','x','Temp!2026x',%s, p_role_ids => array[%s]::uuid[])$q$,
    pg_temp.id('company'), quote_literal((select id from public.roles where company_id=(select id from fx where k='company') and system_key='admin')))), '42501');
-- delete
select pg_temp.expect('delete returns holders',
  pg_temp.try_as('admin', format('select * from public.app_delete_role(%s)', pg_temp.id('r_help'))), 'ok:1');
select pg_temp.expect('presets cannot be deleted',
  pg_temp.try_as('admin', format('select * from public.app_delete_role(%s)',
    quote_literal((select id from public.roles where company_id=(select id from fx where k='company') and system_key='hr')))), '22023');
-- transfer (D1). Must be the LAST section: it moves the real admin's role row
-- onto a fixture admin whose password the test knows (all rolled back).
do $$
declare v_company uuid := (select id from fx where k = 'company');
begin
  insert into fx values ('adm_t', gen_random_uuid());
  insert into auth.users (id, email, encrypted_password)
    values ((select id from fx where k='adm_t'), '9990000961@fixture.invalid', extensions.crypt('Fixture!2026', extensions.gen_salt('bf')));
  insert into public.profiles (id, company_id, employee_code, full_name, active, personnel_no, must_change_password)
    values ((select id from fx where k='adm_t'), v_company, '9990000961', 'FR55 adm_t', true, '9990000961', false);
  insert into public.user_roles (user_id, role) values ((select id from fx where k='adm_t'), 'employee');
  update public.user_roles set user_id = (select id from fx where k='adm_t') where role = 'admin';
end $$;
select pg_temp.expect('transfer: non-admin refused',
  pg_temp.try_as('super', format('select public.app_transfer_admin(%s, %L, %L)', pg_temp.id('emp2'), '9990000955', 'Fixture!2026')), '42501');
select pg_temp.expect('transfer: wrong password',
  pg_temp.try_as('adm_t', format('select public.app_transfer_admin(%s, %L, %L)', pg_temp.id('emp2'), '9990000955', 'wrong')), '42501');
select pg_temp.expect('transfer: wrong personnel number',
  pg_temp.try_as('adm_t', format('select public.app_transfer_admin(%s, %L, %L)', pg_temp.id('emp2'), '9990000954', 'Fixture!2026')), '22023');
select pg_temp.expect('transfer: inactive target',
  pg_temp.try_as('adm_t', format('select public.app_transfer_admin(%s, %L, %L)', pg_temp.id('hr_off'), '9990000952', 'Fixture!2026')), '22023');
select pg_temp.expect('transfer: to yourself',
  pg_temp.try_as('adm_t', format('select public.app_transfer_admin(%s, %L, %L)', pg_temp.id('adm_t'), '9990000961', 'Fixture!2026')), '22023');
select pg_temp.expect('transfer: success',
  pg_temp.try_as('adm_t', format('select public.app_transfer_admin(%s, %L, %L)', pg_temp.id('emp2'), '9990000955', 'Fixture!2026')), 'ok:1');
select pg_temp.expect('after transfer: exactly one admin, held by emp2',
  (select count(*)::text || ':' || bool_and(user_id = (select id from fx where k='emp2'))::text
     from public.user_roles where role = 'admin'), '1:true');
select pg_temp.expect('after transfer: old admin keeps employee',
  (select exists (select 1 from public.user_roles where user_id=(select id from fx where k='adm_t') and role='employee')::text), 'true');
select pg_temp.expect('after transfer: old admin refused at once (stale token irrelevant)',
  pg_temp.try_as('adm_t', $q$select public.app_save_role(null, 'Late', '{}')$q$), '42501');
```

  No index drop is needed: the `update` moves the single admin row, so the index still holds.

- [ ] **Step 2: Run it.** Expected: `function public.app_save_role … does not exist`.

- [ ] **Step 3: Write `20261007160004_roles_rpcs.sql`:**

```sql
-- FR-55 (4/4): role editor RPCs, role assignment by id, admin transfer, create
-- employee with role ids. D1, D2, D5, D6, D11, D12.

create function private.caller_company() returns uuid
    language sql stable security definer set search_path to '' as $$
  select company_id from public.profiles where id = auth.uid() and active;
$$;
revoke all on function private.caller_company() from public, anon;
grant execute on function private.caller_company() to authenticated;

create function public.app_list_roles()
returns table (id uuid, system_key text, kind text, name text, holders int, permissions jsonb)
    language sql stable security definer set search_path to '' as $$
  select r.id, r.system_key::text, r.kind, r.name,
         (select count(*)::int from public.user_roles ur join public.profiles p on p.id = ur.user_id
           where ur.role_id = r.id and p.active),
         coalesce((select jsonb_object_agg(rp.permission, rp.level) from public.role_permissions rp
                    where rp.role_id = r.id), '{}'::jsonb)
    from public.roles r
   where r.company_id = private.caller_company()
   order by case r.kind when 'system' then 0 when 'preset' then 1 else 2 end,
            array_position(array['admin','manager','employee','hr','security','finance'], r.system_key::text),
            lower(r.name);
$$;

create function public.app_role_holders(p_role_id uuid)
returns table (user_id uuid, full_name text, personnel_no text)
    language plpgsql stable security definer set search_path to '' as $$
begin
  if not private.is_admin(auth.uid()) then
    raise exception 'only the admin can list role holders' using errcode = '42501';
  end if;
  return query
    select p.id, p.full_name, p.personnel_no
      from public.user_roles ur join public.profiles p on p.id = ur.user_id
      join public.roles r on r.id = ur.role_id
     where ur.role_id = p_role_id and r.company_id = private.caller_company()
     order by p.personnel_no;
end $$;

create function public.app_save_role(p_id uuid, p_name text, p_permissions jsonb)
returns uuid
    language plpgsql security definer set search_path to '' as $$
declare
  v_uid     uuid := auth.uid();
  v_company uuid := private.caller_company();
  v_kind    text;
  v_before  jsonb;
  v_id      uuid := p_id;
  v_name    text := btrim(coalesce(p_name, ''));
  kv        record;
  d         record;
begin
  if not private.is_admin(v_uid) then
    raise exception 'only the admin can edit roles' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_permissions, '{}'::jsonb)) <> 'object' then
    raise exception 'permissions must be an object' using errcode = '22023';
  end if;
  for kv in select key, value #>> '{}' as level from jsonb_each(coalesce(p_permissions, '{}'::jsonb)) loop
    if not private.permission_allows(kv.key, kv.level) then
      raise exception 'invalid permission % = %', kv.key, kv.level using errcode = '22023';
    end if;
  end loop;
  for d in select * from private.permission_deps() loop
    if p_permissions ? d.key
       and (d.key_level = 'read' or p_permissions->>d.key = 'edit')
       and not p_permissions ? d.needs then
      raise exception '% needs %', d.key, d.needs using errcode = '22023';
    end if;
  end loop;

  if v_id is null then
    if v_name !~ '^[A-Za-z0-9][A-Za-z0-9 &/-]{0,39}$' then
      raise exception 'invalid role name' using errcode = '22023';
    end if;
    if exists (select 1 from public.roles where company_id = v_company and lower(name) = lower(v_name)) then
      raise exception 'role name already used' using errcode = '22023';
    end if;
    insert into public.roles (company_id, kind, name) values (v_company, 'custom', v_name)
      returning id into v_id;
    v_before := null;
  else
    select kind into v_kind from public.roles where id = v_id and company_id = v_company for update;
    if v_kind is null then raise exception 'role not found' using errcode = '22023'; end if;
    if v_kind = 'system' then raise exception 'built-in role cannot be edited' using errcode = '22023'; end if;
    if v_kind = 'custom' then
      if v_name !~ '^[A-Za-z0-9][A-Za-z0-9 &/-]{0,39}$' then
        raise exception 'invalid role name' using errcode = '22023';
      end if;
      if exists (select 1 from public.roles where company_id = v_company and lower(name) = lower(v_name) and id <> v_id) then
        raise exception 'role name already used' using errcode = '22023';
      end if;
      update public.roles set name = v_name, updated_at = now() where id = v_id;
    else
      update public.roles set updated_at = now() where id = v_id;
    end if;
    select coalesce(jsonb_object_agg(permission, level), '{}'::jsonb) into v_before
      from public.role_permissions where role_id = v_id;
    delete from public.role_permissions where role_id = v_id;
  end if;

  insert into public.role_permissions (role_id, permission, level)
    select v_id, key, value #>> '{}' from jsonb_each(coalesce(p_permissions, '{}'::jsonb));

  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (v_uid, case when v_before is null then 'role.create' else 'role.update' end, 'roles', v_id,
          v_before, jsonb_build_object('name', (select name from public.roles where id = v_id),
                                       'permissions', coalesce(p_permissions, '{}'::jsonb)));
  return v_id;
end $$;

create function public.app_delete_role(p_id uuid)
returns table (full_name text, personnel_no text)
    language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := auth.uid();
  v_kind text;
  v_holders jsonb;
begin
  if not private.is_admin(v_uid) then
    raise exception 'only the admin can delete roles' using errcode = '42501';
  end if;
  select kind into v_kind from public.roles where id = p_id and company_id = private.caller_company() for update;
  if v_kind is null then raise exception 'role not found' using errcode = '22023'; end if;
  if v_kind <> 'custom' then raise exception 'built-in roles cannot be deleted' using errcode = '22023'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('full_name', p.full_name, 'personnel_no', p.personnel_no)
                            order by p.personnel_no), '[]'::jsonb)
    into v_holders
    from public.user_roles ur join public.profiles p on p.id = ur.user_id where ur.role_id = p_id;

  delete from public.user_roles where role_id = p_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (v_uid, 'role.delete', 'roles', p_id,
          jsonb_build_object('name', (select name from public.roles where id = p_id), 'holders', v_holders), null);
  delete from public.roles where id = p_id;

  return query select h->>'full_name', h->>'personnel_no' from jsonb_array_elements(v_holders) h;
end $$;

create function public.app_set_user_role_ids(p_user_id uuid, p_role_ids uuid[])
returns void
    language plpgsql security definer set search_path to '' as $$
declare
  v_uid      uuid := auth.uid();
  v_company  uuid := private.caller_company();
  v_admin_id uuid;
  v_before   uuid[];
  v_after    uuid[] := coalesce(p_role_ids, '{}');
  v_changed  uuid;
begin
  if not exists (select 1 from public.profiles where id = p_user_id and company_id = v_company) then
    raise exception 'employee not found' using errcode = '42501';
  end if;
  if exists (select 1 from unnest(v_after) x left join public.roles r on r.id = x
              where r.id is null or r.company_id <> v_company) then
    raise exception 'unknown role' using errcode = '22023';
  end if;
  select id into v_admin_id from public.roles where company_id = v_company and system_key = 'admin';
  select coalesce(array_agg(role_id order by role_id), '{}') into v_before
    from public.user_roles where user_id = p_user_id;

  -- D1: admin moves only by transfer, for everyone, the admin included.
  if (v_admin_id = any (v_before)) <> (v_admin_id = any (v_after)) then
    raise exception 'admin is moved only by Transfer admin' using errcode = '42501';
  end if;

  if not private.is_admin(v_uid) then
    if not private.can_act_on(v_uid, p_user_id) then
      raise exception 'not allowed on this employee' using errcode = '42501';
    end if;
    for v_changed in
      (select x from unnest(v_before) x except select x from unnest(v_after) x)
      union
      (select x from unnest(v_after) x except select x from unnest(v_before) x)
    loop
      if not private.role_within(v_changed, v_uid) then
        raise exception 'not allowed to give or remove role %', (select name from public.roles where id = v_changed)
          using errcode = '42501';
      end if;
    end loop;
  end if;

  delete from public.user_roles where user_id = p_user_id and role_id <> all (v_after);
  insert into public.user_roles (user_id, role_id)
    select p_user_id, x from unnest(v_after) x on conflict (user_id, role_id) do nothing;

  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (v_uid, 'set_roles', 'user_roles', p_user_id,
    jsonb_build_object('roles', (select coalesce(jsonb_agg(name order by name), '[]') from public.roles where id = any (v_before))),
    jsonb_build_object('roles', (select coalesce(jsonb_agg(name order by name), '[]') from public.roles where id = any (v_after))));
end $$;

-- Old signature, kept for the deploy window: built-in rows only, custom rows kept.
create or replace function public.app_set_user_roles(p_user_id uuid, p_roles public.app_role[])
returns void
    language plpgsql security definer set search_path to '' as $$
declare
  v_ids uuid[];
begin
  select coalesce(array_agg(r.id), '{}') into v_ids
    from public.roles r join public.profiles p on p.company_id = r.company_id and p.id = p_user_id
   where r.system_key = any (coalesce(p_roles, '{}'));
  select v_ids || coalesce(array_agg(ur.role_id), '{}') into v_ids
    from public.user_roles ur where ur.user_id = p_user_id and ur.role is null;
  perform public.app_set_user_role_ids(p_user_id, v_ids);
end $$;

create function public.app_transfer_admin(p_target uuid, p_personnel_no text, p_password text)
returns void
    language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if not private.is_admin(v_uid) then
    raise exception 'only the admin can transfer admin' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users
                  where id = v_uid
                    and encrypted_password = extensions.crypt(coalesce(p_password, ''), encrypted_password)) then
    raise exception 'wrong password' using errcode = '42501';
  end if;
  if p_target = v_uid then
    raise exception 'you already hold admin' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles t join public.profiles c on c.id = v_uid and c.company_id = t.company_id
                  where t.id = p_target and t.active and t.personnel_no = btrim(coalesce(p_personnel_no, ''))) then
    raise exception 'personnel number does not match an active employee' using errcode = '22023';
  end if;

  delete from public.user_roles where user_id = v_uid and role = 'admin';
  insert into public.user_roles (user_id, role) values (p_target, 'admin');
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (v_uid, 'admin.transfer', 'user_roles', p_target,
          jsonb_build_object('admin', v_uid), jsonb_build_object('admin', p_target));
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.app_list_roles()', 'public.app_role_holders(uuid)',
    'public.app_save_role(uuid, text, jsonb)', 'public.app_delete_role(uuid)',
    'public.app_set_user_role_ids(uuid, uuid[])', 'public.app_set_user_roles(uuid, public.app_role[])',
    'public.app_transfer_admin(uuid, text, text)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
```

  **Then `app_create_employee`.** Copy its current definition from `supabase/schema.sql` (line
  2362). Then, in this order:
  1. `drop function public.app_create_employee(text, text, text, uuid, uuid, uuid, public.app_role[], date, text, text, text);`
  2. Recreate it with the same parameters plus a trailing `p_role_ids uuid[] default null`.
  3. Change the guard block:
     - `v_hr := private.has_role(v_caller,'hr')` becomes
       `v_hr := private.has_perm(v_caller,'people_create','edit')`.
     - In **every** branch, refuse `admin`:
       `if 'admin' = any (v_roles) then raise exception 'admin is moved only by Transfer admin' using errcode='42501'; end if;`
     - When `p_role_ids` is not null, it decides the extra roles after the profile insert. Call
       `perform public.app_set_user_role_ids(v_uid, p_role_ids || <employee role id>);`, which
       applies D5 for non-admins. Do this **before** the audit insert.
  4. Re-grant: execute to `authenticated`, revoke from `anon`.

  The old app calls the function without `p_role_ids`. Named-argument resolution still matches.

- [ ] **Step 4: Dry-run, apply, run all four SQL files.** Expected: all PASS.

- [ ] **Step 5: Regenerate the schema and types.**
  1. Run `npm run schema:dump`.
  2. In `lib/supabase/types.ts`, hand-add the `roles` and `role_permissions` tables (Row, Insert,
     Update), `user_roles.role_id: string` with `role` now `… | null`, and Functions entries for
     the seven RPCs plus `app_create_employee.Args.p_role_ids?: string[]`.
  3. Run `npx tsc --noEmit`. Expected: clean.

  `role: … | null` causes type errors at TS readers of `user_roles.role`. Fix each with
  `.filter((r): r is AppRole => r != null)` or a `role is not null` filter in the query.

- [ ] **Step 6: Stop and report.**

---

### Task 4: Pure permission catalog (TS)

**Files:**
- Create: `lib/permissions/catalog.ts`
- Test: `tests/unit/permissions-catalog.test.ts`

**Interfaces:**
- Produces (exact):

```ts
export type Level = 'read' | 'edit';
export type PermKey =
  | 'people' | 'people_create' | 'passwords' | 'role_manager' | 'role_assign'
  | 'personal_info' | 'clearance' | 'departments' | 'leave_balances' | 'leave_accrual'
  | 'leave_requests' | 'calendar' | 'reports' | 'approval_steps' | 'work_settings' | 'holidays';
export type Shape = 'RE' | 'E' | 'R';
export type Perms = Partial<Record<PermKey, Level>>;
export type SectionKey = 'employees' | 'departments' | 'leave' | 'approvalChain' | 'settings';
export type SectionChoice = 'custom' | 'allow' | 'read' | 'none';
export const SECTIONS: { key: SectionKey; items: PermKey[] }[];
export const SHAPES: Record<PermKey, Shape>;
export const DEPENDENCIES: { key: PermKey; keyLevel: Level; needs: PermKey }[];
export const ALL_KEYS: PermKey[];
export function levelValue(l: Level | undefined): 0 | 1 | 2;
export function allows(key: PermKey, level: Level): boolean;
export function applyLevel(perms: Perms, key: PermKey, level: Level | null): { perms: Perms; raised: PermKey[] };
export function sectionSummary(perms: Perms, section: SectionKey): SectionChoice;
export function applySectionBulk(perms: Perms, section: SectionKey, choice: Exclude<SectionChoice, 'custom'>): { perms: Perms; raised: PermKey[] };
export function isWithin(rolePerms: Perms, callerPerms: Perms): boolean;
export function fullPerms(): Perms; // admin: every key at its highest level
```

- [ ] **Step 1: Write the failing test.**

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ALL_KEYS, DEPENDENCIES, SHAPES, allows, applyLevel, applySectionBulk, fullPerms, isWithin,
  sectionSummary,
} from '@/lib/permissions/catalog';

describe('catalog matches SQL', () => {
  const sql = readFileSync('supabase/migrations/20261007160001_roles_tables.sql', 'utf8');
  it('every key is in permission_keys()', () => {
    const block = sql.slice(sql.indexOf('permission_keys()'), sql.indexOf('permission_allows('));
    for (const k of ALL_KEYS) expect(block).toContain(`'${k}'`);
    expect(ALL_KEYS).toHaveLength(16);
  });
  it('dependency rows match permission_deps()', () => {
    for (const d of DEPENDENCIES) expect(sql).toContain(`('${d.key}','${d.keyLevel}','${d.needs}')`);
  });
});

describe('shapes', () => {
  it('action items have no read level, read items no edit level', () => {
    expect(allows('passwords', 'read')).toBe(false);
    expect(allows('passwords', 'edit')).toBe(true);
    expect(allows('calendar', 'edit')).toBe(false);
    expect(SHAPES.people).toBe('RE');
  });
});

describe('applyLevel', () => {
  it('raises dependencies to read and reports them', () => {
    const r = applyLevel({}, 'reports', 'read');
    expect(r.perms).toEqual({ reports: 'read', people: 'read', leave_balances: 'read', leave_requests: 'read' });
    expect(r.raised.sort()).toEqual(['leave_balances', 'leave_requests', 'people']);
  });
  it('does not lower an existing higher level', () => {
    expect(applyLevel({ people: 'edit' }, 'passwords', 'edit').perms.people).toBe('edit');
  });
  it('clearance read needs nothing; edit needs people', () => {
    expect(applyLevel({}, 'clearance', 'read').raised).toEqual([]);
    expect(applyLevel({}, 'clearance', 'edit').raised).toEqual(['people']);
  });
  it('chains: accrual raises departments which raises people', () => {
    expect(applyLevel({}, 'leave_accrual', 'edit').raised.sort()).toEqual(['departments', 'people']);
  });
  it('null removes the item only', () => {
    expect(applyLevel({ people: 'read', passwords: 'edit' }, 'passwords', null).perms).toEqual({ people: 'read' });
  });
  it('refuses a level the shape forbids', () => {
    expect(() => applyLevel({}, 'calendar', 'edit')).toThrow();
  });
});

describe('sections', () => {
  it('summary is custom when mixed', () => {
    expect(sectionSummary({ people: 'edit' }, 'employees')).toBe('custom');
    expect(sectionSummary({}, 'employees')).toBe('none');
  });
  it('allow-all sets each item to its highest level', () => {
    const r = applySectionBulk({}, 'leave', 'allow');
    expect(r.perms).toMatchObject({ leave_balances: 'edit', leave_accrual: 'edit', leave_requests: 'edit', calendar: 'read', reports: 'read' });
    expect(sectionSummary(r.perms, 'leave')).toBe('allow');
  });
  it('read-only-all leaves action items off', () => {
    const r = applySectionBulk({}, 'employees', 'read');
    expect(r.perms.people).toBe('read');
    expect(r.perms.passwords).toBeUndefined();
    expect(sectionSummary(r.perms, 'employees')).toBe('read');
  });
  it('none clears the section, keeping others', () => {
    expect(applySectionBulk({ people: 'edit', holidays: 'edit' }, 'employees', 'none').perms).toEqual({ holidays: 'edit' });
  });
});

describe('isWithin / fullPerms', () => {
  it('compares levels per key', () => {
    expect(isWithin({ people: 'read' }, { people: 'edit' })).toBe(true);
    expect(isWithin({ people: 'edit' }, { people: 'read' })).toBe(false);
    expect(isWithin({ passwords: 'edit' }, {})).toBe(false);
  });
  it('fullPerms covers every key at its highest level', () => {
    const f = fullPerms();
    expect(Object.keys(f)).toHaveLength(16);
    expect(f.calendar).toBe('read');
    expect(f.people).toBe('edit');
  });
});
```

- [ ] **Step 2: Run it.** Run: `npx vitest run tests/unit/permissions-catalog.test.ts`.
  Expected: FAIL, "Cannot find module".

- [ ] **Step 3: Implement `lib/permissions/catalog.ts`:**

```ts
/**
 * FR-55 permission catalog — the TS mirror of private.permission_keys /
 * permission_allows / permission_deps (migration 20261007160001). Pure. Drives
 * the role editor, the nav and the edit capabilities. The database is the
 * authority; tests/unit/permissions-catalog.test.ts keeps the two in step.
 */

export type Level = 'read' | 'edit';
export type PermKey =
  | 'people' | 'people_create' | 'passwords' | 'role_manager' | 'role_assign'
  | 'personal_info' | 'clearance' | 'departments' | 'leave_balances' | 'leave_accrual'
  | 'leave_requests' | 'calendar' | 'reports' | 'approval_steps' | 'work_settings' | 'holidays';
/** RE: read and edit · E: action only · R: read only. */
export type Shape = 'RE' | 'E' | 'R';
export type Perms = Partial<Record<PermKey, Level>>;
export type SectionKey = 'employees' | 'departments' | 'leave' | 'approvalChain' | 'settings';
export type SectionChoice = 'custom' | 'allow' | 'read' | 'none';

export const SECTIONS: { key: SectionKey; items: PermKey[] }[] = [
  { key: 'employees', items: ['people', 'people_create', 'passwords', 'role_manager', 'role_assign', 'personal_info', 'clearance'] },
  { key: 'departments', items: ['departments'] },
  { key: 'leave', items: ['leave_balances', 'leave_accrual', 'leave_requests', 'calendar', 'reports'] },
  { key: 'approvalChain', items: ['approval_steps'] },
  { key: 'settings', items: ['work_settings', 'holidays'] },
];

export const SHAPES: Record<PermKey, Shape> = {
  people: 'RE', people_create: 'E', passwords: 'E', role_manager: 'E', role_assign: 'E',
  personal_info: 'RE', clearance: 'RE', departments: 'RE', leave_balances: 'RE',
  leave_accrual: 'E', leave_requests: 'RE', calendar: 'R', reports: 'R',
  approval_steps: 'RE', work_settings: 'RE', holidays: 'RE',
};

export const ALL_KEYS = SECTIONS.flatMap((s) => s.items);

/** D6. `keyLevel` 'read' = applies at any level; 'edit' = only when the key is edit. */
export const DEPENDENCIES: { key: PermKey; keyLevel: Level; needs: PermKey }[] = [
  { key: 'people_create', keyLevel: 'read', needs: 'people' },
  { key: 'passwords', keyLevel: 'read', needs: 'people' },
  { key: 'role_manager', keyLevel: 'read', needs: 'people' },
  { key: 'role_assign', keyLevel: 'read', needs: 'people' },
  { key: 'personal_info', keyLevel: 'read', needs: 'people' },
  { key: 'clearance', keyLevel: 'edit', needs: 'people' },
  { key: 'departments', keyLevel: 'read', needs: 'people' },
  { key: 'leave_balances', keyLevel: 'read', needs: 'people' },
  { key: 'leave_accrual', keyLevel: 'read', needs: 'departments' },
  { key: 'leave_requests', keyLevel: 'read', needs: 'people' },
  { key: 'approval_steps', keyLevel: 'read', needs: 'people' },
  { key: 'reports', keyLevel: 'read', needs: 'people' },
  { key: 'reports', keyLevel: 'read', needs: 'leave_balances' },
  { key: 'reports', keyLevel: 'read', needs: 'leave_requests' },
];

export function levelValue(l: Level | undefined): 0 | 1 | 2 {
  return l === 'edit' ? 2 : l === 'read' ? 1 : 0;
}

export function allows(key: PermKey, level: Level): boolean {
  const s = SHAPES[key];
  return s === 'RE' || (s === 'E' ? level === 'edit' : level === 'read');
}

const highest = (key: PermKey): Level => (SHAPES[key] === 'R' ? 'read' : 'edit');

/** Set one item (null = Not allowed) and raise what it needs, transitively. */
export function applyLevel(perms: Perms, key: PermKey, level: Level | null): { perms: Perms; raised: PermKey[] } {
  if (level && !allows(key, level)) throw new Error(`${key} has no ${level} level`);
  const next: Perms = { ...perms };
  if (level) next[key] = level;
  else delete next[key];
  const raised: PermKey[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const d of DEPENDENCIES) {
      const kl = next[d.key];
      if (!kl || levelValue(kl) < levelValue(d.keyLevel)) continue;
      if (levelValue(next[d.needs]) >= 1) continue;
      next[d.needs] = 'read';
      raised.push(d.needs);
      changed = true;
    }
  }
  return { perms: next, raised };
}

export function sectionSummary(perms: Perms, section: SectionKey): SectionChoice {
  const items = SECTIONS.find((s) => s.key === section)!.items;
  if (items.every((k) => !perms[k])) return 'none';
  if (items.every((k) => perms[k] === highest(k))) return 'allow';
  if (items.every((k) => (SHAPES[k] === 'E' ? !perms[k] : perms[k] === 'read'))) return 'read';
  return 'custom';
}

export function applySectionBulk(
  perms: Perms,
  section: SectionKey,
  choice: Exclude<SectionChoice, 'custom'>
): { perms: Perms; raised: PermKey[] } {
  const items = SECTIONS.find((s) => s.key === section)!.items;
  let acc: Perms = { ...perms };
  const raised: PermKey[] = [];
  for (const k of items) {
    const level: Level | null =
      choice === 'none' ? null : choice === 'allow' ? highest(k) : SHAPES[k] === 'E' ? null : 'read';
    const r = applyLevel(acc, k, level);
    acc = r.perms;
    raised.push(...r.raised.filter((x) => !items.includes(x)));
  }
  return { perms: acc, raised };
}

/** D5 mirror: every level in `rolePerms` ≤ the caller's. */
export function isWithin(rolePerms: Perms, callerPerms: Perms): boolean {
  return (Object.keys(rolePerms) as PermKey[]).every(
    (k) => levelValue(rolePerms[k]) <= levelValue(callerPerms[k])
  );
}

export function fullPerms(): Perms {
  return Object.fromEntries(ALL_KEYS.map((k) => [k, highest(k)])) as Perms;
}
```

- [ ] **Step 4: Run the test.** Expected: all PASS.
- [ ] **Step 5: Stop and report.**

---

### Task 5: Server permission plumbing

**Files:**
- Create: `lib/auth/permissions.ts`
- Modify: `lib/auth/context.ts`
- Test: `tests/unit/permissions-can.test.ts`

**Interfaces:**
- Consumes: `Perms`, `PermKey`, `Level`, `levelValue`, `fullPerms` from Task 4.
- Produces:
  - `can(perms: Perms, key: PermKey, level?: Level): boolean`, in `lib/permissions/catalog.ts` so
    client components can use it.
  - `parsePermsClaim(raw: unknown): Perms | null`, in the same file.
  - `getCachedPermissions(userId: string): Promise<Perms>` (server, `lib/auth/permissions.ts`).
  - `requireCaller({ perm: [PermKey, Level] })`. On success `Caller` also carries `perms: Perms`.

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, expect, it } from 'vitest';
import { can, parsePermsClaim } from '@/lib/permissions/catalog';

describe('can', () => {
  it('edit implies read; absence is none', () => {
    expect(can({ people: 'edit' }, 'people', 'read')).toBe(true);
    expect(can({ people: 'read' }, 'people', 'edit')).toBe(false);
    expect(can({}, 'calendar', 'read')).toBe(false);
    expect(can({ passwords: 'edit' }, 'passwords')).toBe(true); // default level = edit
  });
});

describe('parsePermsClaim', () => {
  it('keeps known keys with valid levels only', () => {
    expect(parsePermsClaim({ people: 'read', bogus: 'edit', calendar: 'edit', passwords: 'edit' }))
      .toEqual({ people: 'read', passwords: 'edit' });
  });
  it('null for a missing or non-object claim', () => {
    expect(parsePermsClaim(undefined)).toBeNull();
    expect(parsePermsClaim(['people'])).toBeNull();
  });
});
```

- [ ] **Step 2: Run it.** Expected: FAIL, `can` not exported.

- [ ] **Step 3: Implement.** Append to `lib/permissions/catalog.ts`:

```ts
export function can(perms: Perms, key: PermKey, level: Level = 'edit'): boolean {
  return levelValue(perms[key]) >= levelValue(level);
}

/** The `app_perms` JWT claim, sanitised: unknown keys and impossible levels dropped. */
export function parsePermsClaim(raw: unknown): Perms | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Perms = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if ((ALL_KEYS as string[]).includes(k) && (v === 'read' || v === 'edit') && allows(k as PermKey, v)) {
      out[k as PermKey] = v;
    }
  }
  return out;
}
```

  Create `lib/auth/permissions.ts`:

```ts
/**
 * FR-55: the caller's permissions, from the `app_perms` JWT claim (token hook,
 * migration 20261007160002) or, for a token issued before it, one
 * `app_my_permissions()` call. Same ≤1h staleness as roles; RLS enforces live.
 * Server-only.
 */
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { parsePermsClaim, type Perms } from '@/lib/permissions/catalog';
import { getCachedClaims } from '@/lib/auth/context';

export const getCachedPermissions = cache(async (userId: string): Promise<Perms> => {
  const claims = await getCachedClaims();
  const fromClaim = claims?.sub === userId ? parsePermsClaim(claims.app_perms) : null;
  if (fromClaim) return fromClaim;
  const supabase = await createClient();
  const { data } = await supabase.rpc('app_my_permissions');
  return parsePermsClaim(data) ?? {};
});
```

  In `lib/auth/context.ts`, make these changes:
  1. Export `getCachedClaims`: change `const getCachedClaims` to `export const getCachedClaims`.
  2. Add `perms: Perms` to `Caller`.
  3. Add `perm?: [PermKey, Level]` to `CallerOptions`.
  4. In `requireCaller`, load perms in the existing `Promise.all`:

```ts
  const [roles, perms, profile] = await Promise.all([
    getCachedRoles(user.id),
    getCachedPermissions(user.id),
    company ? getCachedProfile(user.id) : null,
  ]);
  if (anyOf && !anyOf.some((role) => roles.includes(role))) {
    return dbErr(`${anyOf.join(' or ')} role required`);
  }
  if (perm && !can(perms, perm[0], perm[1])) {
    return dbErr('not allowed');
  }
  if (!company) return { ok: true as const, supabase, user, roles, perms };
  if (!profile?.company_id) return dbErr('no profile for caller');
  return { ok: true as const, supabase, user, roles, perms, companyId: profile.company_id };
```

  To avoid an import cycle, **define `getCachedPermissions` in `context.ts`**, next to
  `getCachedRoles`, with the body shown above. Make `lib/auth/permissions.ts` a one-line re-export,
  `export { getCachedPermissions } from './context';`, so the spec's path still exists. With that,
  `getCachedClaims` does not need exporting.

  Also check `lib/errors/db-error.ts`: `dbErr('not allowed')` must map to a localized message. If
  no mapping exists, add `'not allowed'` to its known-message table with the fa/en strings
  «اجازه این کار را ندارید» / "You are not allowed to do this".

- [ ] **Step 4: Run the tests.** Run: `npx vitest run tests/unit/permissions-can.test.ts`, then
  `npx tsc --noEmit`. Expected: PASS, clean.
- [ ] **Step 5: Stop and report.**

---

### Task 6: Navigation and page guards follow permissions

**Files:**
- Modify: `lib/nav/tabs.ts`, `tests/unit/nav_tabs.test.ts`
- Modify: `app/[locale]/(app)/layout.tsx`, `_components/AppShell.tsx`, `_components/MainNav.tsx`,
  `_components/RoutePrefetcher.tsx`, `manage/page.tsx`, `manage/layout.tsx`
- Modify page guards:
  - `manage/departments/page.tsx`, `manage/departments/new/page.tsx`
  - `manage/requests/page.tsx`, `manage/approval-steps/page.tsx`, `manage/reports/page.tsx`
  - `manage/employees/import/page.tsx`, `manage/employees/personal-info/page.tsx`
  - `settings/page.tsx`, `manage/settings/page.tsx`

**Interfaces:**
- Consumes: `can`, `Perms` (Task 4/5), `getCachedPermissions` (Task 5).
- Produces: the nav functions take a second argument, `perms: Perms`:
  - `tabsForRoles(roles, perms)`
  - `manageItemsForRoles(roles, perms)`
  - `settingsItemForRoles(roles, perms)`

  `AppShell` and `MainNav` gain a `perms: Perms` prop.

- [ ] **Step 1: Update the nav test first.** In `tests/unit/nav_tabs.test.ts`:
  - Pass a second argument everywhere. Use `HR` for hr, `SEC` for security, `{}` otherwise.
  - Add the cases below.

```ts
import { fullPerms, type Perms } from '@/lib/permissions/catalog';
const HR: Perms = { people: 'edit', people_create: 'edit', role_manager: 'edit', personal_info: 'edit', clearance: 'edit', departments: 'edit', leave_balances: 'edit', leave_accrual: 'edit', leave_requests: 'read', calendar: 'read', reports: 'read', approval_steps: 'edit' };
const SEC: Perms = { people: 'read', leave_balances: 'read', leave_requests: 'read', calendar: 'read' };

it('hr preset: same manage items as before FR-55', () => {
  expect(manageItemsForRoles(['hr'], HR).map((i) => i.key)).toEqual(['employees', 'departments', 'approvals', 'requests', 'approvalSteps', 'reports']);
});
it('security preset now reaches employees and the archive (spec: visible difference)', () => {
  expect(manageItemsForRoles(['security'], SEC).map((i) => i.key)).toEqual(['employees', 'requests']);
  expect(tabsForRoles(['security'], SEC).map((t) => t.key)).toContain('manage');
});
it('a holidays-only clerk gets Settings and no Manage', () => {
  expect(settingsItemForRoles(['employee'], { holidays: 'edit' })).not.toBeNull();
  expect(tabsForRoles(['employee'], { holidays: 'edit' }).map((t) => t.key)).not.toContain('manage');
});
it('helpdesk (people read + passwords) gets Employees only', () => {
  expect(manageItemsForRoles(['employee'], { people: 'read', passwords: 'edit' }).map((i) => i.key)).toEqual(['employees']);
});
it('manager keeps employees + approvals with no perms', () => {
  expect(manageItemsForRoles(['manager'], {}).map((i) => i.key)).toEqual(['employees', 'approvals']);
});
it('admin sees everything', () => {
  expect(settingsItemForRoles(['admin'], fullPerms())).not.toBeNull();
});
```

  The old case "security (no manage)" now contradicts the spec. Replace it with the security case
  above.

- [ ] **Step 2: Run it.** Expected: FAIL (wrong arity, or a mismatch).

- [ ] **Step 3: Implement in `lib/nav/tabs.ts`.**
  - Replace `canManage`, `isAdminOrHr` and the per-item `allowed` with
    `allowed: (roles: string[], perms: Perms) => boolean`:
    - employees: `roles.includes('manager') || can(perms,'people','read')`
    - departments: `can(perms,'departments','read')`
    - approvals: `['admin','manager','hr'].some((r) => roles.includes(r))` (identity, unchanged)
    - requests: `can(perms,'leave_requests','read')`
    - approvalSteps: `can(perms,'approval_steps','read')`
    - reports: `can(perms,'reports','read')`
  - `canManage(roles, perms)` = `MANAGE.some((i) => i.allowed(roles, perms))`.
  - `settingsItemForRoles`: `roles.includes('admin') || can(perms,'work_settings','read') || can(perms,'holidays','read')`.
  - Update the header comment: "who is offered a link follows FR-55 permissions; identity roles
    only for approvals".

- [ ] **Step 4: Thread `perms` through.**
  - `app/[locale]/(app)/layout.tsx`: `const perms = await getCachedPermissions(user.id)` (in the
    existing `Promise.all`). Pass `perms` to `AppShell`, then to `MainNav` and `RoutePrefetcher`.
  - `manage/page.tsx`: fetch perms and pass them to the nav functions.
  - `manage/layout.tsx`: `canAccess = manageItemsForRoles(roles, perms).length > 0`.

- [ ] **Step 5: Page guards.** Replace each literal role check with the permission in this table
  (fetch `perms` via `getCachedPermissions(user.id)`):

  | Page | Admit when | Redirect (unchanged) |
  |---|---|---|
  | `manage/departments/page.tsx`, `/new/page.tsx` | `can(perms,'departments','read')`; the new page needs `'edit'` | `/manage/employees` |
  | `manage/requests/page.tsx` | `can(perms,'leave_requests','read')` | `/home` |
  | `manage/approval-steps/page.tsx` | `can(perms,'approval_steps','read')` | `/home` |
  | `manage/reports/page.tsx` | `can(perms,'reports','read')` | `/home` |
  | `manage/employees/import/page.tsx` | `can(perms,'people_create')` | `/manage/employees` |
  | `manage/employees/personal-info/page.tsx` | `can(perms,'personal_info','read')` | `/manage/employees` |
  | `settings/page.tsx` | admin or `work_settings`/`holidays` read | `/home` |
  | `manage/settings/page.tsx` (legacy) | settings admit → `/settings`; else `approval_steps` read → `/manage/approval-steps`; else `/home` | — |

  On Settings, pass `canEditWork = can(perms,'work_settings')` and
  `canEditHolidays = can(perms,'holidays')` into `WorkSettingsForm` / `HolidayEditor`. Read-only
  renders inputs `disabled` and hides the save and upload buttons. Add a boolean `readOnly` prop to
  each.

  Approval steps page: today `canEnforceOrder = isAdmin`. Change it to
  `can(perms,'work_settings')`. Pass `canEdit = can(perms,'approval_steps')`; with read only, hide
  add, remove and reorder.

- [ ] **Step 6: Run the checks.** Run: `npx vitest run tests/unit/nav_tabs.test.ts tests/unit/main-nav.test.tsx tests/unit/route-prefetcher.test.tsx`,
  then `npx tsc --noEmit`. Fix the two component tests by passing `perms` props (`fullPerms()` for
  admin fixtures, `HR` for hr).
- [ ] **Step 7: Stop and report.**

---

### Task 7: Server actions use permissions; roles actions

**Files:**
- Modify:
  - `lib/actions/employees.ts`, `lib/actions/departments.ts`, `lib/actions/settings.ts`
  - `lib/actions/personal-info.ts`, `lib/actions/clearance.ts`, `lib/actions/reports.ts`
  - `lib/actions/leave/balances.ts`, `lib/actions/leave/review.ts`, `lib/actions/leave/requests.ts`
    (cancel others)
- Modify: `lib/actions/employees-helpers.ts`, `tests/unit/employees_action.test.ts`
- Create: `lib/actions/roles.ts`, `tests/unit/roles-actions.test.ts`

**Interfaces:**
- Consumes: `requireCaller({ perm })` (Task 5), the RPCs (Task 3).
- Produces (`lib/actions/roles.ts`):

```ts
export type RoleRow = { id: string; systemKey: string | null; kind: 'system' | 'preset' | 'custom'; name: string; holders: number; permissions: Perms };
export async function listRoles(): Promise<{ ok: true; roles: RoleRow[] } | DbErrorResult>;
export async function getRoleHolders(roleId: string): Promise<{ ok: true; holders: { fullName: string; personnelNo: string }[] } | DbErrorResult>;
export async function saveRole(input: { id: string | null; name: string; permissions: Perms }): Promise<{ ok: true; id: string } | DbErrorResult>;
export async function deleteRole(roleId: string): Promise<{ ok: true; removed: { fullName: string; personnelNo: string }[] } | DbErrorResult>;
export async function transferAdmin(input: { targetId: string; personnelNo: string; password: string }): Promise<{ ok: true } | DbErrorResult>;
export function toRoleRow(raw: { id: string; system_key: string | null; kind: string; name: string; holders: number; permissions: unknown }): RoleRow; // pure, exported for tests
```

  `setRoles(id, roleIds: string[])` in `employees.ts` now calls `app_set_user_role_ids`.
  `createEmployee` sends `p_role_ids` when `input.roleIds` is set. The `CreateEmployeeInput` field
  `roles?: AppRole[]` becomes `roleIds?: string[]`.

- [ ] **Step 1: Write the failing pure tests.**

```ts
// tests/unit/roles-actions.test.ts
import { describe, expect, it } from 'vitest';
import { toRoleRow } from '@/lib/actions/roles';

describe('toRoleRow', () => {
  it('maps and sanitises permissions', () => {
    expect(toRoleRow({ id: 'r', system_key: null, kind: 'custom', name: 'Helpdesk', holders: 2,
      permissions: { people: 'read', passwords: 'edit', junk: 'edit' } }))
      .toEqual({ id: 'r', systemKey: null, kind: 'custom', name: 'Helpdesk', holders: 2,
        permissions: { people: 'read', passwords: 'edit' } });
  });
});
```

  In `tests/unit/employees_action.test.ts`, change the `allowedProfileFields` cases to the new
  signature, `allowedProfileFields(roles, perms)`:
  - admin → all 7 fields;
  - `{ people: 'edit' }` → the 5 editor fields;
  - `roles ['manager']`, `{}` → `['full_name','hire_date']`;
  - `{ people: 'read' }` → `[]`.

- [ ] **Step 2: Run them.** Expected: FAIL.

- [ ] **Step 3: Implement.**
  1. `employees-helpers.ts`: `allowedProfileFields(roles: string[], perms: Perms)`. Admin → all
     seven. `can(perms,'people')` → the five editor fields. `roles.includes('manager')` →
     `['full_name','hire_date']`. Otherwise `[]`. `updateEmployee` passes `c.perms` and returns
     `dbErr('not allowed')` when the list is empty.
  2. Gate swaps (exact):

     | Action | New gate |
     |---|---|
     | `createEmployee` | `anyOf: ['admin','manager','hr']` → `requireCaller({ company: true })` + `if (!c.roles.includes('manager') && !can(c.perms,'people_create')) return dbErr('not allowed');` |
     | `setActive`, `updateEmployee` (non-manager path) | `perm: ['people','edit']` (manager keeps the `anyOf` path in `updateEmployee`) |
     | `setRoles` | `requireCaller()`; SQL decides |
     | `resetPassword`, `bulkResetPasswords` | `perm: ['passwords','edit']` |
     | `importEmployees` | `perm: ['people_create','edit']` + `if (mode !== 'add' && !c.roles.includes('admin')) return dbErr('admin role required');` |
     | `createDepartment`, `setDepartmentManager`, `renameDepartment` | `perm: ['departments','edit']` |
     | `getDepartmentMembers` | `perm: ['departments','read']` |
     | `updateWorkSettings`, `setApprovalOrderEnforced` | `perm: ['work_settings','edit']` |
     | `upsertHoliday`, `bulkUpsertHolidays`, `deleteHoliday` | `perm: ['holidays','edit']` |
     | `updateApprovalStep`, `createApprovalStep`, `deleteApprovalStep`, `searchApproverCandidates` | `perm: ['approval_steps','edit']` |
     | `exportPersonalInfo`, `getImportablePersonnelNos` | `perm: ['personal_info','read']` |
     | `importPersonalInfo` | `perm: ['personal_info','edit']` |
     | `getEmployeeBalances`, `getEmployeePolicies` | `perm: ['leave_balances','read']` |
     | `allocateLeave`, `setLeaveBalance`, `setEmployeeLeavePolicy` | `perm: ['leave_balances','edit']` |
     | `runAllAccruals` | `perm: ['leave_accrual','edit']` |
     | `getReviewRequests` | `perm: ['leave_requests','read']` |
     | `getReportData` | `perm: ['reports','read']` |
     | clearance `MANAGE_ROLES` gates | `perm: ['clearance','edit']` |
     | clearance `VIEW_ROLES` (`canViewAll`) | `can(c.perms,'clearance','read')` |
     | `getClearanceOverview` | `canManage = can(c.perms,'clearance')` |

     **Leave alone:** `signClearanceFinance` (identity `finance`), approval actions,
     `getVisibleSignatureConsents`.

     In `getImportablePersonnelNos`, the "hr cannot target admins" filter (lines 103–108) stays for
     non-admins.
  3. `lib/actions/roles.ts` follows the `lib/actions/clearance.ts` pattern:
     - Every function starts `const c = await requireCaller(); if (!c.ok) return c;`.
     - `listRoles` calls `c.supabase.rpc('app_list_roles')` and maps with `toRoleRow` (using
       `parsePermsClaim(raw.permissions) ?? {}`).
     - `saveRole` calls `rpc('app_save_role', { p_id: input.id, p_name: input.name.trim(), p_permissions: input.permissions })`.
     - `deleteRole` calls `rpc('app_delete_role', { p_id })` and maps the rows.
     - `transferAdmin` calls `rpc('app_transfer_admin', { p_target, p_personnel_no, p_password })`,
       then `await c.supabase.auth.refreshSession()` so the caller's own claims drop admin.
     - Every mutation then calls `invalidateAppCache()` (import as `employees.ts` does).

     **Error messages.** Add these to the `lib/errors/db-error.ts` translation table, fa + en:
     - `'only the admin can edit roles'`
     - `'invalid role name'`
     - `'role name already used'`
     - `'wrong password'`
     - `'personnel number does not match an active employee'`
     - `'admin is moved only by Transfer admin'`
     - `'not allowed on this employee'`
     - `'built-in roles cannot be deleted'`
     - any message that starts `'not allowed to give or remove role'`

     Match the prefix the way `dbErr` handles other prefixed messages. Read `lib/errors/db-error.ts`
     first and follow its structure.

- [ ] **Step 4: Run the checks.** Run: `npm run test:unit`, then `npx tsc --noEmit`, then
  `npm run lint`. Expected: green.
- [ ] **Step 5: Stop and report.**

---

### Task 8: Edit capabilities and employee forms

**Files:**
- Modify: `lib/employees/editCapabilities.ts`, `tests/unit/edit-capabilities.test.ts`
- Modify:
  - `app/[locale]/(app)/manage/employees/_components/EmployeeFormParts.tsx` (`RoleCheckboxes`)
  - `manage/employees/new/NewEmployeeForm.tsx`, `manage/employees/new/page.tsx`
  - `manage/employees/[id]/page.tsx`, `manage/employees/[id]/EditEmployeeForm.tsx`
  - `manage/employees/page.tsx` (role chips)
  - `app/[locale]/(app)/layout.tsx` (subtitle)
- Modify: `messages/fa.json`, `messages/en.json` (`roles.*` values → English in both;
  `manage.employees.adminTransferHint`)

**Interfaces:**
- Consumes: `RoleRow`, `listRoles` (Task 7); `Perms`, `can`, `isWithin`, `fullPerms` (Task 4).
- Produces:

```ts
export type EditCapabilities = {
  profile: boolean; org: boolean;
  editableRoleIds: string[];          // replaces editableRoles
  resetPassword: boolean; leave: boolean;
  lockedReason: 'admin' | 'self' | 'above' | null;   // 'above' = D4 subset failure
  personalInfo: 'edit' | 'view' | null;
};
export function employeeEditCapabilities(args: {
  callerId: string; callerRoles: string[]; callerPerms: Perms;
  targetId: string; targetRoleIds: string[]; allRoles: RoleRow[];
  targetIsDepartmentManager: boolean;
}): EditCapabilities;
```

- [ ] **Step 1: Rewrite the test file** to the new signature. Keep every existing hr and manager
  case with `callerPerms = HR` (the constant from Task 6) so FR-51 behaviour is pinned. Add:

```ts
it('helpdesk: reset password on a plain employee, nothing else', () => {
  expect(caps({ roles: ['employee'], perms: { people: 'read', passwords: 'edit' } }, ['employee']))
    .toMatchObject({ profile: false, org: false, resetPassword: true, editableRoleIds: [], lockedReason: null });
});
it('helpdesk is locked on a manager (relationship power) and on hr (above)', () => {
  expect(caps({ roles: ['employee'], perms: { people: 'read', passwords: 'edit' } }, ['employee', 'manager']).lockedReason).toBe('above');
  expect(caps({ roles: ['employee'], perms: { people: 'read', passwords: 'edit' } }, ['employee', 'hr']).lockedReason).toBe('above');
});
it('locked on a department manager without departments edit', () => {
  expect(employeeEditCapabilities({ ...base, callerPerms: { people: 'read', passwords: 'edit' }, targetIsDepartmentManager: true }).lockedReason).toBe('above');
});
it('role_assign may toggle roles within its own set only', () => {
  const r = caps({ roles: ['employee'], perms: { people: 'edit', role_assign: 'edit', passwords: 'edit' } }, ['employee']);
  expect(r.editableRoleIds).toContain(HELPDESK.id);      // {people:read, passwords:edit} ⊆ caller
  expect(r.editableRoleIds).not.toContain(HR_ROLE.id);   // hr ⊄ caller
  expect(r.editableRoleIds).not.toContain(ADMIN_ROLE.id);
});
it('the admin box is never editable, even for the admin', () => {
  expect(caps({ roles: ['admin'], perms: fullPerms() }, ['employee']).editableRoleIds).not.toContain(ADMIN_ROLE.id);
});
```

  Define the fixture constants at the top of the test: `ADMIN_ROLE`, `MANAGER_ROLE`, `EMP_ROLE`,
  `HR_ROLE` (HR preset perms), `SEC_ROLE`, `FIN_ROLE`, `HELPDESK` (`{ people: 'read', passwords: 'edit' }`)
  as `RoleRow`s. Then `ALL = [...]`, a `caps(caller, targetSlugs)` helper that maps slugs to ids,
  and `base`.

- [ ] **Step 2: Run it.** Expected: FAIL.

- [ ] **Step 3: Implement `employeeEditCapabilities`.**
  1. Compute the target's effective perms: the per-key max over `allRoles` filtered by
     `targetRoleIds`.
  2. Admin caller → everything. `editableRoleIds` = all roles except `system_key === 'admin'`.
     `lockedReason` null.
  3. `self = targetId === callerId`.
     `targetAdmin = targetRoles has system_key 'admin'`.
     `targetManager = targetRoles has 'manager'`.
  4. Subset check (D4 mirror):
     `above = !isWithin(targetPerms, callerPerms) || (targetManager && !can(callerPerms,'role_manager')) || (targetIsDepartmentManager && !can(callerPerms,'departments'))`.
  5. `lockedReason = self ? 'self' : targetAdmin ? 'admin' : above ? 'above' : null`.
     `actor = lockedReason === null`.
  6. The rest:

     | Capability | Value |
     |---|---|
     | `profile` | `(actor && can(callerPerms,'people')) \|\| (callerRoles.includes('manager') && !self)` |
     | `org` | `actor && can(callerPerms,'people')` |
     | `resetPassword` | `actor && can(callerPerms,'passwords')` |
     | `leave` | `can(callerPerms,'leave_balances','read')` (the balance writes stay gated in SQL) |
     | `personalInfo` | `!can(callerPerms,'personal_info','read') ? null : actor && can(callerPerms,'personal_info') ? 'edit' : 'view'` |
     | `editableRoleIds` | `actor ? allRoles.filter(r => r.systemKey !== 'admin' && (r.systemKey === 'manager' ? can(callerPerms,'role_manager') : can(callerPerms,'role_assign') && isWithin(r.permissions, callerPerms))).map(r => r.id) : []` |

  Delete the `ROLES` / `Role` exports. Fix their importers: `EmployeeFormParts.tsx` and any test.

- [ ] **Step 4: Update the forms.**
  1. `[id]/page.tsx`:
     - Load `listRoles()`, the target's role ids (`user_roles` select `role_id`), `perms`, and
       `targetIsDepartmentManager`
       (`supabase.from('departments').select('id').eq('manager_id', id).limit(1)`).
     - Pass `allRoles` and `targetRoleIds` to the form.
  2. `RoleCheckboxes` takes `roles: RoleRow[]`, `selected: string[]` (role ids), `editable: string[]`,
     `adminHint: string`. Render each role:

     ```tsx
     <label key={role.id} data-testid={`role-${role.systemKey ?? role.id}`} className={…}>
       <input type="checkbox" value={role.systemKey ?? role.id} checked={selected.includes(role.id)}
              disabled={!editable.includes(role.id)} onChange={…} className="rounded border-input text-primary focus:ring-ring" />
       <span className="text-sm">{role.name}</span>
     </label>
     ```

     When the admin role is present, add a muted line below the group:
     `<p className="text-xs text-muted-foreground">{adminHint}</p>`.
  3. `EditEmployeeForm.tsx`:
     - `selectedRoleIds` state.
     - Save via `setRoles(id, selectedRoleIds)` only when changed.
     - Add `data-testid="reset-password"` to the Reset password button and
       `data-testid="edit-save"` to the main Save button (reuse existing ids if present); Task 11
       uses both.
     - Show `lockedReason === 'above'` with a new message,
       `manage.employees.lockedAbove`: "This person has access you don't have, so only the admin
       or someone with more access can change their record." Translate it to fa.
  4. `NewEmployeeForm.tsx`:
     - Receives `allRoles` and `editableRoleIds` from `new/page.tsx`. On a new person,
       `lockedReason` is null: no target yet, and the target has only `employee`.
     - Default selection is the employee role id.
     - Send `roleIds` only when the caller has any editable role.
  5. Employees list (`manage/employees/page.tsx`):
     - The `user_roles` select becomes `user_id, role_id`.
     - Chips use `listRoles()` names, ordered by the `listRoles` order (system, preset, custom).
     - `ROLE_ORDER` and `tRoles` are removed there.
  6. `layout.tsx` subtitle: keep `ROLE_PRIORITY` and `tRoles(topRole)`. The `roles` namespace now
     holds English names in both locales.
  7. Messages:
     - `roles.*` in `messages/fa.json` → the English names (`"admin": "Admin"`, …).
     - Add `manage.employees.adminTransferHint`: en "Admin is moved with Transfer admin in
       Settings › Roles." / fa «ادمین فقط با «انتقال ادمین» در تنظیمات › نقش‌ها جابه‌جا می‌شود.»
     - Add `manage.employees.lockedAbove` (fa + en).

- [ ] **Step 5: Run the checks.** Run: `npm run test:unit`, then `npx tsc --noEmit`, then
  `npm run lint`. Expected: green.
- [ ] **Step 6: Stop and report.**

---

### Task 9: TriStateToggle and PermissionSection components

**Files:**
- Create: `components/ui/tri-state-toggle.tsx`
- Create: `app/[locale]/(app)/settings/roles/_components/PermissionSection.tsx`
- Test: `tests/unit/tri-state-toggle.test.tsx`, `tests/unit/permission-section.test.tsx`

**Interfaces:**
- Consumes: `SECTIONS`, `SHAPES`, `sectionSummary`, `applySectionBulk`, `applyLevel`, `Perms`,
  `PermKey` (Task 4).
- Produces:

```tsx
export type TriValue = 'edit' | 'read' | 'none';
export function TriStateToggle(props: {
  value: TriValue; onChange: (v: TriValue) => void; shape: 'RE' | 'E' | 'R';
  labels: { edit: string; read: string; none: string; noRead: string; noEdit: string };
  name: string;      // accessible group name (the item label)
  testId?: string;   // root; segments get `${testId}-edit|read|none`
}): JSX.Element;

export function PermissionSection(props: {
  section: SectionKey; perms: Perms; onChange: (perms: Perms, raised: PermKey[]) => void;
  raisedNotes: Partial<Record<PermKey, PermKey>>;  // raised item → the item that needed it
  t: { title: string; items: Record<PermKey, { label: string; description: string }>;
       levels: { edit: string; read: string; none: string; noRead: string; noEdit: string };
       summary: Record<SectionChoice, string>; raisedBy: (by: string) => string };
  defaultOpen?: boolean;
}): JSX.Element;
```

- [ ] **Step 1: Check radix APIs first.** Read the `radix-ui` 1.6 docs for ToggleGroup, Collapsible,
  DropdownMenu and Tooltip using Context7. Resolve the library id `radix-ui` / `@radix-ui/react-*`,
  then query "ToggleGroup single type value onValueChange disabled item RTL dir". This is required
  by CLAUDE.md; the exports are `import { ToggleGroup, Collapsible, DropdownMenu, Tooltip } from 'radix-ui'`.
  Confirm the actual shape before coding.

- [ ] **Step 2: Write the failing tests** (Testing Library, following the style of
  `tests/unit/status-badge.test.tsx`):

```tsx
// tests/unit/tri-state-toggle.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TriStateToggle } from '@/components/ui/tri-state-toggle';

const labels = { edit: 'Allowed', read: 'Read only', none: 'Not allowed', noRead: 'No read-only level', noEdit: 'View only' };

describe('TriStateToggle', () => {
  it('marks the current value and changes on click', () => {
    const onChange = vi.fn();
    render(<TriStateToggle value="none" onChange={onChange} shape="RE" labels={labels} name="People" testId="t" />);
    expect(screen.getByTestId('t-none')).toHaveAttribute('data-state', 'on');
    fireEvent.click(screen.getByTestId('t-read'));
    expect(onChange).toHaveBeenCalledWith('read');
  });
  it('disables read on an action item and edit on a read item', () => {
    const { rerender } = render(<TriStateToggle value="none" onChange={() => {}} shape="E" labels={labels} name="Passwords" testId="t" />);
    expect(screen.getByTestId('t-read')).toBeDisabled();
    rerender(<TriStateToggle value="none" onChange={() => {}} shape="R" labels={labels} name="Calendar" testId="t" />);
    expect(screen.getByTestId('t-edit')).toBeDisabled();
  });
  it('never emits an empty value when the selected segment is clicked again', () => {
    const onChange = vi.fn();
    render(<TriStateToggle value="read" onChange={onChange} shape="RE" labels={labels} name="People" testId="t" />);
    fireEvent.click(screen.getByTestId('t-read'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
```

```tsx
// tests/unit/permission-section.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PermissionSection } from '@/app/[locale]/(app)/settings/roles/_components/PermissionSection';
import { ALL_KEYS, type PermKey } from '@/lib/permissions/catalog';

const t = {
  title: 'Leave',
  items: Object.fromEntries(ALL_KEYS.map((k) => [k, { label: `L:${k}`, description: `D:${k}` }])) as Record<PermKey, { label: string; description: string }>,
  levels: { edit: 'Allowed', read: 'Read only', none: 'Not allowed', noRead: 'No read', noEdit: 'View only' },
  summary: { custom: 'Custom', allow: 'Allowed', read: 'Read only', none: 'Not allowed' },
  raisedBy: (by: string) => `Raised by ${by}`,
};

describe('PermissionSection', () => {
  it('header shows Custom when the section is mixed', () => {
    render(<PermissionSection section="leave" perms={{ leave_balances: 'edit' }} onChange={() => {}} raisedNotes={{}} t={t} defaultOpen />);
    expect(screen.getByTestId('perm-section-leave')).toHaveTextContent('Custom');
  });

  it('bulk Allowed sets every leave item to its highest level and reports raised people', () => {
    const onChange = vi.fn();
    render(<PermissionSection section="leave" perms={{}} onChange={onChange} raisedNotes={{}} t={t} defaultOpen />);
    fireEvent.pointerDown(screen.getByTestId('perm-section-leave'), { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByTestId('perm-section-leave-allow'));
    const [perms, raised] = onChange.mock.calls[0];
    expect(perms).toMatchObject({ leave_balances: 'edit', leave_accrual: 'edit', leave_requests: 'edit', calendar: 'read', reports: 'read', people: 'read', departments: 'read' });
    expect([...raised].sort()).toEqual(['departments', 'people']);
  });

  it('a row toggle change goes through applyLevel', () => {
    const onChange = vi.fn();
    render(<PermissionSection section="leave" perms={{}} onChange={onChange} raisedNotes={{}} t={t} defaultOpen />);
    fireEvent.click(screen.getByTestId('perm-reports-read'));
    expect(onChange.mock.calls[0][0]).toMatchObject({ reports: 'read', people: 'read', leave_balances: 'read', leave_requests: 'read' });
  });

  it('a raised row shows who raised it', () => {
    render(<PermissionSection section="leave" perms={{ reports: 'read', leave_balances: 'read', leave_requests: 'read', people: 'read' }}
      onChange={() => {}} raisedNotes={{ leave_balances: 'reports' }} t={t} defaultOpen />);
    expect(screen.getByTestId('perm-row-leave_balances')).toHaveTextContent('Raised by L:reports');
  });
});
```

  Radix menus open on `pointerdown`, not click; the bulk test relies on that. If jsdom lacks
  `hasPointerCapture` / `scrollIntoView`, add no-op stubs at the top of the file:

  ```ts
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.scrollIntoView ??= () => {};
  ```

  `PermissionSection` applies row changes itself (it calls `applyLevel`) and emits
  `onChange(nextPerms, raised)`, so `RoleEditor` only merges the results.

- [ ] **Step 3: Run them.** Expected: FAIL.

- [ ] **Step 4: Implement.**

  **`TriStateToggle`:**
  - Radix `ToggleGroup.Root type="single"` with `value` and `aria-label={name}`. The root also
    carries `onValueChange={(v) => v && v !== value && onChange(v as TriValue)}`.
  - Three `ToggleGroup.Item`s in this order: edit (lucide `CircleCheck`), read (`Eye`),
    none (`Ban`). Each has `aria-label` from `labels` and `data-testid`.
  - Root classes: `inline-flex rounded-[10px] bg-muted p-[3px] gap-0.5`.
  - Item classes:
    `h-9 w-10 inline-flex items-center justify-center rounded-lg text-muted-foreground transition-colors data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-sm disabled:opacity-35 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`.
  - Selected icon colour: edit `text-primary`, read `text-foreground`, none `text-muted-foreground`.
  - Disabled segments are wrapped in a radix `Tooltip` with `labels.noRead` / `labels.noEdit`. Wrap
    in a `<span tabIndex={0}>` so the tooltip opens on a disabled button.
  - Icons are 18px.

  **`PermissionSection`**, the screenshot pattern:

  ```tsx
  <Collapsible.Root defaultOpen={defaultOpen} className="rounded-xl border bg-card">
    <div className="flex items-center gap-3 px-4 py-3">
      <Collapsible.Trigger className="group flex flex-1 items-center gap-3 text-start">
        <ChevronDown className="size-4 transition-transform group-data-[state=closed]:-rotate-90 rtl:group-data-[state=closed]:rotate-90" />
        <span className="font-semibold">{t.title}</span>
        <Badge variant="secondary">{items.length}</Badge>
      </Collapsible.Trigger>
      <DropdownMenu.Root> {/* trigger shows t.summary[summary]; items: allow / read / none */} </DropdownMenu.Root>
    </div>
    <Collapsible.Content>
      {items.map((k) => (
        <div key={k} className="flex flex-col gap-2 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid={`perm-row-${k}`}>
          <div className="min-w-0">
            <div className="text-sm font-medium">{t.items[k].label}</div>
            <div className="text-xs text-muted-foreground">{t.items[k].description}</div>
            {raisedNotes[k] && <div className="mt-1 text-xs text-primary">{t.raisedBy(t.items[raisedNotes[k]!]?.label ?? '')}</div>}
          </div>
          <TriStateToggle … testId={`perm-${k}`} />
        </div>
      ))}
    </Collapsible.Content>
  </Collapsible.Root>
  ```

  `raisedNotes` can name an item from another section. Pass a **global** `items` label map in
  `t.items`, covering all 16 keys.
  - The dropdown trigger is a `Button variant="outline" size="sm"` with
    `data-testid={`perm-section-${section}`}`.
  - Menu items carry `data-testid={`perm-section-${section}-${choice}`}`.

- [ ] **Step 5: Run the checks.** Run:
  `npx vitest run tests/unit/tri-state-toggle.test.tsx tests/unit/permission-section.test.tsx`.
  Expected: PASS.
- [ ] **Step 6: Stop and report.**

---

### Task 10: Settings › Roles screens and dialogs

**Files:**
- Create: `app/[locale]/(app)/settings/_components/SettingsTabs.tsx`
- Create: `app/[locale]/(app)/settings/roles/page.tsx` (list)
- Create: `app/[locale]/(app)/settings/roles/new/page.tsx`
- Create: `app/[locale]/(app)/settings/roles/[id]/page.tsx`
- Create, in `app/[locale]/(app)/settings/roles/_components/`:
  - `RoleEditor.tsx` (client)
  - `RolesList.tsx` (client: delete + transfer buttons)
  - `DeleteRoleDialog.tsx`
  - `TransferAdminDialog.tsx`
  - `AdminOnlyCard.tsx`
- Modify: `app/[locale]/(app)/settings/page.tsx` (render `SettingsTabs active="general"` above
  the title, only for admin)
- Modify: `messages/fa.json`, `messages/en.json` (namespaces `rolesAdmin`, `permissions`)

**Interfaces:**
- Consumes: `listRoles`, `getRoleHolders`, `saveRole`, `deleteRole`, `transferAdmin` (Task 7);
  `PermissionSection` (Task 9); `PersonSearch` (`components/PersonSearch.tsx`, props as in
  `clearance/new/NewClearanceForm.tsx`).
- Produces the routes `/settings/roles`, `/settings/roles/new`, `/settings/roles/[id]`. Test ids:
  - list: `roles-list`, `role-row-<id>`, `role-new`, `role-edit-<id>`, `role-delete-<id>`,
    `transfer-admin`;
  - editor: `role-name`, `role-save`;
  - delete dialog: `delete-holders`, `copy-personnel-nos`, `delete-confirm`;
  - transfer dialog: `transfer-confirm`.

- [ ] **Step 1: Messages.** Add `permissions` to both files: sections, items, levels, summary,
  `raisedBy`. English shown; fa written in the same plain register as the existing `manage.*`
  strings.

```json
"permissions": {
  "sections": { "employees": "Employees", "departments": "Departments", "leave": "Leave", "approvalChain": "Approval chain", "settings": "Company settings" },
  "items": {
    "people": { "label": "Employee records", "description": "Read: the employee list and records. Allowed: edit name, hire date, department, manager, title; deactivate." },
    "people_create": { "label": "Add employees", "description": "Add people one by one or from a CSV (Add new only)." },
    "passwords": { "label": "Passwords", "description": "Reset passwords and print login slips." },
    "role_manager": { "label": "Manager role", "description": "Give or remove the Manager role." },
    "role_assign": { "label": "Assign roles", "description": "Give or remove roles that need no more access than you have." },
    "personal_info": { "label": "Personal information", "description": "Read: view and export. Allowed: correct and import." },
    "clearance": { "label": "Clearance forms", "description": "Read: every form. Allowed: file, edit, cancel; default rows." },
    "departments": { "label": "Departments", "description": "Read: departments and members. Allowed: create, rename, set manager." },
    "leave_balances": { "label": "Leave balances", "description": "Read: anyone's balances and accrual policy. Allowed: opening balances, corrections, policy." },
    "leave_accrual": { "label": "Monthly accrual", "description": "Post the monthly accrual for everyone." },
    "leave_requests": { "label": "Request archive", "description": "Read: every request with its reason and signatures, and print. Allowed: cancel someone else's request." },
    "calendar": { "label": "Company calendar", "description": "See everyone's time off." },
    "reports": { "label": "Reports", "description": "HR reports." },
    "approval_steps": { "label": "Approval steps", "description": "Read: view the steps. Allowed: add, remove, reorder, turn on and off." },
    "work_settings": { "label": "Work week", "description": "Weekly days off, working hours, hourly cap, approval order." },
    "holidays": { "label": "Official holidays", "description": "Add, edit, delete and upload holidays." }
  },
  "levels": { "edit": "Allowed", "read": "Read only", "none": "Not allowed", "noRead": "This item has no read-only level", "noEdit": "This item can only be viewed" },
  "summary": { "custom": "Custom", "allow": "Allowed", "read": "Read only", "none": "Not allowed" },
  "raisedBy": "Turned on because {item} needs it"
}
```

  Add `rolesAdmin` with these keys:
  - `tabs.general`, `tabs.roles`
  - `title`, `newRole`, `holders` (`{count, plural, one {# person} other {# people}}`)
  - `builtIn`, `adminRow`, `managerNote`, `employeeNote`, `edit`, `delete`, `transfer`
  - `nameLabel`, `nameHint` ("English letters, digits, space, & / -")
  - `save`, `saved`, `cancel`, `unsaved`
  - `adminOnly.title` and `adminOnly.items` (an array of the six D2 lines)
  - `delete.title`, `delete.body`, `delete.copy`, `delete.copied`, `delete.confirm`
  - `transfer.title`, `transfer.person`, `transfer.personnelNo`, `transfer.password`,
    `transfer.warning`, `transfer.confirm`

  Write each string in plain English and its fa counterpart.

  **Check:** `messages/*.json` key sets must match. If `tests/unit/i18n-format.test.ts` compares
  them, run it; otherwise add a quick assertion there that the two files have the same `rolesAdmin`
  and `permissions` keys.

- [ ] **Step 2: Tabs + list page.**
  - `SettingsTabs` is a server component: two links styled as the segmented filter from the
    employees toolbar (`bg-muted` track, `bg-card text-primary font-semibold shadow-sm` active),
    `data-testid="settings-tab-general|roles"`.
  - `/settings/roles/page.tsx`:
    - Admin guard, `redirect('/{locale}/settings')` otherwise. `listRoles()`.
    - Find the admin holder via `getRoleHolders(adminRole.id)`.
    - Render `<RolesList>` inside `mx-auto w-full max-w-[900px] flex flex-col gap-5`.
  - `RolesList` rows, in a `Card` with `divide-y`:
    - **name column:** role name (`font-medium`), then the kind badge (`Built-in` for preset; none
      for custom) and the holder count (muted);
    - **Admin row:** lock icon + `adminRow` text with the holder `name · personnel no`, plus a
      `Transfer admin` outline button;
    - **Manager / Employee rows:** muted note, no actions;
    - **preset rows:** an Edit link;
    - **custom rows:** Edit and Delete (ghost destructive) buttons;
    - header: title + `New role` primary button (link).

- [ ] **Step 3: `DeleteRoleDialog`.** An `AlertDialog`.
  - On open, call `getRoleHolders(id)`. The body is `delete.body` with the count, then a
    `max-h-60 overflow-auto` list of `name — personnel no` (personnel no in `<bdi>`,
    `font-mono tabular-nums`), `data-testid="delete-holders"`.
  - `Copy personnel numbers` runs
    `navigator.clipboard.writeText(holders.map(h=>h.personnelNo).join('\n'))`, then shows a sonner
    toast `delete.copied`. Hide the button when there are 0 holders.
  - The confirm button is destructive. It calls `deleteRole`, then `router.refresh()`. Errors show
    in a `role="alert"` line.

- [ ] **Step 4: `TransferAdminDialog`.** A `Dialog` with:
  - `PersonSearch` over the active people from a new small server action,
    `listTransferCandidates()` in `lib/actions/roles.ts`: admin only; selects
    `id, full_name, personnel_no` from `profiles` where active and `id <> caller`, ordered by
    `personnel_no`;
  - a personnel-number input (`inputMode="numeric"`, `dir="ltr"`);
  - a password input (`type="password"`, `autoComplete="current-password"`);
  - a warning block (`bg-warning/10 text-warning` or the closest token in `app/globals.css`).

  The confirm button stays disabled until all three are filled. On success:
  `router.replace('/{locale}/home')` and `router.refresh()`.

- [ ] **Step 5: `RoleEditor` + pages.**
  - `new/page.tsx` renders `<RoleEditor role={null} />` (admin guard). `[id]/page.tsx` finds the
    role in `listRoles()`: `notFound()` if missing, redirect if it is a system role.
  - `RoleEditor` state is `{ name, perms, raisedNotes, dirty }`.
    - For each section in `SECTIONS`, render `<PermissionSection>` (first one `defaultOpen`). Its
      `onChange(perms, raised)` merges `raised` into `raisedNotes`, records which item raised them,
      and sets `dirty`.
    - Row toggles and bulk choices are applied inside `PermissionSection` (Task 9); `RoleEditor`
      only stores the `perms` it emits and merges `raised` into `raisedNotes`.
    - Then `<AdminOnlyCard>`: lock icon, title, the six D2 items as a muted list, no controls.
  - Sticky bar: `sticky bottom-0 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur flex justify-end gap-2`
    with Cancel (link back) and Save (`data-testid="role-save"`).
    - Save calls `saveRole`. On ok: toast `saved`, clear `raisedNotes` and `dirty`,
      `router.replace` to `/settings/roles/{id}` when new.
  - Name input `data-testid="role-name"`, `dir="ltr"`, disabled for presets, `maxLength={40}`.
    Client validation uses the same regex as the database.
  - Unsaved guard: a `beforeunload` listener while `dirty`, and Cancel asks with `confirm(t('unsaved'))`.

- [ ] **Step 6: Verify in the browser.**
  1. Make sure `.claude/launch.json` has a `dev` config (`npm run dev`, port 3000), then
     `preview_start`.
  2. Log in as admin (`admin` / see CLAUDE.md for local), open `/settings/roles` and check:
     - the list renders;
     - New role: toggle Reports → Read only, and see people / leave_balances / leave_requests
       raised with notes;
     - the section dropdown shows "Custom";
     - Passwords → the middle segment is disabled with a tooltip;
     - saving "Helpdesk QA" works;
     - Delete shows the holder list and the copy button.
  3. Check fa RTL (chevron direction, segment order mirrored), `/en`, and mobile width
     (`resize_window` preset mobile).
  4. Read the console messages: expect none. Send the screenshots to Amir.
  5. Delete "Helpdesk QA" afterwards.
- [ ] **Step 7: Run the checks.** Run: `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`,
  `npm run build`. Expected: green.
- [ ] **Step 8: Stop and report.**

---

### Task 11: e2e

**Files:**
- Create: `tests/e2e/roles.spec.ts`
- Modify: `tests/e2e/_helpers.ts` (`createEmployee` role checkboxes by test id)
- Modify: `tests/e2e/hr-employee-admin.spec.ts`, `tests/e2e/balance-days-hours.spec.ts`,
  `tests/e2e/hr-role.spec.ts`, `tests/e2e/team.spec.ts` (label → test id)

**Interfaces:**
- Consumes: the test ids from Tasks 8 and 10.

- [ ] **Step 1: Helpers.** In `createEmployee`, replace the label loop (lines 273–283) with:

```ts
  for (const role of opts.roles) {
    const cb = page.locator(`[data-testid="role-${role}"] input[type="checkbox"]`);
    if (await cb.count()) {
      if (!(await cb.isChecked())) await cb.check();
    }
  }
```

  In the four specs, replace `page.getByLabel('<slug>', { exact: true })` with
  `page.locator('[data-testid="role-<slug>"] input')`. Leave assertions unchanged. In
  `hr-role.spec.ts:273`, the check `input[value="admin"]` keeps working because `value` is still
  the slug. Review its intent: hr now sees the role boxes (disabled), not none. Assert instead
  `await expect(page.locator('[data-testid="role-admin"] input')).toBeDisabled()`, and keep a
  comment pointing to FR-55 D1.

- [ ] **Step 2: Write `tests/e2e/roles.spec.ts`:**

```ts
/**
 * FR-55 — admin-configurable roles. Throwaway 999… users only (local DB holds the
 * real roster). Transfer admin is covered in tests/sql/fr55-roles-permissions.sql.
 */
import { test, expect } from '@playwright/test';
import {
  ADMIN_CODE, ADMIN_PASSWORD, createEmployee, firstLoginPassword, login, setFirstPassword,
} from './_helpers';

test('admin creates Helpdesk; helpdesk resets an employee, not a manager; delete lists holders', async ({ page, browser }) => {
  await login(page, ADMIN_CODE, ADMIN_PASSWORD);
  const helper = await createEmployee(page, { name: 'E2E Helpdesk', roles: ['employee'] });
  const worker = await createEmployee(page, { name: 'E2E Worker', roles: ['employee'] });
  const boss = await createEmployee(page, { name: 'E2E Boss', roles: ['employee', 'manager'] });

  // 1. create the role; Passwords raises Employee records to Read only
  const roleName = `Helpdesk ${Date.now() % 100000}`;
  await page.goto('/settings/roles/new');
  await page.getByTestId('role-name').fill(roleName);
  await page.getByTestId('perm-passwords-edit').click();
  await expect(page.getByTestId('perm-people-read')).toHaveAttribute('data-state', 'on');
  await page.getByTestId('role-save').click();
  await expect(page).toHaveURL(/\/settings\/roles\/[0-9a-f-]{36}$/);
  const roleId = page.url().split('/').pop()!;

  // 2. assign it to the helper
  await page.goto(`/manage/employees?q=${helper.code}`);
  await page.getByText('E2E Helpdesk').first().click();
  const box = page.locator(`[data-testid="role-${roleId}"] input`);
  await box.check();
  await page.getByTestId('edit-save').click();
  await expect(page.getByTestId('edit-success')).toBeVisible({ timeout: 20_000 });
  await expect(box).toBeChecked();

  // 3. helpdesk session (fresh account: first-login password screen first)
  const ctx = await browser.newContext();
  const hp = await ctx.newPage();
  await login(hp, helper.code, helper.password);
  await setFirstPassword(hp, firstLoginPassword(helper.password));
  await hp.goto(`/manage/employees?q=${worker.code}`);
  await hp.getByText('E2E Worker').first().click();
  await expect(hp.getByTestId('reset-password')).toBeVisible();
  await hp.goto(`/manage/employees?q=${boss.code}`);
  await hp.getByText('E2E Boss').first().click();
  await expect(hp.getByTestId('reset-password')).toHaveCount(0);
  await expect(hp.getByTestId('edit-scope-note')).toBeVisible();
  await ctx.close();

  // 4. delete lists the holder's personnel number, then removes the role
  await page.goto('/settings/roles');
  await page.getByTestId(`role-delete-${roleId}`).click();
  await expect(page.getByTestId('delete-holders')).toContainText(helper.code);
  await page.getByTestId('delete-confirm').click();
  await expect(page.getByTestId(`role-row-${roleId}`)).toHaveCount(0);
});
```

  **Test-id prerequisites for Task 8.** Add `data-testid="reset-password"` to the Reset password
  button in `EditEmployeeForm.tsx`. Add `data-testid="edit-save"` to its main Save button, unless
  that id already exists: grep the file first and reuse an existing id if there is one. Also check
  that the employees list reads a `q` search param (Task 3 of the design handoff added search). If
  not, drop `?q=…` and rely on `getByText(...).first()`. Check that `createEmployee` returns
  `{ code, password }`: `password` is the issued temp password, and `code` equals the personnel
  number.

- [ ] **Step 3: Run the specs.**
  1. `./deploy/bj-deploy update local`, then `docker restart bj-erp-rest-1`.
  2. Run:
     ```bash
     npx playwright test tests/e2e/roles.spec.ts tests/e2e/hr-employee-admin.spec.ts tests/e2e/hr-role.spec.ts tests/e2e/team.spec.ts tests/e2e/balance-days-hours.spec.ts tests/e2e/clearance.spec.ts tests/e2e/approval.spec.ts --workers=1
     ```
  Expected: pass. The known pre-existing failure is `manager-create-employee` (demo-seed user);
  it is not in this list.
- [ ] **Step 4: Run `npm run cleanup:e2e`.**
- [ ] **Step 5: Stop and report.**

---

### Task 12: hr parity check as Ayasi

- [ ] **Step 1:** Log in to the browser preview as Ayasi (personnel no. 124; credentials in
  `.env.test-accounts`). Check each of these:
  - nav: Employees, Departments, Approvals, Request archive, Approval steps, Reports; no Settings;
  - Edit Employee on a plain employee: org fields editable, only the Manager box enabled;
  - on the admin: locked with the admin note;
  - Departments: Ayasi does not appear in the manager pickers of other departments, or picking him
    is refused (D7);
  - Approval steps: no enforce-order switch enabled.
- [ ] **Step 2:** Screenshot the nav plus one locked record and send them to Amir. Stop and report.

---

### Task 13: Docs and final verification

**Files:**
- Modify: `docs/specs/2026-10-07-configurable-roles-design.md`. Status: "Accepted and built". Apply
  the amendments:
  - `personnel_no` removed from the catalog and its D6 / preset rows;
  - `app_set_user_role_ids` named in place of the new `app_set_user_roles` signature.
- Modify: `docs/REQUIREMENTS.md`. Add FR-55 after FR-54, one paragraph in the existing style.
- Modify: `docs/PERMISSIONS.md`:
  - **Roles table:** add Custom roles and the one-admin rule.
  - **SQL helpers:** add `has_perm`, `reads_*`, `can_act_on`, `role_within`, and the legacy alias.
  - **New section, "Configurable roles (FR-55)":** catalog, D1–D7, locked list.
  - **Per-table sections:** update every guard changed in Task 2.
- Modify: `docs/DATA_MODEL.md`. Add `roles` and `role_permissions`, and
  `user_roles.role_id` + sync trigger + one-admin index.
- Modify: `docs/CHANGELOG.md`. Add an FR-55 entry.
- Modify: `docs/TASKS.md`:
  - **Remove:** configurable roles, limited admin role, raw-slug checkboxes.
  - **Add:** "drop `has_permission` legacy keys and `app_set_user_roles(uuid, app_role[])` after
    the FR-55 release is live"; "admin lockout has no recovery path (D1, owner accepted)";
    "after deploy: check Liara has exactly one admin (the migration refuses otherwise)".
- Modify: `docs/AGENT-LOG.md`. Add a session entry with the template, covering the commands run
  and results.
- Modify: `CLAUDE.md` Gotchas. Propose to Amir:
  - **one-admin index:** "Exactly one `admin` row (`user_roles_one_admin`): SQL fixtures needing a
    second admin drop the index inside their rolled-back transaction."
  - **New grants:** "New grants use `private.has_perm(uid, key, level)` + `private.can_act_on`
    (FR-55), and a key added to the catalog needs `permission_keys/allows/deps` + `lib/permissions/catalog.ts` + messages."

- [ ] **Step 1: Write the docs above.**
- [ ] **Step 2: Run the full check.**
  ```bash
  npx tsc --noEmit && npm run lint && npm run test:unit && npm run build && npm run test:deploy
  ```
  Then run the four `tests/sql/*.sql` files. Expected: everything green, every SQL line PASS.
- [ ] **Step 3: Report to Amir.** Give the results, the screenshots, the spec amendments, and the
  suggested CLAUDE.md lines. Do not commit or push; Liara deploys on push to `main`.
