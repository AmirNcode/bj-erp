-- FR-55 Task 3b: scope the delegable config write policies to the caller's company.
-- Migration 20261007160003 made these writes depend on private.has_perm(...), which is
-- company-blind: anyone holding the permission could write ANOTHER company's rows.
-- Add the company condition (admin is not exempt: one company per deploy, and an
-- admin writing another company's config is never legitimate). USING covers
-- UPDATE/DELETE; WITH CHECK covers INSERT/UPDATE, so a row cannot be moved across
-- companies either. private.caller_company() comes from 20261007160004.

-- holidays
drop policy holidays_insert_admin on public.holidays;
create policy holidays_insert_admin on public.holidays for insert to authenticated
  with check (private.has_perm((select auth.uid()), 'holidays', 'edit')
              and company_id = (select private.caller_company()));
drop policy holidays_update_admin on public.holidays;
create policy holidays_update_admin on public.holidays for update to authenticated
  using (private.has_perm((select auth.uid()), 'holidays', 'edit')
         and company_id = (select private.caller_company()))
  with check (private.has_perm((select auth.uid()), 'holidays', 'edit')
              and company_id = (select private.caller_company()));
drop policy holidays_delete_admin on public.holidays;
create policy holidays_delete_admin on public.holidays for delete to authenticated
  using (private.has_perm((select auth.uid()), 'holidays', 'edit')
         and company_id = (select private.caller_company()));

-- work_settings
drop policy work_settings_insert_admin on public.work_settings;
create policy work_settings_insert_admin on public.work_settings for insert to authenticated
  with check (private.has_perm((select auth.uid()), 'work_settings', 'edit')
              and company_id = (select private.caller_company()));
drop policy work_settings_update_admin on public.work_settings;
create policy work_settings_update_admin on public.work_settings for update to authenticated
  using (private.has_perm((select auth.uid()), 'work_settings', 'edit')
         and company_id = (select private.caller_company()))
  with check (private.has_perm((select auth.uid()), 'work_settings', 'edit')
              and company_id = (select private.caller_company()));
drop policy work_settings_delete_admin on public.work_settings;
create policy work_settings_delete_admin on public.work_settings for delete to authenticated
  using (private.has_perm((select auth.uid()), 'work_settings', 'edit')
         and company_id = (select private.caller_company()));

-- approval_steps
drop policy approval_steps_insert_config on public.approval_steps;
create policy approval_steps_insert_config on public.approval_steps for insert to authenticated
  with check (private.has_perm((select auth.uid()), 'approval_steps', 'edit')
              and company_id = (select private.caller_company()));
drop policy approval_steps_update_config on public.approval_steps;
create policy approval_steps_update_config on public.approval_steps for update to authenticated
  using (private.has_perm((select auth.uid()), 'approval_steps', 'edit')
         and company_id = (select private.caller_company()))
  with check (private.has_perm((select auth.uid()), 'approval_steps', 'edit')
              and company_id = (select private.caller_company()));
drop policy approval_steps_delete_config on public.approval_steps;
create policy approval_steps_delete_config on public.approval_steps for delete to authenticated
  using (private.has_perm((select auth.uid()), 'approval_steps', 'edit')
         and company_id = (select private.caller_company()));
