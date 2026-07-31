-- =============================================================================
-- Migration: 20260729130010_calendar_hourly.sql
-- Purpose  : Expose unit + times on team_leave_calendar so a two-hour absence
--            does not render to teammates as a whole day off.
--
-- FR-25 unchanged and deliberately so: this view still selects an EXPLICIT column
-- list, and `reason` / `decision_note` are still absent. Do not add them.
-- Still created WITHOUT security_invoker, so it runs as owner and bypasses the
-- strict base-table RLS — the scoping is the WHERE clause (20260624090002).
--
-- Idempotent. Postgres 15. Apply as supabase_admin.
-- =============================================================================

drop view if exists public.team_leave_calendar;

create view public.team_leave_calendar as
  select
    lr.id,
    lr.employee_id,
    p.full_name      as employee_name,
    p.department_id,
    lr.leave_type_id,
    lt.name_fa       as leave_type_name_fa,
    lt.name_en       as leave_type_name_en,
    lt.color         as leave_type_color,
    lr.start_date,
    lr.end_date,
    lr.day_part,
    lr.unit,
    lr.start_time,
    lr.end_time,
    lr.requested_minutes,
    lr.status
  from public.leave_requests lr
  join public.profiles    p  on p.id  = lr.employee_id
  join public.leave_types lt on lt.id = lr.leave_type_id
  where lr.status in ('pending', 'approved')
    and (
      lr.employee_id = auth.uid()
      or private.same_team(auth.uid(), lr.employee_id)
      or private.can_read_all(auth.uid())
    );

revoke all    on public.team_leave_calendar from public, anon;
grant  select on public.team_leave_calendar to authenticated;
