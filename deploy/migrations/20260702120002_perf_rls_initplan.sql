-- =============================================================================
-- Migration: 20260702120002_perf_rls_initplan.sql
-- Purpose  : Performance pass driven by the Supabase advisor.
--
--   1) RLS initplan (lint 0003): every policy called auth.uid() directly, which
--      Postgres re-evaluates per row. Wrapping it as (select auth.uid()) makes
--      it an InitPlan evaluated once per statement. Predicates are otherwise
--      IDENTICAL to the originals (0003 / 0005 / 0624 reason-privacy).
--   2) Covering indexes for all foreign keys the advisor flagged (lint 0001).
-- =============================================================================

-- ----- companies -------------------------------------------------------------
drop policy if exists "companies_insert_admin" on public.companies;
create policy "companies_insert_admin" on public.companies for insert to authenticated
  with check (private.is_admin((select auth.uid())));
drop policy if exists "companies_update_admin" on public.companies;
create policy "companies_update_admin" on public.companies for update to authenticated
  using (private.is_admin((select auth.uid()))) with check (private.is_admin((select auth.uid())));
drop policy if exists "companies_delete_admin" on public.companies;
create policy "companies_delete_admin" on public.companies for delete to authenticated
  using (private.is_admin((select auth.uid())));

-- ----- departments -----------------------------------------------------------
drop policy if exists "departments_insert_admin" on public.departments;
create policy "departments_insert_admin" on public.departments for insert to authenticated
  with check (private.is_admin((select auth.uid())));
drop policy if exists "departments_update_admin" on public.departments;
create policy "departments_update_admin" on public.departments for update to authenticated
  using (private.is_admin((select auth.uid()))) with check (private.is_admin((select auth.uid())));
drop policy if exists "departments_delete_admin" on public.departments;
create policy "departments_delete_admin" on public.departments for delete to authenticated
  using (private.is_admin((select auth.uid())));

-- ----- profiles ----------------------------------------------------------------
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles for select to authenticated
  using (id = (select auth.uid())
         or private.same_team((select auth.uid()), id)
         or private.can_read_all((select auth.uid())));
drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_update" on public.profiles for update to authenticated
  using (private.is_admin((select auth.uid()))
         or private.is_manager_of((select auth.uid()), id)
         or id = (select auth.uid()))
  with check (private.is_admin((select auth.uid()))
              or private.is_manager_of((select auth.uid()), id)
              or id = (select auth.uid()));
drop policy if exists "profiles_insert_admin" on public.profiles;
create policy "profiles_insert_admin" on public.profiles for insert to authenticated
  with check (private.is_admin((select auth.uid())));

-- ----- user_roles --------------------------------------------------------------
drop policy if exists "user_roles_select" on public.user_roles;
create policy "user_roles_select" on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()) or private.can_read_all((select auth.uid())));
drop policy if exists "user_roles_insert_admin" on public.user_roles;
create policy "user_roles_insert_admin" on public.user_roles for insert to authenticated
  with check (private.is_admin((select auth.uid())));
drop policy if exists "user_roles_update_admin" on public.user_roles;
create policy "user_roles_update_admin" on public.user_roles for update to authenticated
  using (private.is_admin((select auth.uid()))) with check (private.is_admin((select auth.uid())));
drop policy if exists "user_roles_delete_admin" on public.user_roles;
create policy "user_roles_delete_admin" on public.user_roles for delete to authenticated
  using (private.is_admin((select auth.uid())));

-- ----- audit_log ----------------------------------------------------------------
drop policy if exists "audit_log_select_admin" on public.audit_log;
create policy "audit_log_select_admin" on public.audit_log for select to authenticated
  using (private.is_admin((select auth.uid())));
drop policy if exists "audit_log_insert_self" on public.audit_log;
create policy "audit_log_insert_self" on public.audit_log for insert to authenticated
  with check (actor_id = (select auth.uid()));

-- ----- work_settings -------------------------------------------------------------
drop policy if exists "work_settings_insert_admin" on public.work_settings;
create policy "work_settings_insert_admin" on public.work_settings for insert to authenticated
  with check (private.is_admin((select auth.uid())));
