-- =============================================================================
-- Migration: 20260623120003_rls_core.sql
-- Purpose  : Enable RLS and define per-table policies for core tables.
-- Spec     : docs/PERMISSIONS.md  (Policy intent per table section)
-- Depends  : 20260623120001_core.sql, 20260623120002_rls_helpers.sql
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Enable Row-Level Security
-- ---------------------------------------------------------------------------

alter table public.companies   enable row level security;
alter table public.departments enable row level security;
alter table public.profiles    enable row level security;
alter table public.user_roles  enable row level security;
alter table public.audit_log   enable row level security;

-- ---------------------------------------------------------------------------
-- 2. companies
--    SELECT : any authenticated user
--    INSERT / UPDATE / DELETE : admin only
-- ---------------------------------------------------------------------------

create policy "companies_select_authenticated"
  on public.companies
  for select
  to authenticated
  using (true);

create policy "companies_insert_admin"
  on public.companies
  for insert
  to authenticated
  with check (public.is_admin(auth.uid()));

create policy "companies_update_admin"
  on public.companies
  for update
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "companies_delete_admin"
  on public.companies
  for delete
  to authenticated
  using (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- 3. departments
--    SELECT : any authenticated user
--    INSERT / UPDATE / DELETE : admin only
-- ---------------------------------------------------------------------------

create policy "departments_select_authenticated"
  on public.departments
  for select
  to authenticated
  using (true);

create policy "departments_insert_admin"
  on public.departments
  for insert
  to authenticated
  with check (public.is_admin(auth.uid()));

create policy "departments_update_admin"
  on public.departments
  for update
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "departments_delete_admin"
  on public.departments
  for delete
  to authenticated
  using (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- 4. profiles
--    SELECT : self OR same_team OR can_read_all
--    UPDATE : is_admin OR is_manager_of(auth.uid(), id) OR self
--    INSERT : is_admin only
-- ---------------------------------------------------------------------------

create policy "profiles_select"
  on public.profiles
  for select
  to authenticated
  using (
    id = auth.uid()
    or public.same_team(auth.uid(), id)
    or public.can_read_all(auth.uid())
  );

create policy "profiles_update"
  on public.profiles
  for update
  to authenticated
  using (
    public.is_admin(auth.uid())
    or public.is_manager_of(auth.uid(), id)
    or id = auth.uid()
  )
  with check (
    public.is_admin(auth.uid())
    or public.is_manager_of(auth.uid(), id)
    or id = auth.uid()
  );

create policy "profiles_insert_admin"
  on public.profiles
  for insert
  to authenticated
  with check (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- 5. user_roles
--    SELECT : self OR can_read_all
--    INSERT / UPDATE / DELETE : admin only
-- ---------------------------------------------------------------------------

create policy "user_roles_select"
  on public.user_roles
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.can_read_all(auth.uid())
  );

create policy "user_roles_insert_admin"
  on public.user_roles
  for insert
  to authenticated
  with check (public.is_admin(auth.uid()));

create policy "user_roles_update_admin"
  on public.user_roles
  for update
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "user_roles_delete_admin"
  on public.user_roles
  for delete
  to authenticated
  using (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- 6. audit_log
--    SELECT  : admin only
--    INSERT  : any authenticated user (rows written by server actions)
--    UPDATE  : none
--    DELETE  : none
-- ---------------------------------------------------------------------------

create policy "audit_log_select_admin"
  on public.audit_log
  for select
  to authenticated
  using (public.is_admin(auth.uid()));

create policy "audit_log_insert_authenticated"
  on public.audit_log
  for insert
  to authenticated
  with check (true);

-- No UPDATE or DELETE policies — immutable append-only log.
