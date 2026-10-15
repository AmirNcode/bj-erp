-- FR-55 Task 3b: scope the delegable config write policies to the caller's company.
-- Migration 20261013200003 made these writes depend on private.has_perm(...), which is
-- company-blind: anyone holding the permission could write ANOTHER company's rows.
-- Add the company condition (admin is not exempt: one company per deploy, and an
-- admin writing another company's config is never legitimate). USING covers
-- UPDATE/DELETE; WITH CHECK covers INSERT/UPDATE, so a row cannot be moved across
-- companies either. private.caller_company() comes from 20261013200004.
--
-- holidays and work_settings insert/update are not here any more: main's *_editor
-- policies (20261012120004) already carry the company condition, and
-- 20261013200003 keeps it when it rewrites them onto the holidays / work_settings
-- items. main kept work_settings_delete_admin admin-only but company-blind; it
-- stays admin-only and gets the company condition like every other config write.

-- work_settings delete
drop policy work_settings_delete_admin on public.work_settings;
create policy work_settings_delete_admin on public.work_settings for delete to authenticated
  using (private.is_admin((select auth.uid()))
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
