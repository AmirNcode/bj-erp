-- FR-84: `is_travel_hr` lets an hr holder's approval delegate act on that hr holder's own
-- trip. A correction changes money and signed dates, so it gets a stricter gate: a
-- delegate acts only through an hr holder who is not the traveller.

create function private.can_correct_trip(p_uid uuid, p_request uuid) returns boolean
    language sql stable security definer
    set search_path to ''
    as $$
  select exists (
    select 1 from public.leave_requests r
     where r.id = p_request and r.employee_id <> p_uid
       and private.acts_as_travel_hr(p_uid, r.company_id)
       and (private.is_admin(p_uid) or private.has_role(p_uid, 'hr')
            or exists (
              select 1 from public.user_roles ur
                join public.profiles h on h.id = ur.user_id and h.company_id = r.company_id and h.active
               where ur.role = 'hr' and ur.user_id <> r.employee_id
                 and exists (select 1 from private.effective_approval_delegate(ur.user_id) d
                              where d.delegate_id = p_uid))));
$$;

revoke all on function private.can_correct_trip(uuid, uuid) from public, anon, authenticated;

create or replace function public.app_correct_trip(p_request uuid, p_new_start date, p_new_end date, p_per_diem_rials bigint, p_reason text, p_signature_data text, p_signature_authorized boolean) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_uid uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason, ''));
  r public.leave_requests%rowtype;
  v_start date;
  v_end date;
  v_per_diem bigint;
  v_dates_changed boolean;
  v_per_diem_changed boolean;
  v_now timestamptz;
  v_id uuid;
begin
  select * into r from public.leave_requests where id = p_request;
  if r.id is null then raise exception 'request not found' using errcode = 'P0002'; end if;
  if not private.can_correct_trip(v_uid, p_request) then
    raise exception 'not allowed to correct this trip' using errcode = '42501';
  end if;
  if not coalesce(p_signature_authorized, false) or p_signature_data is null
     or p_signature_data !~ '^data:image/png;base64,[A-Za-z0-9+/]+=*$' then
    raise exception 'signature is required' using errcode = '22023';
  end if;
  if p_per_diem_rials < 0 then raise exception 'per diem must be 0 or more' using errcode = '22023'; end if;
  if v_reason = '' then raise exception 'a reason is required' using errcode = '22023'; end if;
  if char_length(v_reason) > 1000 then raise exception 'reason is too long' using errcode = '22023'; end if;

  perform private.approval_lock(r.company_id);
  perform pg_advisory_xact_lock(hashtextextended('leave:' || r.employee_id::text, 0));
  select * into r from public.leave_requests where id = p_request for update;
  if not private.can_correct_trip(v_uid, p_request) then
    raise exception 'not allowed to correct this trip' using errcode = '42501';
  end if;

  if r.status <> 'approved' or r.kind <> 'errand' or r.unit <> 'day' then
    raise exception 'only an approved daily trip can be corrected' using errcode = '22023';
  end if;
  if exists (select 1 from public.errand_extensions where request_id = p_request and status = 'pending') then
    raise exception 'an extension is waiting for HR' using errcode = '22023';
  end if;

  v_start := coalesce(p_new_start, r.start_date);
  v_end := coalesce(p_new_end, r.end_date);
  v_per_diem := coalesce(p_per_diem_rials, r.per_diem_rials);
  v_dates_changed := (v_start, v_end) is distinct from (r.start_date, r.end_date);
  v_per_diem_changed := v_per_diem is distinct from r.per_diem_rials;

  if not v_dates_changed and not v_per_diem_changed then
    raise exception 'nothing to correct' using errcode = '22023';
  end if;
  if v_start > v_end then
    raise exception 'start date must not be after end date' using errcode = '22023';
  end if;
  if v_dates_changed and private.extension_overlaps(r.id, r.employee_id, v_start, v_end) then
    raise exception 'overlapping leave request exists' using errcode = '22023';
  end if;

  v_now := clock_timestamp();
  insert into public.request_corrections (
    request_id, company_id, old_start_date, new_start_date, old_end_date, new_end_date,
    per_diem_before, per_diem_after, reason, corrected_by, corrected_at,
    signature_data, signature_consent_at
  ) values (
    r.id, r.company_id, r.start_date, v_start, r.end_date, v_end,
    r.per_diem_rials, v_per_diem, v_reason, v_uid, v_now, p_signature_data, v_now
  ) returning id into v_id;

  update public.leave_requests
     set start_date = v_start,
         end_date = v_end,
         requested_minutes = case when v_dates_changed
           then public.compute_requested_minutes(r.company_id, v_start, v_end, 'full', 'day', null, null, 'errand')
           else requested_minutes end,
         per_diem_rials = v_per_diem,
         per_diem_by_requester = case when v_per_diem_changed then false else per_diem_by_requester end
   where id = r.id;

  if v_dates_changed then
    update public.travel_bookings set done_at = null, done_by = null, updated_at = now()
     where request_id = r.id and opened_at is not null;
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (v_uid, 'trip.correct', 'leave_requests', r.id,
          jsonb_build_object('start_date', r.start_date, 'end_date', r.end_date, 'per_diem_rials', r.per_diem_rials),
          jsonb_build_object('start_date', v_start, 'end_date', v_end, 'per_diem_rials', v_per_diem,
                             'correction_id', v_id));
  return v_id;
end $_$;
