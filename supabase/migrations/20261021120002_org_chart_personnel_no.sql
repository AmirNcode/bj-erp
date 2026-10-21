-- FR-44 (2026-10-21): the org chart shows each person's personnel number.
--
-- Owner request: cards read "<name> - <personnel no>". This widens owner
-- decision D8 — get_org_chart() now gives every signed-in colleague in the
-- company the personnel number too (still no roles, hire date, balances or
-- leave data). The return type changes, so drop and recreate; PostgREST
-- returns every column, so the still-running old app ignores the new one.

drop function public.get_org_chart();

create function public.get_org_chart()
returns table (
  profile_id            uuid,
  full_name             text,
  job_title             text,
  department_id         uuid,
  department_name_fa    text,
  department_name_en    text,
  manager_id            uuid,
  is_department_manager boolean,
  personnel_no          text
)
language sql stable security definer
set search_path = ''
as $$
  with me as (
    select company_id
      from public.profiles
     where id = auth.uid()
       and active
  )
  select
    p.id,
    p.full_name,
    p.job_title,
    p.department_id,
    d.name_fa,
    d.name_en,
    case when m.active then p.manager_id end,
    exists (
      select 1 from public.departments dm
       where dm.manager_id = p.id and dm.company_id = p.company_id
    ),
    p.personnel_no
  from me
  join public.profiles p
    on p.company_id = me.company_id
   and p.active
  left join public.departments d on d.id = p.department_id
  left join public.profiles m on m.id = p.manager_id
  order by p.full_name;
$$;

revoke all on function public.get_org_chart() from public, anon;
grant execute on function public.get_org_chart() to authenticated;
