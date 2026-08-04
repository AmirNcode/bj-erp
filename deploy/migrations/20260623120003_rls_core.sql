-- =============================================================================
-- Migration: 20260623120003_rls_core.sql
-- Purpose  : Enable RLS and define per-table policies for core tables.
-- Spec     : docs/PERMISSIONS.md  (Policy intent per table section)
-- Depends  : 20260623120001_core.sql, 20260623120002_rls_helpers.sql
-- Note     : helper functions live in the `private` schema (see 0002).
-- =============================================================================

alter table public.companies   enable row level security;
alter table public.departments enable row level security;
alter table public.profiles    enable row level security;
alter table public.user_roles  enable row level security;
alter table public.audit_log   enable row level security;

-- ----- companies: read=authenticated, write=admin ---------------------------
create policy "companies_select_authenticated" on public.companies for select to authenticated using (true);
create policy "companies_insert_admin" on public.companies for insert to authenticated with check (private.is_admin(auth.uid()));
create policy "companies_update_admin" on public.companies for update to authenticated using (private.is_admin(auth.uid())) with check (private.is_admin(auth.uid()));
create policy "companies_delete_admin" on public.companies for delete to authenticated using (private.is_admin(auth.uid()));

-- ----- departments: read=authenticated, write=admin -------------------------
create policy "departments_select_authenticated" on public.departments for select to authenticated using (true);
create policy "departments_insert_admin" on public.departments for insert to authenticated with check (private.is_admin(auth.uid()));
create policy "departments_update_admin" on public.departments for update to authenticated using (private.is_admin(auth.uid())) with check (private.is_admin(auth.uid()));
create policy "departments_delete_admin" on public.departments for delete to authenticated using (private.is_admin(auth.uid()));

-- ----- profiles: select self|same_team|can_read_all; update admin|manager|self; insert admin
create policy "profiles_select" on public.profiles for select to authenticated
  using (id = auth.uid() or private.same_team(auth.uid(), id) or private.can_read_all(auth.uid()));
create policy "profiles_update" on public.profiles for update to authenticated
  using (private.is_admin(auth.uid()) or private.is_manager_of(auth.uid(), id) or id = auth.uid())
  with check (private.is_admin(auth.uid()) or private.is_manager_of(auth.uid(), id) or id = auth.uid());
create policy "profiles_insert_admin" on public.profiles for insert to authenticated with check (private.is_admin(auth.uid()));

-- ----- user_roles: select self|can_read_all; write admin --------------------
create policy "user_roles_select" on public.user_roles for select to authenticated
  using (user_id = auth.uid() or private.can_read_all(auth.uid()));
create policy "user_roles_insert_admin" on public.user_roles for insert to authenticated with check (private.is_admin(auth.uid()));
create policy "user_roles_update_admin" on public.user_roles for update to authenticated using (private.is_admin(auth.uid())) with check (private.is_admin(auth.uid()));
create policy "user_roles_delete_admin" on public.user_roles for delete to authenticated using (private.is_admin(auth.uid()));

-- ----- audit_log: select admin; insert only rows attributed to self; append-only
create policy "audit_log_select_admin" on public.audit_log for select to authenticated using (private.is_admin(auth.uid()));
create policy "audit_log_insert_self" on public.audit_log for insert to authenticated with check (actor_id = auth.uid());
-- No UPDATE / DELETE policies — immutable append-only log.
