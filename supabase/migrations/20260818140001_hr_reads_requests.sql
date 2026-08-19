-- =============================================================================
-- Migration: 20260818140001_hr_reads_requests.sql
-- Purpose  : Let the `hr` role read every request's FULL base row — including
--            both signatures, the reason, the errand location and the decision
--            note — so HR can review and print the paper-equivalent form.
-- Requirement: FR-38 (amends FR-25)
-- Spec     : docs/specs/2026-08-18-hr-role-and-locale-persistence-design.md
-- Depends  : 20260818130001_hr_role_enum.sql
--
-- ── This deliberately widens FR-25 reason privacy. Read before changing. ─────
--
-- FR-25 says a request's free-text `reason` is private to the requester, their
-- direct manager, security and admin, because it can carry medical or personal
-- detail. This adds `hr` to that list. It is a real widening and it was asked
-- for explicitly by the owner on 2026-08-18.
--
-- It is also consistent with what already happens on paper. All three of the
-- client's forms — BJ-F 50210 (daily leave), 50208 (hourly leave) and 50207
-- (hourly errand) — carry a signature box for امور اداری و منابع انسانی, so an
-- HR officer physically holds the completed form, reason and all, today. This
-- migration lets the app match a process the client already runs, rather than
-- inventing new exposure.
--
-- Scope is still narrow: `hr` is a role an admin grants deliberately, it stays
-- READ-only here, and teammates continue to read the reason-less
-- `team_leave_calendar` view. FR-25 is unchanged for everyone who is not
-- requester / manager-of / security / admin / hr.
--
-- Idempotent: drop policy if exists + create. Safe to re-run.
-- =============================================================================

drop policy if exists "leave_requests_select" on public.leave_requests;
create policy "leave_requests_select"
  on public.leave_requests for select to authenticated
  using (
    private.is_active((select auth.uid()))
    and (
      employee_id = (select auth.uid())
      or private.is_manager_of((select auth.uid()), employee_id)
      or private.has_role((select auth.uid()), 'security')
      or private.is_admin((select auth.uid()))
      or private.has_role((select auth.uid()), 'hr')
    )
  );

comment on policy "leave_requests_select" on public.leave_requests is
  'Full base row: own, direct manager, security, admin, hr (FR-38). Teammates read the reason-less team_leave_calendar view instead — FR-25.';

-- `team_leave_calendar` is untouched on purpose. It is what protects everyone
-- who is NOT on the list above, and adding a column to it would leak the reason
-- to every teammate. If you are here to widen HR's access further, widen the
-- policy above, never the view.
