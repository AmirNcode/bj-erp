-- =============================================================================
-- Migration: 20260729130011_leave_replacement.sql
-- Purpose  : The replacement/cover person (spec §8) — جانشین on the client's daily
--            form, جایگزین on the hourly one. Column + the two reads; the write
--            guard is …130012.
--
-- Availability uses the SAME time-aware predicate as the overlap rule (§7.4): a
-- candidate's whole-day leave always conflicts, hourly-vs-hourly only when the
-- times intersect. If this predicate and the one in the write guard ever drift,
-- the UI will offer someone the server then rejects.
--
-- Idempotent. Postgres 15. Apply as supabase_admin.
-- =============================================================================

alter table public.leave_requests
  add column if not exists replacement_id uuid references public.profiles(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'leave_requests_replacement_not_self') then
    alter table public.leave_requests
      add constraint leave_requests_replacement_not_self
      check (replacement_id is null or replacement_id <> employee_id);
  end if;
end $$;

-- Powers "you are covering X" on Home.
create index if not exists leave_requests_replacement_idx
  on public.leave_requests (replacement_id, start_date)
  where replacement_id is not null;

-- ---------------------------------------------------------------------------
-- get_replacement_candidates — the caller's own department, annotated.
--
-- Returns EVERY eligible colleague with an availability flag rather than a
-- filtered list: a worker who cannot find their intended cover should be told
-- "on leave", not left staring at an unexplained gap.
--
-- Takes no employee or department argument, so it cannot be pointed at another
-- team; the scope is auth.uid()'s own department.
-- ---------------------------------------------------------------------------
create or replace function public.get_replacement_candidates(
  p_start      date,
  p_end        date,
  p_unit       public.leave_unit default 'day',
  p_start_time time             default null,
  p_end_time   time             default null
) returns table (
  profile_id        uuid,
  full_name         text,
  employee_code     text,
  unavailable       boolean,
  unavailable_reason text
)
language sql stable security definer set search_path = '' as $$
  with me as (
    select id, company_id, department_id from public.profiles where id = auth.uid()
  )
  select
    p.id,
    p.full_name,
    p.employee_code,
    exists (
      select 1 from public.leave_requests r
       where r.employee_id = p.id
         and r.status in ('pending', 'approved')
         and r.start_date <= p_end
         and r.end_date >= p_start
         and (
           r.unit = 'day' or p_unit = 'day'
           or (r.start_time < p_end_time and r.end_time > p_start_time)
         )
    ) as unavailable,
    case when exists (
      select 1 from public.leave_requests r
       where r.employee_id = p.id
         and r.status in ('pending', 'approved')
         and r.start_date <= p_end
         and r.end_date >= p_start
         and (
           r.unit = 'day' or p_unit = 'day'
           or (r.start_time < p_end_time and r.end_time > p_start_time)
         )
    ) then 'on leave' else null end as unavailable_reason
  from me
  join public.profiles p
    on p.company_id = me.company_id
   and p.active
   and p.id <> me.id
   and me.department_id is not null
   and p.department_id = me.department_id
  order by p.full_name;
$$;

revoke execute on function public.get_replacement_candidates(date, date, public.leave_unit, time, time)
  from public, anon;
grant  execute on function public.get_replacement_candidates(date, date, public.leave_unit, time, time)
  to authenticated;

-- ---------------------------------------------------------------------------
-- get_my_cover_conflicts — requests the CALLER is named cover for, in a window.
--
-- Powers the reverse-case warning (spec §2.1). It returns rows; the caller
-- decides to warn. Being someone's cover never blocks your own leave.
-- ---------------------------------------------------------------------------
create or replace function public.get_my_cover_conflicts(p_start date, p_end date)
returns table (
  request_id    uuid,
  employee_name text,
  start_date    date,
  end_date      date,
  unit          public.leave_unit,
  start_time    time,
  end_time      time
)
language sql stable security definer set search_path = '' as $$
  select r.id, p.full_name, r.start_date, r.end_date, r.unit, r.start_time, r.end_time
    from public.leave_requests r
    join public.profiles p on p.id = r.employee_id
   where r.replacement_id = auth.uid()
     and r.status in ('pending', 'approved')
     and r.start_date <= p_end
     and r.end_date >= p_start
   order by r.start_date;
$$;

revoke execute on function public.get_my_cover_conflicts(date, date) from public, anon;
grant  execute on function public.get_my_cover_conflicts(date, date) to authenticated;
