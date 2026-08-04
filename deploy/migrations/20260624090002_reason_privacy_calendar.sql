-- =============================================================================
-- Migration: 20260624090002_reason_privacy_calendar.sql
-- Purpose  : FR-25 — a leave request's free-text `reason` is private.
--   1) Tighten leave_requests SELECT so teammates can no longer read full rows
--      (which include `reason`). Full-row read = own | manager-of | security | admin.
--   2) Expose a reason-LESS view `team_leave_calendar` for the team/company
--      calendar, scoped own | same_team | can_read_all, approved+pending only.
-- Depends  : 20260623120005_leave.sql      (leave_requests, leave_types)
--            20260623120002_rls_helpers.sql (private.is_manager_of, has_role,
--                                            is_admin, same_team, can_read_all)
-- =============================================================================

-- 1. Tighten full-row read on leave_requests (strict reason scope, FR-25).
--    Was: own | same_team | can_read_all  (same_team exposed `reason` to peers).
--    Now: own | manager-of(employee) | security | admin. Teammates read the
--    reason-less view below instead; managers see reasons only for their own
--    reports (not other teams').
drop policy if exists "leave_requests_select" on public.leave_requests;
create policy "leave_requests_select"
  on public.leave_requests for select to authenticated
  using (
    employee_id = auth.uid()
    or private.is_manager_of(auth.uid(), employee_id)
    or private.has_role(auth.uid(), 'security')
    or private.is_admin(auth.uid())
  );

-- 2. Reason-less calendar view (teammates get dates + status, never `reason`).
--    Intentionally a SECURITY DEFINER view: it is created WITHOUT
--    `security_invoker`, so it runs as the owner and bypasses the (now strict)
--    base-table RLS — required so a teammate can still see their team's leave
--    via `same_team`. The scoping is re-implemented in the WHERE clause, and
--    `reason` (the protected column) is simply not selected. Access is locked
--    to `authenticated` (anon revoked). The Supabase advisor flags this as lint
--    0010 (security_definer_view); ACCEPTED BY DESIGN — the WHERE clause is the
--    gate and no sensitive column is exposed (same rationale as PERMISSIONS.md
--    lint-0029 acceptance).
create or replace view public.team_leave_calendar as
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
    lr.requested_days,
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
