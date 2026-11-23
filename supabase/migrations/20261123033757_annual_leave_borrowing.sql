-- Borrowing is a personal entitlement. No role receives an automatic grant.
CREATE OR REPLACE FUNCTION private.permission_keys() RETURNS SETOF text
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select unnest(array['people','people_create','reset_employee_password','role_manager','role_assign',
    'personal_info','personal_info_own','clearance','departments','leave_balances','leave_accrual',
    'annual_leave_borrow','special_leave','leave_requests','calendar','reports','approval_steps','approval_delegate',
    'work_settings','holidays','finance','finance_forms','travel_booking',
    'edit_leave_daily','edit_leave_hourly','edit_errand_daily','edit_errand_hourly','edit_requests_own',
    'sales','sales_prices','sales_bonds','sales_decide','sales_reports','sales_settings','project_items']);
$$;

CREATE OR REPLACE FUNCTION private.permission_allows(p_key text, p_level text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select case
    when p_key in ('people_create','reset_employee_password','role_manager','role_assign','leave_accrual',
      'personal_info_own','annual_leave_borrow','special_leave','approval_delegate','travel_booking',
      'edit_leave_daily','edit_leave_hourly','edit_errand_daily','edit_errand_hourly',
      'edit_requests_own','sales_decide','sales_settings') then p_level = 'edit'
    when p_key in ('calendar','reports','finance','finance_forms','sales_reports') then p_level = 'read'
    when p_key in ('people','personal_info','clearance','departments','leave_balances',
      'leave_requests','approval_steps','work_settings','holidays',
      'sales','sales_prices','sales_bonds','project_items') then p_level in ('read','edit')
    else false end;
$$;

CREATE OR REPLACE FUNCTION private.perm_level(uid uuid, p_key text) RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  -- Ignores `active` on purpose: a deactivated holder keeps their latent levels,
  -- so someone weaker cannot reactivate them (D4). Callers add is_active.
  select case
    when p_key <> 'annual_leave_borrow' and exists (select 1 from public.user_roles where user_id = uid and role = 'admin') then
      case when private.permission_allows(p_key, 'edit') then 2
           when private.permission_allows(p_key, 'read') then 1 else 0 end
    else coalesce((
      select max(case rp.level when 'edit' then 2 else 1 end)
        from public.user_roles ur
        join public.role_permissions rp on rp.role_id = ur.role_id
       where ur.user_id = uid and rp.permission = p_key
         and private.permission_allows(rp.permission, rp.level)), 0)
  end;
$$;

CREATE OR REPLACE FUNCTION private.balance_rule(p_employee uuid, p_leave_type uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select case
    when lt.id is null or not lt.affects_balance then 'none'
    when lt.manager_overdraft and private.has_perm(p_employee, 'annual_leave_borrow', 'edit') then 'overdraft'
    when lt.manager_overdraft then 'strict'
    else 'split'
  end
  from (select 1) one left join public.leave_types lt on lt.id = p_leave_type;
$$;

CREATE OR REPLACE FUNCTION private.finalize_approval_request(p_id uuid, p_actor uuid, p_signature text, p_consent_at timestamp with time zone, p_origin text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare r public.leave_requests%rowtype; v_affects boolean; v_is_paid boolean;
  v_rule text; v_prev integer:=0; v_paid integer:=0; v_unpaid integer:=0;
begin
  select * into r from public.leave_requests where id=p_id;
  perform private.approval_lock(r.company_id);
  perform pg_advisory_xact_lock(hashtextextended('leave:'||r.employee_id::text,0));
  select * into r from public.leave_requests where id=p_id for update;
  if r.status<>'pending' then return false; end if;
  if exists (select 1 from public.approval_steps s where private.request_step_applies(p_id,s.id)
    and not private.request_step_decided(p_id,s.id,'approved')) then return false; end if;
  if exists (select 1 from public.leave_requests lr where lr.employee_id=r.employee_id and lr.id<>r.id
    and lr.status='approved' and lr.start_date<=r.end_date and lr.end_date>=r.start_date
    and not (lr.kind = 'leave' and lr.unit = 'hour' and r.kind = 'errand')
    and not (r.kind = 'leave' and r.unit = 'hour' and lr.kind = 'errand')
    and (lr.unit='day' or r.unit='day' or (lr.start_time<r.end_time and lr.end_time>r.start_time))) then
    raise exception 'overlapping approved leave exists' using errcode='22023'; end if;
  if r.replacement_id is not null and private.replacement_is_away(r.replacement_id,r.start_date,r.end_date,
    r.unit,r.start_time,r.end_time) then raise exception 'replacement is on leave during this period' using errcode='22023'; end if;
  select affects_balance,is_paid into v_affects,v_is_paid from public.leave_types where id=r.leave_type_id;
  if v_affects then
    v_prev:=public.current_leave_balance(r.employee_id,r.leave_type_id);
    v_rule := private.balance_rule(r.employee_id, r.leave_type_id);
    if v_rule = 'strict' and r.requested_minutes > 0 and r.requested_minutes >
        v_prev - private.pending_leave_minutes(r.employee_id, r.leave_type_id, r.id) then
      raise exception 'request exceeds available balance' using errcode = '22023';
    end if;
    if v_rule in ('overdraft', 'strict') then
      v_paid:=r.requested_minutes; v_unpaid:=0;
    else
      v_paid:=least(r.requested_minutes,greatest(v_prev,0)); v_unpaid:=r.requested_minutes-v_paid;
    end if;
  elsif r.leave_type_id is not null and not coalesce(v_is_paid,false) then v_unpaid:=r.requested_minutes; end if;
  update public.leave_requests set status='approved',unpaid_minutes=v_unpaid,decided_by=p_actor,
    decided_at=clock_timestamp(),approver_signature_data=p_signature,
    approver_signature_consent_at=case when p_signature is null then null else p_consent_at end
    where id=p_id and status='pending';
  if not found then return false; end if;
  if v_affects and v_paid>0 then
    insert into public.leave_ledger(employee_id,leave_type_id,request_id,entry_type,delta_minutes,balance_after_minutes,note)
    values(r.employee_id,r.leave_type_id,p_id,'consumption',-v_paid,v_prev-v_paid,case when v_rule = 'overdraft' then 'consumed on approval (annual leave borrowing)' else 'paid portion consumed on approval' end);
  end if;
  insert into public.audit_log(actor_id,action,entity,entity_id,after) values
    (p_actor,'approve_leave_request','leave_requests',p_id,jsonb_build_object('employee_id',r.employee_id,
      'requested_minutes',r.requested_minutes,'paid_minutes',v_paid,'unpaid_minutes',v_unpaid,
      'replacement_id',r.replacement_id,'origin',p_origin));
  return true;
end; $$;

CREATE OR REPLACE FUNCTION private.edit_request_impl(p_uid uuid, p_request uuid, p_unit public.leave_unit, p_start date, p_end date, p_day_part public.day_part, p_start_time time without time zone, p_end_time time without time zone, p_per_diem_rials bigint, p_reason text, p_signature_data text, p_signature_authorized boolean) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_part public.day_part := coalesce(p_day_part, 'full');
  r public.leave_requests%rowtype;
  lt public.leave_types%rowtype;
  v_per_diem bigint;
  v_by_requester boolean;
  v_minutes integer;
  v_unpaid integer;
  v_shape_changed boolean;
  v_dates_changed boolean;
  v_balance integer;
  v_rule text;
  v_old_paid integer;
  v_new_paid integer;
  v_delta integer := 0;
  v_win_start time;
  v_win_end time;
  v_cap integer;
  v_day_used integer;
  v_net integer;
  v_now timestamptz;
  v_id uuid;
begin
  if p_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into r from public.leave_requests where id = p_request;
  if r.id is null then raise exception 'request not found' using errcode = 'P0002'; end if;
  if not private.can_edit_request(p_uid, p_request, p_unit) then
    raise exception 'not allowed to edit this request' using errcode = '42501';
  end if;
  if not coalesce(p_signature_authorized, false) or p_signature_data is null
     or p_signature_data !~ '^data:image/png;base64,[A-Za-z0-9+/]+=*$' then
    raise exception 'signature is required' using errcode = '22023';
  end if;
  if p_per_diem_rials < 0 then raise exception 'per diem must be 0 or more' using errcode = '22023'; end if;
  if v_reason = '' then raise exception 'a reason is required' using errcode = '22023'; end if;
  if char_length(v_reason) > 1000 then raise exception 'reason is too long' using errcode = '22023'; end if;

  -- Lock order: the company's approval lock, then the employee's leave lock.
  perform private.approval_lock(r.company_id);
  perform pg_advisory_xact_lock(hashtextextended('leave:' || r.employee_id::text, 0));
  select * into r from public.leave_requests where id = p_request for update;
  if r.id is null then raise exception 'request not found' using errcode = 'P0002'; end if;
  -- The gate again: roles, activity and the request itself may have changed while waiting.
  if not private.can_edit_request(p_uid, p_request, p_unit) then
    raise exception 'not allowed to edit this request' using errcode = '42501';
  end if;
  if r.status <> 'approved' then
    raise exception 'only an approved request can be edited' using errcode = '22023';
  end if;
  if r.kind = 'errand'
     and exists (select 1 from public.errand_extensions e where e.request_id = r.id and e.status = 'pending') then
    raise exception 'an extension is waiting for HR' using errcode = '22023';
  end if;

  -- Shape of the target.
  if p_unit is null or p_start is null or p_end is null then
    raise exception 'start and end dates are required' using errcode = '22023';
  end if;
  if p_end < p_start then
    raise exception 'start date must not be after end date' using errcode = '22023';
  end if;
  if p_end - p_start > 366 then
    raise exception 'date range too long' using errcode = '22023';
  end if;
  if p_unit = 'hour' then
    if p_start <> p_end or p_start_time is null or p_end_time is null or p_end_time <= p_start_time then
      raise exception 'end time must be after start time' using errcode = '22023';
    end if;
    if v_part <> 'full' then raise exception 'invalid request shape' using errcode = '22023'; end if;
  else
    if p_start_time is not null or p_end_time is not null
       or (r.kind = 'errand' and v_part <> 'full') then
      raise exception 'invalid request shape' using errcode = '22023';
    end if;
  end if;

  -- Per diem: only on a daily errand. null keeps it; a trip turned hourly loses it (FR-61).
  if r.kind = 'errand' and p_unit = 'day' then
    v_per_diem := coalesce(p_per_diem_rials, r.per_diem_rials);
  else
    v_per_diem := null;
  end if;
  v_by_requester := case when v_per_diem is distinct from r.per_diem_rials then false
                         else r.per_diem_by_requester end;

  if (p_unit, p_start, p_end, v_part, p_start_time, p_end_time, v_per_diem)
     is not distinct from (r.unit, r.start_date, r.end_date, r.day_part, r.start_time, r.end_time, r.per_diem_rials) then
    raise exception 'nothing to edit' using errcode = '22023';
  end if;
  v_shape_changed := (p_unit, p_start, p_end, v_part, p_start_time, p_end_time)
    is distinct from (r.unit, r.start_date, r.end_date, r.day_part, r.start_time, r.end_time);
  v_dates_changed := (p_start, p_end) is distinct from (r.start_date, r.end_date);

  v_minutes := r.requested_minutes;
  v_unpaid := r.unpaid_minutes;

  if v_shape_changed then
    if r.kind = 'errand' and r.unit = 'day' and p_unit = 'hour'
       and exists (select 1 from public.errand_extensions e where e.request_id = r.id and e.status = 'approved') then
      raise exception 'an extended trip cannot become an hourly errand' using errcode = '22023';
    end if;

    -- A trip becomes an hourly errand only while procurement has not started on it.
    if r.kind = 'errand' and r.unit = 'day' and p_unit = 'hour'
       and exists (select 1 from public.travel_bookings b
                    where b.request_id = r.id and (b.first_saved_at is not null or b.done_at is not null)) then
      raise exception 'procurement has started booking this trip' using errcode = '22023';
    end if;

    if r.kind = 'leave' then
      select * into lt from public.leave_types where id = r.leave_type_id;
    end if;

    -- Hourly leave: the rules of a new hourly request, the request itself excluded.
    if r.kind = 'leave' and p_unit = 'hour' then
      if r.unit = 'day' and not coalesce(lt.allow_hourly, false) then
        raise exception 'this leave type cannot be taken hourly' using errcode = '22023';
      end if;
      select work_start, work_end, max_hourly_minutes_per_day
        into v_win_start, v_win_end, v_cap
        from public.work_settings where company_id = r.company_id limit 1;
      v_win_start := coalesce(v_win_start, '07:00'::time);
      v_win_end := coalesce(v_win_end, '15:00'::time);
      v_cap := coalesce(v_cap, 240);
      if p_start_time < v_win_start or p_end_time > v_win_end then
        raise exception 'times must fall within working hours' using errcode = '22023';
      end if;
      -- FR-93: the cap counts net minutes (lunch break excluded).
      v_net := (extract(epoch from (p_end_time - p_start_time)) / 60)::int
               - private.lunch_overlap_minutes(r.company_id, p_start_time, p_end_time);
      if v_net > v_cap then
        raise exception 'hourly leave exceeds the daily limit' using errcode = '22023';
      end if;
      -- FR-93: a lunch-only (0-minute) request neither takes nor is blocked by the slot.
      if v_net > 0 and exists (
        select 1 from public.leave_requests x
         where x.employee_id = r.employee_id and x.id <> r.id
           and x.kind = 'leave' and x.unit = 'hour' and x.start_date = p_start
           and x.status in ('pending', 'approved')
           and x.requested_minutes > 0
      ) then
        raise exception 'only one hourly leave per day' using errcode = '22023';
      end if;
      select coalesce(sum(x.requested_minutes), 0) into v_day_used
        from public.leave_requests x
       where x.employee_id = r.employee_id and x.id <> r.id
         and x.kind = 'leave' and x.unit = 'hour' and x.start_date = p_start
         and x.status in ('pending', 'approved');
      if v_day_used + v_net > v_cap then
        raise exception 'hourly leave exceeds the daily limit' using errcode = '22023';
      end if;
    end if;

    -- No overlap with the person's other requests (the request's own old range does not count).
    if exists (
      select 1 from public.leave_requests x
       where x.employee_id = r.employee_id and x.id <> r.id
         and x.status in ('pending', 'approved')
         and x.start_date <= p_end and x.end_date >= p_start
         and not (x.kind = 'leave' and x.unit = 'hour' and r.kind = 'errand')
         and not (r.kind = 'leave' and p_unit = 'hour' and x.kind = 'errand')
         and (x.unit = 'day' or p_unit = 'day'
              or (x.start_time < p_end_time and x.end_time > p_start_time))
    ) or (r.kind = 'errand' and p_unit = 'day'
          and private.extension_overlaps(r.id, r.employee_id, p_start, p_end)) then
      raise exception 'overlapping leave request exists' using errcode = '22023';
    end if;

    v_minutes := public.compute_requested_minutes(
      r.company_id, p_start, p_end, v_part, p_unit, p_start_time, p_end_time, r.kind);
    if v_minutes <= 0
       -- FR-93: a lunch-only hourly leave on a working day deducts 0 and stays valid.
       and not (r.kind = 'leave' and p_unit = 'hour'
                and p_end_time > p_start_time
                and private.is_working_day(r.company_id, p_start)) then
      raise exception 'requested days must be greater than 0 (all days fall on weekend/holiday or dates invalid)'
        using errcode = '22023';
    end if;

    -- Balance. A new request may run past the balance; an edit may not create or grow an unpaid part.
    if r.kind = 'leave' then
      if lt.affects_balance then
        v_old_paid := r.requested_minutes - r.unpaid_minutes;
        v_balance := public.current_leave_balance(r.employee_id, r.leave_type_id);
        v_rule := private.balance_rule(r.employee_id, r.leave_type_id);
        if v_rule = 'overdraft' then
          v_new_paid := v_minutes;
          v_unpaid := 0;
        elsif v_rule = 'strict' then
          -- Preserve historical unpaid time on increases. Reductions remove unpaid time first.
          v_new_paid := least(v_minutes, v_old_paid) + greatest(v_minutes - r.requested_minutes, 0);
          if v_new_paid > v_old_paid and v_new_paid - v_old_paid >
              v_balance - private.pending_leave_minutes(r.employee_id, r.leave_type_id, r.id) then
            raise exception 'request exceeds available balance' using errcode = '22023';
          end if;
          v_unpaid := v_minutes - v_new_paid;
        else
          v_new_paid := least(v_minutes, greatest(v_balance, 0) + v_old_paid);
          v_unpaid := v_minutes - v_new_paid;
          if v_unpaid > r.unpaid_minutes then
            raise exception 'an edit cannot make leave unpaid' using errcode = '22023';
          end if;
        end if;
        v_delta := v_old_paid - v_new_paid;   -- > 0 returns time, < 0 takes it
      elsif not coalesce(lt.is_paid, false) then
        v_unpaid := v_minutes;
      else
        v_unpaid := 0;
      end if;
    else
      v_unpaid := 0;
    end if;
  end if;

  v_now := clock_timestamp();
  insert into public.request_corrections (
    request_id, company_id, old_start_date, new_start_date, old_end_date, new_end_date,
    per_diem_before, per_diem_after, reason, corrected_by, corrected_at,
    signature_data, signature_consent_at,
    old_unit, new_unit, old_day_part, new_day_part,
    old_start_time, new_start_time, old_end_time, new_end_time, minutes_before, minutes_after
  ) values (
    r.id, r.company_id, r.start_date, p_start, r.end_date, p_end,
    r.per_diem_rials, v_per_diem, v_reason, p_uid, v_now,
    p_signature_data, v_now,
    r.unit, p_unit, r.day_part, v_part,
    r.start_time, p_start_time, r.end_time, p_end_time, r.requested_minutes, v_minutes
  ) returning id into v_id;

  update public.leave_requests
     set start_date = p_start, end_date = p_end, unit = p_unit, day_part = v_part,
         start_time = p_start_time, end_time = p_end_time,
         requested_minutes = v_minutes, unpaid_minutes = v_unpaid,
         per_diem_rials = v_per_diem, per_diem_by_requester = v_by_requester
   where id = r.id;

  if v_delta <> 0 then
    insert into public.leave_ledger(employee_id, leave_type_id, request_id, entry_type,
                                    delta_minutes, balance_after_minutes, note)
    values (r.employee_id, r.leave_type_id, r.id,
            (case when v_delta < 0 then 'consumption' else 'reversal' end)::public.ledger_entry,
            v_delta, v_balance + v_delta, 'request edited');
  end if;

  -- Procurement: a daily trip whose dates moved goes back to the booking list; a trip that became
  -- an hourly errand leaves it (its booking, if any, had not started).
  if r.kind = 'errand' and r.unit = 'day' and p_unit = 'day' and v_dates_changed then
    update public.travel_bookings set done_at = null, done_by = null, updated_at = now()
     where request_id = r.id and opened_at is not null;
  elsif r.kind = 'errand' and r.unit = 'day' and p_unit = 'hour' then
    delete from public.travel_bookings where request_id = r.id;
  end if;

  -- Values only; never the signature.
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (p_uid, 'request.edit', 'leave_requests', r.id,
          jsonb_build_object('unit', r.unit, 'start_date', r.start_date, 'end_date', r.end_date,
                             'day_part', r.day_part, 'start_time', r.start_time, 'end_time', r.end_time,
                             'requested_minutes', r.requested_minutes, 'unpaid_minutes', r.unpaid_minutes,
                             'per_diem_rials', r.per_diem_rials),
          jsonb_build_object('unit', p_unit, 'start_date', p_start, 'end_date', p_end,
                             'day_part', v_part, 'start_time', p_start_time, 'end_time', p_end_time,
                             'requested_minutes', v_minutes, 'unpaid_minutes', v_unpaid,
                             'per_diem_rials', v_per_diem, 'ledger_delta', v_delta,
                             'correction_id', v_id));
  return v_id;
end $_$;
