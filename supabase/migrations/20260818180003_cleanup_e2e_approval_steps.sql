-- =============================================================================
-- Migration: 20260818180003_cleanup_e2e_approval_steps.sql
-- Purpose  : Let the e2e reaper delete a throwaway user who is named as an
--            approver, WITHOUT weakening the foreign key that protects real ones.
-- Requirement: FR-42 (follow-up)
-- Spec     : docs/specs/2026-08-18-holidays-weekends-approvers-design.md Part 4
-- Depends  : 20260818180001_approval_steps_person.sql (approval_steps.approver_id)
--            20260702140000_e2e_cleanup_fn.sql (app_cleanup_e2e_users)
--
-- ── Why this exists ─────────────────────────────────────────────────────────
--
-- `approval_steps.approver_id` references `profiles(id)` with NO on-delete
-- action, deliberately: `on delete cascade` would silently drop a required
-- approval step when someone's profile went away, and `on delete set null` would
-- silently turn a step reserved for one named person into one anybody with that
-- role could fill. Both are worse than refusing the delete.
--
-- The cost showed up immediately, and in the test suite rather than in review:
--
--   cleanup-e2e: RPC failed: update or delete on table "profiles" violates
--   foreign key constraint "approval_steps_approver_id_fkey"
--
-- `app_cleanup_e2e_users()` hard-deletes throwaway accounts. A spec that names
-- one of them in a step and then fails before its own cleanup leaves a row that
-- blocks the reaper — for that run AND every run afterwards, since the junk
-- account never goes away. That is a trap, not a one-off.
--
-- The fix is to make the reaper aware of the dependency rather than to weaken the
-- constraint: production keeps "a named approver cannot be silently deleted",
-- and the reaper explicitly removes the steps belonging to the accounts it is
-- about to delete. Which is the honest description of what a test reaper does.
--
-- Idempotent: create or replace. Safe to re-run.
-- =============================================================================

create or replace function public.app_cleanup_e2e_users()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
  v_steps integer;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not private.is_admin(v_uid) then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  -- The junk predicate, unchanged from 20260702140000. Kept verbatim rather than
  -- factored out: it is the whole safety boundary of this function, and both
  -- shapes matter (see DATA_MODEL — codes before and after the prefix change).
  create temp table if not exists _e2e_junk on commit drop as
    select id from public.profiles
    where employee_code ~ '^(mgr|emp|cxl|auth|peer|lv|non|ov|e2e|set)[0-9]{13}$'
       or employee_code ~ '^(set|pwd)[0-9]{6}$'
       or employee_code ~ '^[a-z0-9]{2,6}-999[0-9]{7}$'
       or employee_code ~ '^999[0-9]{7}$';

  -- FR-42: drop approval steps naming one of these accounts first, or the
  -- foreign key refuses the delete below. Scoped to junk ids only — a step
  -- naming a real employee is never touched.
  delete from public.approval_steps s
   using _e2e_junk j
   where s.approver_id = j.id;
  get diagnostics v_steps = row_count;

  with del as (
    delete from auth.users u using _e2e_junk j where u.id = j.id returning u.id
  )
  select count(*) into v_count from del;

  if v_count > 0 or v_steps > 0 then
    insert into public.audit_log (actor_id, action, entity, entity_id, after)
    values (v_uid, 'cleanup_e2e_users', 'auth.users', null,
            jsonb_build_object('deleted', v_count, 'approval_steps_removed', v_steps));
  end if;

  return v_count;
end;
$$;

revoke all on function public.app_cleanup_e2e_users() from public;
revoke all on function public.app_cleanup_e2e_users() from anon;
grant execute on function public.app_cleanup_e2e_users() to authenticated;
