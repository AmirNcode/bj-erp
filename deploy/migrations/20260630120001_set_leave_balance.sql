-- =============================================================================
-- Migration: 20260630120001_set_leave_balance.sql
-- Purpose  : Admin sets an employee's CURRENT leave balance for a type to an
--            absolute target, via an 'adjustment' ledger row (auditable). Used
--            by the employee edit page. Additive grants still go through
--            allocate_leave.
-- =============================================================================

create or replace function public.set_leave_balance(
  p_employee_id uuid,
  p_leave_type_id uuid,
  p_target numeric
) returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current numeric;
  v_ledger uuid;
begin
  if not private.is_admin(auth.uid()) then
    raise exception 'only admins can set leave balance' using errcode = '42501';
  end if;

  if p_target is null or p_target < 0 then
    raise exception 'target balance must be >= 0' using errcode = '22023';
  end if;

  v_current := public.current_leave_balance(p_employee_id, p_leave_type_id);

  if v_current = p_target then
    return p_target;
  end if;

  insert into public.leave_ledger(
    employee_id,
    leave_type_id,
    entry_type,
    delta_days,
    balance_after,
    note
  )
  values (
    p_employee_id,
    p_leave_type_id,
    'adjustment',
    p_target - v_current,
    p_target,
    'admin balance set'
  )
  returning id into v_ledger;

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (
    auth.uid(),
    'set_leave_balance',
    'leave_ledger',
    v_ledger,
    jsonb_build_object(
      'employee_id', p_employee_id,
      'leave_type_id', p_leave_type_id,
      'previous', v_current,
      'target', p_target
    )
  );

  return p_target;
end;
$$;

revoke execute on function public.set_leave_balance(uuid, uuid, numeric) from public, anon;
grant execute on function public.set_leave_balance(uuid, uuid, numeric) to authenticated;
