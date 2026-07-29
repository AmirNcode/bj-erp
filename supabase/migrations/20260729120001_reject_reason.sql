-- =============================================================================
-- 20260729120001_reject_reason.sql — record WHY a request was rejected, where
-- the employee can actually read it.
--
-- reject_leave_request has always accepted p_reason, but only wrote it to
-- audit_log, which employees cannot read. A rejection reason nobody can see is
-- not a reason. This adds leave_requests.decision_note and stores it there too.
--
-- Deliberately a separate column from leave_requests.reason: `reason` is the
-- requester's, `decision_note` is the decider's. FR-25 keeps `reason` private
-- from peers; decision_note follows the row's own RLS (own / manager-of /
-- admin / security) and is NOT exposed through team_leave_calendar, which
-- selects an explicit column list and is untouched here.
--
-- Additive and nullable — existing rows read as NULL, nothing to backfill.
-- =============================================================================

alter table public.leave_requests
  add column if not exists decision_note text;

alter table public.leave_requests
  drop constraint if exists leave_requests_decision_note_len;
alter table public.leave_requests
  add constraint leave_requests_decision_note_len
  check (decision_note is null or length(decision_note) <= 500);

comment on column public.leave_requests.decision_note is
  'Optional note from the manager/admin who decided the request (currently set on reject only). Visible to the employee; never exposed via team_leave_calendar.';

-- ---------------------------------------------------------------------------
-- reject_leave_request — unchanged authorization and status rules; now also
-- persists the note on the row. Blank/whitespace input stays NULL so the UI
-- can simply omit the field rather than write an empty string.
-- ---------------------------------------------------------------------------
create or replace function public.reject_leave_request(p_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_emp    uuid;
  v_status public.leave_status;
  v_rows   int;
  v_note   text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;

  if length(v_note) > 500 then
    raise exception 'rejection note is too long (max 500 characters)' using errcode = '22023';
  end if;

  select employee_id, status into v_emp, v_status from public.leave_requests where id = p_id;
  if v_emp is null then raise exception 'request not found' using errcode = 'P0002'; end if;

  if not (private.is_manager_of(v_uid, v_emp) or private.is_admin(v_uid)) then
    raise exception 'not allowed to decide this request' using errcode = '42501';
  end if;
  if v_status <> 'pending' then
    raise exception 'only pending requests can be rejected' using errcode = '22023';
  end if;

  update public.leave_requests
     set status = 'rejected', decided_by = v_uid, decided_at = now(), decision_note = v_note
   where id = p_id and status = 'pending';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'request was already decided' using errcode = '22023'; end if;

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (v_uid, 'reject_leave_request', 'leave_requests', p_id,
          jsonb_build_object('employee_id', v_emp, 'reason', v_note));
end; $$;

revoke execute on function public.reject_leave_request(uuid, text) from public, anon;
grant  execute on function public.reject_leave_request(uuid, text) to authenticated;