drop policy if exists "work_settings_update_admin" on public.work_settings;
create policy "work_settings_update_admin" on public.work_settings for update to authenticated
  using (private.is_admin((select auth.uid()))) with check (private.is_admin((select auth.uid())));
drop policy if exists "work_settings_delete_admin" on public.work_settings;
create policy "work_settings_delete_admin" on public.work_settings for delete to authenticated
  using (private.is_admin((select auth.uid())));

-- ----- holidays --------------------------------------------------------------------
drop policy if exists "holidays_insert_admin" on public.holidays;
create policy "holidays_insert_admin" on public.holidays for insert to authenticated
  with check (private.is_admin((select auth.uid())));
drop policy if exists "holidays_update_admin" on public.holidays;
create policy "holidays_update_admin" on public.holidays for update to authenticated
  using (private.is_admin((select auth.uid()))) with check (private.is_admin((select auth.uid())));
drop policy if exists "holidays_delete_admin" on public.holidays;
create policy "holidays_delete_admin" on public.holidays for delete to authenticated
  using (private.is_admin((select auth.uid())));

-- ----- leave_types --------------------------------------------------------------------
drop policy if exists "leave_types_insert_admin" on public.leave_types;
create policy "leave_types_insert_admin" on public.leave_types for insert to authenticated
  with check (private.is_admin((select auth.uid())));
drop policy if exists "leave_types_update_admin" on public.leave_types;
create policy "leave_types_update_admin" on public.leave_types for update to authenticated
  using (private.is_admin((select auth.uid()))) with check (private.is_admin((select auth.uid())));
drop policy if exists "leave_types_delete_admin" on public.leave_types;
create policy "leave_types_delete_admin" on public.leave_types for delete to authenticated
  using (private.is_admin((select auth.uid())));

-- ----- leave_allocations (select-only; writes via definer fns) ---------------------------
drop policy if exists "leave_allocations_select" on public.leave_allocations;
create policy "leave_allocations_select" on public.leave_allocations for select to authenticated
  using (employee_id = (select auth.uid())
         or private.is_manager_of((select auth.uid()), employee_id)
         or private.can_read_all((select auth.uid())));

-- ----- leave_requests (FR-25 strict-reason scope preserved) -------------------------------
drop policy if exists "leave_requests_select" on public.leave_requests;
create policy "leave_requests_select" on public.leave_requests for select to authenticated
  using (employee_id = (select auth.uid())
         or private.is_manager_of((select auth.uid()), employee_id)
         or private.has_role((select auth.uid()), 'security')
         or private.is_admin((select auth.uid())));

-- ----- leave_ledger ------------------------------------------------------------------------
drop policy if exists "leave_ledger_select" on public.leave_ledger;
create policy "leave_ledger_select" on public.leave_ledger for select to authenticated
  using (employee_id = (select auth.uid())
         or private.is_manager_of((select auth.uid()), employee_id)
         or private.can_read_all((select auth.uid())));

-- ----- covering indexes for advisor-flagged foreign keys (lint 0001) ------------------------
create index if not exists audit_log_actor_id_idx          on public.audit_log (actor_id);
create index if not exists departments_company_id_idx      on public.departments (company_id);
create index if not exists departments_manager_id_idx      on public.departments (manager_id);
create index if not exists leave_allocations_employee_idx  on public.leave_allocations (employee_id);
create index if not exists leave_allocations_type_idx      on public.leave_allocations (leave_type_id);
create index if not exists leave_allocations_created_by_idx on public.leave_allocations (created_by);
create index if not exists leave_ledger_type_idx           on public.leave_ledger (leave_type_id);
create index if not exists leave_ledger_request_idx        on public.leave_ledger (request_id);
create index if not exists leave_requests_decided_by_idx   on public.leave_requests (decided_by);
create index if not exists leave_requests_type_idx         on public.leave_requests (leave_type_id);
create index if not exists leave_types_company_id_idx      on public.leave_types (company_id);
create index if not exists profiles_company_id_idx         on public.profiles (company_id);
create index if not exists work_settings_updated_by_idx    on public.work_settings (updated_by);
