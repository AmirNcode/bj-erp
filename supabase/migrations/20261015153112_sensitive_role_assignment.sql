create or replace function private.role_within(p_role_id uuid, p_uid uuid) returns boolean
language sql stable security definer set search_path to '' as $$
  select coalesce((
    select case
      when r.system_key = 'admin' then false
      when private.is_admin(p_uid) then true
      when r.system_key = 'manager' then private.has_perm(p_uid, 'role_manager', 'edit')
      when exists (select 1 from public.user_roles where user_id = p_uid and role = 'hr')
        then r.system_key = 'employee' and private.has_perm(p_uid, 'role_assign', 'edit')
      when r.system_key in ('hr', 'finance') then false
      when exists (select 1 from public.role_permissions rp where rp.role_id = r.id
                   and rp.level = 'edit' and private.permission_allows(rp.permission, rp.level)) then false
      else private.has_perm(p_uid, 'role_assign', 'edit')
        and not exists (select 1 from public.role_permissions rp where rp.role_id = r.id
                         and private.permission_allows(rp.permission, rp.level)
                         and case rp.level when 'edit' then 2 else 1 end > private.perm_level(p_uid, rp.permission))
    end
    from public.roles r
    join public.profiles caller on caller.id = p_uid and caller.company_id = r.company_id
    where r.id = p_role_id), false);
$$;
