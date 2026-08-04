-- Scoped team directory for the Home "My Team" section.
-- Exposes only the caller's manager plus active teammates in the same department,
-- including role labels that ordinary employees cannot read directly from
-- user_roles under RLS.

create or replace function public.get_my_team_directory()
returns table (
  profile_id uuid,
  full_name text,
  employee_code text,
  relation text,
  roles public.app_role[],
  department_name_fa text,
  department_name_en text,
  manager_name text
)
language sql
stable
security definer
set search_path = public, private
as $$
  with me as (
    select id, company_id, department_id, manager_id
    from public.profiles
    where id = auth.uid()
  )
  select
    p.id as profile_id,
    p.full_name,
    p.employee_code,
    case when p.id = me.manager_id then 'manager' else 'teammate' end as relation,
    coalesce(
      array_agg(ur.role order by ur.role) filter (where ur.role is not null),
      array[]::public.app_role[]
    ) as roles,
    d.name_fa as department_name_fa,
    d.name_en as department_name_en,
    mgr.full_name as manager_name
  from me
  join public.profiles p
    on p.company_id = me.company_id
   and p.active = true
   and p.id <> me.id
   and (
     p.id = me.manager_id
     or (me.department_id is not null and p.department_id = me.department_id)
   )
  left join public.user_roles ur on ur.user_id = p.id
  left join public.departments d on d.id = p.department_id
  left join public.profiles mgr on mgr.id = p.manager_id
  group by
    p.id,
    p.full_name,
    p.employee_code,
    me.manager_id,
    d.name_fa,
    d.name_en,
    mgr.full_name
  order by
    case when p.id = me.manager_id then 0 else 1 end,
    p.full_name;
$$;

revoke execute on function public.get_my_team_directory() from public, anon;
grant execute on function public.get_my_team_directory() to authenticated;
