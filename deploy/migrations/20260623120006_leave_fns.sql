-- =============================================================================
-- Migration: 20260623120006_leave_fns.sql
-- Purpose  : Privileged write-path for leave. The transactional tables
--            (leave_requests, leave_ledger, leave_allocations) have NO client
--            write policies (see 0005); these SECURITY DEFINER functions are the
--            ONLY way to write them, and they enforce business rules first.
-- Mirrors  : lib/leave/workingDays.ts (must stay in lockstep: ISO weekday
--            Mon=1..Sun=7 via extract(isodow); half-day only on a single
--            working day; reversed range -> 0).
-- =============================================================================

-- compute_requested_days: server-trusted working-day count for a company.
-- Internal helper only (EXECUTE revoked from anon/authenticated; called by the
-- definer functions below, which run as the owner).
create or replace function public.compute_requested_days(
  p_company_id uuid, p_start date, p_end date, p_day_part public.day_part
) returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare
  v_weekend int[];
  v_count   numeric := 0;
  d         date;
  v_working boolean;
begin
  if p_end < p_start then return 0; end if;
  select weekend_days into v_weekend from public.work_settings where company_id = p_company_id limit 1;
  if v_weekend is null then v_weekend := '{5}'; end if;

  if p_day_part in ('am', 'pm') then
    if p_start <> p_end then return 0; end if;
    v_working := (extract(isodow from p_start)::int <> all (v_weekend))
                 and not exists (select 1 from public.holidays h
                                 where h.company_id = p_company_id and h.holiday_date = p_start);
    return case when v_working then 0.5 else 0 end;
  end if;

  d := p_start;
  while d <= p_end loop
    if (extract(isodow from d)::int <> all (v_weekend))
       and not exists (select 1 from public.holidays h
                       where h.company_id = p_company_id and h.holiday_date = d)
    then
      v_count := v_count + 1;
    end if;
    d := d + 1;
  end loop;
  return v_count;
end; $$;

-- current_balance: latest ledger balance_after for (employee, leave_type), or 0.
create or replace function public.current_leave_balance(p_employee_id uuid, p_leave_type_id uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce((
    select balance_after from public.leave_ledger
    where employee_id = p_employee_id and leave_type_id = p_leave_type_id
    order by created_at desc, id desc limit 1
  ), 0);
$$;

-- allocate_leave (admin only): allocation row + 'allocation' ledger entry.
create or replace function public.allocate_leave(
  p_employee_id uuid, p_leave_type_id uuid, p_period_start date, p_period_end date, p_days numeric
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_prev numeric; v_alloc uuid;
begin
  if not private.is_admin(auth.uid()) then
    raise exception 'only admins can allocate leave' using errcode = '42501';
  end if;
  insert into public.leave_allocations(employee_id, leave_type_id, period_start, period_end, allocated_days, created_by)
  values (p_employee_id, p_leave_type_id, p_period_start, p_period_end, p_days, auth.uid())
  returning id into v_alloc;

  v_prev := public.current_leave_balance(p_employee_id, p_leave_type_id);
  insert into public.leave_ledger(employee_id, leave_type_id, entry_type, delta_days, balance_after, note)
  values (p_employee_id, p_leave_type_id, 'allocation', p_days, v_prev + p_days, 'allocation');

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (auth.uid(), 'allocate_leave', 'leave_allocations', v_alloc,
          jsonb_build_object('employee_id', p_employee_id, 'leave_type_id', p_leave_type_id, 'days', p_days));
  return v_alloc;
end; $$;

-- submit_leave_request (self): server computes requested_days and validates
-- balance; clients cannot fabricate either. Inserts a 'pending' request.
create or replace function public.submit_leave_request(
  p_leave_type_id uuid, p_start date, p_end date, p_day_part public.day_part, p_reason text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_company uuid; v_days numeric; v_affects boolean; v_balance numeric; v_req uuid;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select company_id into v_company from public.profiles where id = v_uid;
  if v_company is null then raise exception 'no profile for caller' using errcode = '42501'; end if;

  v_days := public.compute_requested_days(v_company, p_start, p_end, p_day_part);
  if v_days <= 0 then
    raise exception 'requested days must be greater than 0 (all days fall on weekend/holiday or dates invalid)' using errcode = '22023';
  end if;

  select affects_balance into v_affects from public.leave_types where id = p_leave_type_id and company_id = v_company and active;
  if v_affects is null then raise exception 'invalid or inactive leave type' using errcode = '22023'; end if;

  if v_affects then
    v_balance := public.current_leave_balance(v_uid, p_leave_type_id);
    if v_days > v_balance then
      raise exception 'insufficient balance: % day(s) requested, % available', v_days, v_balance using errcode = '22023';
    end if;
  end if;

  insert into public.leave_requests(employee_id, leave_type_id, start_date, end_date, day_part, requested_days, status, reason)
  values (v_uid, p_leave_type_id, p_start, p_end, p_day_part, v_days, 'pending', p_reason)
  returning id into v_req;
  return v_req;
end; $$;

-- cancel_leave_request: owner (own pending) or admin.
create or replace function public.cancel_leave_request(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_owner uuid; v_status public.leave_status;
begin
  select employee_id, status into v_owner, v_status from public.leave_requests where id = p_id;
  if v_owner is null then raise exception 'request not found' using errcode = 'P0002'; end if;
  if not (v_owner = v_uid or private.is_admin(v_uid)) then
    raise exception 'not allowed to cancel this request' using errcode = '42501';
  end if;
  if v_status <> 'pending' then raise exception 'only pending requests can be cancelled' using errcode = '22023'; end if;
  update public.leave_requests set status = 'cancelled', decided_by = v_uid, decided_at = now() where id = p_id;
end; $$;

-- Grants: compute + balance are internal (callers run as owner). Write fns are
-- callable by authenticated (self-guarded); anon revoked. (Advisor lint 0029 for
-- these is intentional, same rationale as the admin RPCs — see PERMISSIONS.md.)
revoke execute on function public.compute_requested_days(uuid, date, date, public.day_part) from public, anon, authenticated;
-- current_leave_balance is internal-only: it is SECURITY DEFINER (bypasses RLS),
-- so exposing it would let any authenticated user read another employee's balance
-- by uuid. The definer write-fns call it as owner; the UI reads balances via the
-- RLS-protected leave_ledger instead.
revoke execute on function public.current_leave_balance(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.allocate_leave(uuid, uuid, date, date, numeric) from public, anon;
grant  execute on function public.allocate_leave(uuid, uuid, date, date, numeric) to authenticated;
revoke execute on function public.submit_leave_request(uuid, date, date, public.day_part, text) from public, anon;
grant  execute on function public.submit_leave_request(uuid, date, date, public.day_part, text) to authenticated;
revoke execute on function public.cancel_leave_request(uuid) from public, anon;
grant  execute on function public.cancel_leave_request(uuid) to authenticated;
