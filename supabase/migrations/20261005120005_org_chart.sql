-- =============================================================================
-- Migration: 20261005120005_org_chart.sql
-- Purpose  : Read model for the Organization tab — every active colleague with
--            their manager link, for every signed-in user.
-- Requirement: FR-44 (spec docs/specs/2026-10-05-org-chart-and-personnel-import-design.md §1)
-- Depends  : profiles, departments
--
-- Owner decision D8: everyone can browse the org chart. Plain employees cannot
-- read other profiles through RLS (only own / direct reports / can_read_all), so
-- this is a SECURITY DEFINER function — the same pattern as
-- get_my_team_directory(). It WIDENS NOTHING beyond names, job titles,
-- departments and who reports to whom: no personnel number, roles, hire date,
-- balance or leave data, so nothing a request card or the My Team card does not
-- already show.
--
-- Scoped to the caller's company and to ACTIVE people. A manager who has been
-- deactivated is hidden, and their reports surface as roots (manager_id NULL)
-- rather than hanging off someone nobody can see.
--
-- Idempotent: create or replace.
-- =============================================================================

create or replace function public.get_org_chart()
returns table (
  profile_id            uuid,
  full_name             text,
  job_title             text,
  department_id         uuid,
  department_name_fa    text,
  department_name_en    text,
  manager_id            uuid,
  is_department_manager boolean
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
    )
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
