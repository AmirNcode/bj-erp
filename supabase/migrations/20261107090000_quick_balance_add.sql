-- FR-85: HR adds time to a leave balance with a reason. `quick_add` marks these rows
-- (special leave and hand edits are `adjustment` too); `created_by` lets the history
-- say who changed a balance, since HR cannot read audit_log.

alter table public.leave_ledger
  add column quick_add boolean not null default false,
  add column created_by uuid references public.profiles(id) on delete set null;

comment on column public.leave_ledger.quick_add is
  'FR-85: added by HR with a reason (note). Drives the balance breakdown on Edit Employee.';
comment on column public.leave_ledger.created_by is
  'FR-85: who made a manual change. Null on older and automatic rows.';

create or replace function public.set_leave_balance(p_employee_id uuid, p_leave_type_id uuid, p_target_minutes integer) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_current int;
  v_ledger uuid;
begin
  -- FR-43, FR-55: admin, or leave_balances at Allowed. HR administers leave, so the
  -- two screens that set an opening balance and an accrual policy are theirs as well.
  if not (private.is_admin(auth.uid()) or private.has_perm(auth.uid(), 'leave_balances', 'edit')) then
    raise exception 'only admins or hr can set leave balance' using errcode = '42501';
  end if;
  -- ...but nobody except an admin does it to THEMSELVES. Same asymmetry FR-36
  -- already applies to signing your own request: an admin is the owner and may,
  -- an HR officer granting themselves leave is an obvious control weakness.
  if not private.is_admin(auth.uid()) and p_employee_id = auth.uid() then
    raise exception 'you cannot change your own leave balance' using errcode = '42501';
  end if;
  -- FR-55 D4: and only on someone who holds nothing the caller lacks.
  if not private.is_admin(auth.uid()) and not private.can_act_on(auth.uid(), p_employee_id) then
    raise exception 'not allowed to change this employee''s leave' using errcode = '42501';
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

  insert into public.leave_ledger(employee_id, leave_type_id, entry_type, delta_minutes, balance_after_minutes, note, created_by)
  values (p_employee_id, p_leave_type_id, 'adjustment', p_target_minutes - v_current, p_target_minutes, 'admin balance set', auth.uid())
  returning id into v_ledger;

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (auth.uid(), 'set_leave_balance', 'leave_ledger', v_ledger,
          jsonb_build_object('employee_id', p_employee_id, 'leave_type_id', p_leave_type_id,
                             'previous_minutes', v_current, 'target_minutes', p_target_minutes));

  return p_target_minutes;
end; $$;

create function public.app_add_leave_balance(
  p_employee_id uuid, p_leave_type_id uuid, p_minutes integer, p_reason text
) returns integer
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  v_uid uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_company uuid;
  v_current int;
  v_ledger uuid;
begin
  -- The same three gates as set_leave_balance, in the same order.
  if not (private.is_admin(v_uid) or private.has_perm(v_uid, 'leave_balances', 'edit')) then
    raise exception 'only admins or hr can set leave balance' using errcode = '42501';
  end if;
  if not private.is_admin(v_uid) and p_employee_id = v_uid then
    raise exception 'you cannot change your own leave balance' using errcode = '42501';
  end if;
  if not private.is_admin(v_uid) and not private.can_act_on(v_uid, p_employee_id) then
    raise exception 'not allowed to change this employee''s leave' using errcode = '42501';
  end if;

  select company_id into v_company from public.profiles where id = p_employee_id;
  if p_minutes is null or p_minutes <= 0 then
    raise exception 'amount must be more than 0' using errcode = '22023';
  end if;
  if p_minutes > 366 * private.company_minutes_per_day(v_company) then
    raise exception 'amount is too large' using errcode = '22023';
  end if;
  if v_reason = '' then raise exception 'a reason is required' using errcode = '22023'; end if;
  if char_length(v_reason) > 500 then raise exception 'reason is too long' using errcode = '22023'; end if;
  if not exists (select 1 from public.leave_types
                  where id = p_leave_type_id and company_id = v_company and affects_balance) then
    raise exception 'this leave type has no balance' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('leave:' || p_employee_id::text, 0));
  v_current := public.current_leave_balance(p_employee_id, p_leave_type_id);

  insert into public.leave_ledger(employee_id, leave_type_id, entry_type, delta_minutes,
                                  balance_after_minutes, note, quick_add, created_by)
  values (p_employee_id, p_leave_type_id, 'adjustment', p_minutes,
          v_current + p_minutes, v_reason, true, v_uid)
  returning id into v_ledger;

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (v_uid, 'leave_balance.add', 'leave_ledger', v_ledger,
          jsonb_build_object('employee_id', p_employee_id, 'leave_type_id', p_leave_type_id,
                             'previous_minutes', v_current, 'added_minutes', p_minutes));

  return v_current + p_minutes;
end $$;

revoke all on function public.app_add_leave_balance(uuid, uuid, integer, text) from public, anon;
grant execute on function public.app_add_leave_balance(uuid, uuid, integer, text) to authenticated, service_role;
