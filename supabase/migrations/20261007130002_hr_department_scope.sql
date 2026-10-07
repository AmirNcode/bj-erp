-- Follow-up to 20261007130001 (FR-51), from the 2026-10-07 security review.
--
-- 1. A non-admin editor may not change the manager of the department they belong
--    to. That manager signs the department-manager step on the editor's own
--    requests, and hr can grant the `manager` role: together that is choosing your
--    own approver, which FR-51 D3 already refuses on hr's own record.
-- 2. A department manager must be a profile of the same company (admins too).
-- 3. The editor policies are scoped to the caller's company. One company per
--    deploy today, so this is defence in depth.

drop policy departments_insert_editor on public.departments;
create policy departments_insert_editor on public.departments for insert to authenticated
  with check (
    private.has_permission((select auth.uid()), 'departments.edit')
    and company_id = (select p.company_id from public.profiles p where p.id = (select auth.uid()))
  );

drop policy departments_update_editor on public.departments;
create policy departments_update_editor on public.departments for update to authenticated
  using (
    private.has_permission((select auth.uid()), 'departments.edit')
    and company_id = (select p.company_id from public.profiles p where p.id = (select auth.uid()))
  )
  with check (
    private.has_permission((select auth.uid()), 'departments.edit')
    and company_id = (select p.company_id from public.profiles p where p.id = (select auth.uid()))
  );

-- Now also runs on INSERT, for the same-company manager rule.
create or replace function private.enforce_department_update_scope() returns trigger
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  v_uid uuid := auth.uid();
begin
  if new.manager_id is not null
     and (tg_op = 'INSERT' or new.manager_id is distinct from old.manager_id)
     and not exists (
       select 1 from public.profiles where id = new.manager_id and company_id = new.company_id
     )
  then
    raise exception 'department manager must belong to the same company' using errcode = '22023';
  end if;

  if tg_op = 'INSERT' or private.is_admin(v_uid) then
    return new;
  end if;

  if (new.id         is distinct from old.id)
     or (new.company_id is distinct from old.company_id)
     or (new.code       is distinct from old.code)
     or (new.kind       is distinct from old.kind)
     or (new.created_at is distinct from old.created_at)
  then
    raise exception 'not permitted to modify restricted department fields' using errcode = '42501';
  end if;

  if new.manager_id is distinct from old.manager_id
     and exists (select 1 from public.profiles where id = v_uid and department_id = old.id)
  then
    raise exception 'you cannot change the manager of your own department' using errcode = '42501';
  end if;

  return new;
end; $$;

drop trigger departments_enforce_update_scope on public.departments;
create trigger departments_enforce_update_scope
  before insert or update on public.departments
  for each row execute function private.enforce_department_update_scope();
