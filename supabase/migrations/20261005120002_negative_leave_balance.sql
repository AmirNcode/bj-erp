-- =============================================================================
-- Migration: 20261005120002_negative_leave_balance.sql
-- Purpose  : HR / admin may set a NEGATIVE leave balance.
-- Requirement: FR-48 (spec docs/specs/2026-10-05-org-chart-and-personnel-import-design.md §5)
-- Depends  : 20260819120001_hr_manages_leave_setup.sql (current set_leave_balance)
--
-- The client's personnel list carries balances like "منفی 1 روز و 4 ساعت":
-- leave already taken in advance. HR corrects individual balances after rollout,
-- so the balance editor must accept them.
--
-- Already safe without change (verified in schema.sql):
--   * approve_leave_request pays least(minutes, greatest(balance, 0)), so a
--     request against a balance at or below zero is recorded entirely as unpaid;
--   * accrual's carry-over forfeit only fires when balance > cap;
--   * the annual cap counts accruals, not the balance.
--
-- Body is the live definition from supabase/schema.sql with only the guard
-- replaced. Idempotent: create or replace, unchanged signature.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.set_leave_balance(p_employee_id uuid, p_leave_type_id uuid, p_target_minutes integer) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_current int;
  v_ledger uuid;
begin
  -- FR-43: admin OR hr. HR administers leave, so the two screens that set an
  -- opening balance and an accrual policy are theirs as well.
  if not (private.is_admin(auth.uid()) or private.has_role(auth.uid(), 'hr')) then
    raise exception 'only admins or hr can set leave balance' using errcode = '42501';
  end if;
  -- ...but nobody except an admin does it to THEMSELVES. Same asymmetry FR-36
  -- already applies to signing your own request: an admin is the owner and may,
  -- an HR officer granting themselves leave is an obvious control weakness.
  if not private.is_admin(auth.uid()) and p_employee_id = auth.uid() then
    raise exception 'you cannot change your own leave balance' using errcode = '42501';
  end if;

  -- FR-48: a balance may be negative (leave taken in advance). Bounded at one
  -- year of workdays below zero so a typo cannot post an absurd debit.
  if p_target_minutes is null
     or p_target_minutes < -366 * private.company_minutes_per_day(
          (select company_id from public.profiles where id = p_employee_id)) then
    raise exception 'target balance is out of range' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('leave:' || p_employee_id::text, 0));

  v_current := public.current_leave_balance(p_employee_id, p_leave_type_id);

  if v_current = p_target_minutes then
    return p_target_minutes;
  end if;

  insert into public.leave_ledger(employee_id, leave_type_id, entry_type, delta_minutes, balance_after_minutes, note)
  values (p_employee_id, p_leave_type_id, 'adjustment', p_target_minutes - v_current, p_target_minutes, 'admin balance set')
  returning id into v_ledger;

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (auth.uid(), 'set_leave_balance', 'leave_ledger', v_ledger,
          jsonb_build_object('employee_id', p_employee_id, 'leave_type_id', p_leave_type_id,
                             'previous_minutes', v_current, 'target_minutes', p_target_minutes));

  return p_target_minutes;
end; $$;
