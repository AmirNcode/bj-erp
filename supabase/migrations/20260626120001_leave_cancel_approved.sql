-- =============================================================================
-- Migration: 20260626120001_leave_cancel_approved.sql
-- Purpose  : FR-15 — extend cancel_leave_request to also cancel an APPROVED
--            request whose start_date is still in the future (start_date >
--            current_date), reversing the consumption with a 'reversal' ledger
--            row (+requested_days) for balance-affecting types. The pending path
--            is unchanged (a pending request never consumed balance → no ledger).
-- Why       : leave_requests / leave_ledger have NO client write policies (see
--            20260623120005_leave.sql); this SECURITY DEFINER function remains the
--            ONLY write path. Same signature → existing grants persist.
-- Guard    : owner = auth.uid() OR private.is_admin(auth.uid()).
-- Atomicity: the status-predicated UPDATE + row-count guard makes the transition
--            single-shot, so the reversal ledger row is written at most once even
--            under a concurrent double-cancel.
-- Note     : Advisor lint 0029 (exposed SECURITY DEFINER fn) accepted by design —
--            the in-function owner/admin check is the intended gate. See
--            docs/PERMISSIONS.md.
-- Depends  : 20260623120005_leave.sql      (leave_requests, leave_ledger, leave_types)
--            20260623120006_leave_fns.sql   (current_leave_balance; original cancel fn)
--            20260623120002_rls_helpers.sql (private.is_admin)
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
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;

  select employee_id, status, start_date, leave_type_id, requested_days
    into v_owner, v_status, v_start, v_type, v_days
    from public.leave_requests where id = p_id;
  if v_owner is null then raise exception 'request not found' using errcode = 'P0002'; end if;

  if not (v_owner = v_uid or private.is_admin(v_uid)) then
    raise exception 'not allowed to cancel this request' using errcode = '42501';
  end if;

  if v_status = 'pending' then
    update public.leave_requests
       set status = 'cancelled', decided_by = v_uid, decided_at = now()
     where id = p_id and status = 'pending';
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then raise exception 'request was already decided' using errcode = '22023'; end if;

  elsif v_status = 'approved' and v_start > current_date then
    -- Atomic flip; the status predicate guards against a concurrent double-cancel
    -- so the reversal ledger row is written at most once.
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
