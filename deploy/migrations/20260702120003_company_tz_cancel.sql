-- =============================================================================
-- Migration: 20260702120003_company_tz_cancel.sql
-- Purpose  : cancel_leave_request compared start_date to `current_date`, which
--            is the SERVER date (UTC on hosted Supabase). Between midnight and
--            03:30 Asia/Tehran the server is still on yesterday's date, so an
--            employee could cancel an approved leave that had already started
--            (company time). Compare against the company-timezone date instead.
--            Mirrors lib/appDate.ts on the app side.
-- =============================================================================

create or replace function public.cancel_leave_request(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := auth.uid();
  v_owner   uuid;
  v_status  public.leave_status;
  v_start   date;
  v_type    uuid;
  v_days    numeric;
  v_affects boolean;
  v_prev    numeric;
  v_rows    int;
  v_today   date := (now() at time zone 'Asia/Tehran')::date;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;

  select employee_id into v_owner from public.leave_requests where id = p_id;
  if v_owner is null then raise exception 'request not found' using errcode = 'P0002'; end if;

  if not (v_owner = v_uid or private.is_admin(v_uid)) then
    raise exception 'not allowed to cancel this request' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('leave:' || v_owner::text, 0));

  select status, start_date, leave_type_id, requested_days
    into v_status, v_start, v_type, v_days
    from public.leave_requests where id = p_id;

  if v_status = 'pending' then
    update public.leave_requests
       set status = 'cancelled', decided_by = v_uid, decided_at = now()
     where id = p_id and status = 'pending';
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then raise exception 'request was already decided' using errcode = '22023'; end if;

  elsif v_status = 'approved' and v_start > v_today then
    update public.leave_requests
       set status = 'cancelled', decided_by = v_uid, decided_at = now()
     where id = p_id and status = 'approved';
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then raise exception 'request was already decided' using errcode = '22023'; end if;

    select affects_balance into v_affects from public.leave_types where id = v_type;
    if v_affects then
      v_prev := public.current_leave_balance(v_owner, v_type);
      insert into public.leave_ledger(employee_id, leave_type_id, request_id, entry_type, delta_days, balance_after, note)
      values (v_owner, v_type, p_id, 'reversal', v_days, v_prev + v_days, 'reversal on cancel');
    end if;

  else
    raise exception 'only pending or not-yet-started approved requests can be cancelled' using errcode = '22023';
  end if;

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (v_uid, 'cancel_leave_request', 'leave_requests', p_id,
          jsonb_build_object('status_before', v_status, 'days', v_days,
                             'reversed', (v_status = 'approved')));
end; $$;
