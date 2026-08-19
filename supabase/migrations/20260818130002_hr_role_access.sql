-- =============================================================================
-- Migration: 20260818130002_hr_role_access.sql
-- Purpose  : Give the 'hr' role company-wide READ access.
-- Requirement: FR-35
-- Spec     : docs/specs/2026-08-18-hr-role-and-locale-persistence-design.md
-- Depends  : 20260818130001_hr_role_enum.sql (must already be committed — see
--            the warning in that file about using a new enum value)
--
-- This migration is deliberately tiny, and that is the point. HR needs to read
-- every employee's profile, requests, ledger, allocations and accrual policy in
-- order to co-sign requests (FR-36) and run reports (FR-37). Every one of those
-- read paths already routes through `private.can_read_all`:
--
--   profiles_select · user_roles_select · leave_ledger_select
--   leave_allocations_select · employee_leave_policies_select
--   team_leave_calendar (the definer view behind the calendar)
--
-- so widening that one helper is the whole change. No new policy is created and
-- no existing policy is edited.
--
-- What this does NOT grant, deliberately:
--   * `leave_requests` full base-row SELECT is its own policy naming admin,
--     security, and is_manager_of explicitly — HR is added there in the batch
--     that makes HR an approver (FR-36), not here. Until then HR sees requests
--     through the reason-less calendar view like everyone else, so FR-25 reason
--     privacy is not quietly widened ahead of the feature that needs it.
--   * No write access anywhere. Creating employees is a separate, guarded RPC
--     path (FR-35 part 2); company configuration stays admin-only.
--
-- Idempotent: create or replace. Safe to re-run.
-- =============================================================================

create or replace function private.can_read_all(uid uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select private.is_admin(uid)
      or private.has_role(uid, 'manager')
      or private.has_role(uid, 'security')
      or private.has_role(uid, 'hr');
$$;

comment on function private.can_read_all(uuid) is
  'Broad-read predicate: admin, manager, security, or hr. Write access is never implied — managers write only to direct reports, and hr writes only through guarded RPCs. FR-17/FR-18/FR-35.';

-- `has_role` already requires an ACTIVE profile (20260730120001), so a
-- deactivated HR account loses this the moment it is switched off. Asserted
-- here rather than assumed, because the whole role rests on it.
do $$
begin
  if not exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private' and p.proname = 'has_role'
       and pg_get_functiondef(p.oid) like '%is_active%'
  ) then
    raise exception 'private.has_role no longer enforces is_active; hr access would survive deactivation';
  end if;
end $$;
