-- =============================================================================
-- Migration: 20261020120004_errand_extensions.sql
-- Purpose  : FR-70 — the direct manager asks for a later end date (with a reason)
--            on an approved, travel-booked trip; HR alone approves (signed) or
--            rejects. On approval the end date moves and the booking returns to
--            procurement. The Head of HR's own trip follows its HR exemption.
-- Spec     : docs/specs/2026-10-20-travel-booking-design.md §6
-- Locks    : private.approval_lock(company) before 'leave:'||employee (CLAUDE.md).
-- =============================================================================

-- Does [p_start, p_end] collide with the employee's other pending/approved requests
-- or with another trip's pending extension days? (Day unit: any overlap counts.)
create or replace function private.extension_overlaps(p_request uuid, p_employee uuid, p_start date, p_end date)
  returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
      select 1 from public.leave_requests r
       where r.employee_id = p_employee and r.id <> p_request
         and r.status in ('pending', 'approved')
         and r.start_date <= p_end and r.end_date >= p_start)
    or exists (
      select 1 from public.errand_extensions e
        join public.leave_requests r on r.id = e.request_id
       where r.employee_id = p_employee and e.request_id <> p_request and e.status = 'pending'
         and e.old_end_date + 1 <= p_end and e.new_end_date >= p_start);
$$;
revoke all on function private.extension_overlaps(uuid, uuid, date, date) from public, anon, authenticated;

-- Apply an approved extension. Caller holds both locks and has validated authority.
create or replace function private.apply_errand_extension(p_extension uuid, p_actor uuid, p_evidence text,
    p_signature_data text, p_per_diem bigint, p_note text) returns void
  language plpgsql security definer set search_path to '' as $$
declare
  e public.errand_extensions%rowtype;
  r public.leave_requests%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  select * into e from public.errand_extensions where id = p_extension for update;
  select * into r from public.leave_requests where id = e.request_id for update;
  if private.extension_overlaps(r.id, r.employee_id, e.old_end_date + 1, e.new_end_date) then
    raise exception 'overlapping leave request exists' using errcode = '22023';
  end if;
  update public.errand_extensions
     set status = 'approved', evidence = p_evidence, decided_by = p_actor, decided_at = v_now,
         signature_data = p_signature_data,
         signature_consent_at = case when p_signature_data is not null then v_now end,
         decision_note = nullif(btrim(coalesce(p_note, '')), ''),
         per_diem_before = r.per_diem_rials,
         per_diem_after = coalesce(p_per_diem, r.per_diem_rials)
   where id = p_extension;
  update public.leave_requests
     set end_date = e.new_end_date,
         requested_minutes = public.compute_requested_minutes(r.company_id, r.start_date, e.new_end_date,
                               'full', 'day', null, null, 'errand'),
         per_diem_rials = coalesce(p_per_diem, per_diem_rials),
         per_diem_by_requester = case when p_per_diem is not null then false else per_diem_by_requester end
   where id = r.id;
  update public.travel_bookings set done_at = null, done_by = null, updated_at = now() where request_id = r.id;
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (p_actor, 'errand_extension.approve', 'leave_requests', r.id,
          jsonb_build_object('end_date', e.old_end_date, 'per_diem_rials', r.per_diem_rials),
          jsonb_build_object('end_date', e.new_end_date, 'evidence', p_evidence, 'extension_id', p_extension,
                             'per_diem_rials', coalesce(p_per_diem, r.per_diem_rials)));
end; $$;
revoke all on function private.apply_errand_extension(uuid, uuid, text, text, bigint, text) from public, anon, authenticated;

-- Trips the caller (direct manager; admin: whole company) may extend.
create or replace function public.app_extendable_trips()
  returns table(request_id uuid, serial_year integer, serial_seq integer, employee_name text,
                errand_location text, start_date date, end_date date, pending_extension boolean)
  language plpgsql stable security definer set search_path to '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not private.is_active(v_uid) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select r.id, r.serial_year, r.serial_seq, p.full_name, r.errand_location, r.start_date, r.end_date,
           exists (select 1 from public.errand_extensions e where e.request_id = r.id and e.status = 'pending')
      from public.travel_bookings b
      join public.leave_requests r on r.id = b.request_id
      join public.profiles p on p.id = r.employee_id
      join public.profiles c on c.id = v_uid and c.company_id = r.company_id
     where r.status = 'approved' and b.opened_at is not null and r.employee_id <> v_uid
       and r.end_date >= (now() at time zone 'Asia/Tehran')::date
       and (p.manager_id = v_uid or private.is_admin(v_uid))
     order by r.start_date, r.serial_year, r.serial_seq;
end; $$;
revoke all on function public.app_extendable_trips() from public, anon;
grant execute on function public.app_extendable_trips() to authenticated;

create or replace function public.app_request_errand_extension(p_request uuid, p_new_end date, p_reason text)
  returns uuid language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := auth.uid();
  r public.leave_requests%rowtype;
  b public.travel_bookings%rowtype;
  v_manager uuid;
  v_id uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_uid is null or not private.is_active(v_uid) then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select * into r from public.leave_requests where id = p_request;
  if r.id is null then raise exception 'request not found' using errcode = 'P0002'; end if;
  select manager_id into v_manager from public.profiles where id = r.employee_id;
  if r.employee_id = v_uid
     or not (v_manager = v_uid
             or (private.is_admin(v_uid)
                 and exists (select 1 from public.profiles c where c.id = v_uid and c.company_id = r.company_id))) then
    raise exception 'not allowed to extend this trip' using errcode = '42501';
  end if;

  perform private.approval_lock(r.company_id);
  perform pg_advisory_xact_lock(hashtextextended('leave:' || r.employee_id::text, 0));
  select * into r from public.leave_requests where id = p_request;
  select * into b from public.travel_bookings where request_id = p_request;

  if r.status <> 'approved' or b.request_id is null or b.opened_at is null then
    raise exception 'only an approved trip with travel booking can be extended' using errcode = '22023';
  end if;
  if r.end_date < (now() at time zone 'Asia/Tehran')::date then
    raise exception 'trip has already ended' using errcode = '22023';
  end if;
  if p_new_end is null or p_new_end <= r.end_date then
    raise exception 'new end date must be after the current end date' using errcode = '22023';
  end if;
  if v_reason = '' then raise exception 'a reason is required' using errcode = '22023'; end if;
  if char_length(v_reason) > 1000 then raise exception 'reason is too long' using errcode = '22023'; end if;
  if exists (select 1 from public.errand_extensions where request_id = p_request and status = 'pending') then
    raise exception 'an extension is already waiting for HR' using errcode = '22023';
  end if;
  if private.extension_overlaps(r.id, r.employee_id, r.end_date + 1, p_new_end) then
    raise exception 'overlapping leave request exists' using errcode = '22023';
  end if;

  insert into public.errand_extensions (request_id, company_id, old_end_date, new_end_date, reason, requested_by)
  values (r.id, r.company_id, r.end_date, p_new_end, v_reason, v_uid)
  returning id into v_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (v_uid, 'errand_extension.request', 'leave_requests', r.id,
          jsonb_build_object('extension_id', v_id, 'new_end_date', p_new_end));

  -- The Head of HR's own trip: its HR step was exempt, so the extension is too
  -- (owner, 2026-10-20): approved at once, no signature, per diem unchanged.
  if exists (select 1 from public.approval_request_policy x
              where x.request_id = r.id and cardinality(x.hr_exempt_step_ids) > 0) then
    perform private.apply_errand_extension(v_id, null, 'exempt', null, null, null);
  end if;
  return v_id;
end; $$;
revoke all on function public.app_request_errand_extension(uuid, date, text) from public, anon;
grant execute on function public.app_request_errand_extension(uuid, date, text) to authenticated;

create or replace function public.app_pending_errand_extensions()
  returns table(extension_id uuid, request_id uuid, serial_year integer, serial_seq integer,
                employee_name text, errand_location text, start_date date, old_end_date date,
                new_end_date date, reason text, requested_by_name text, per_diem_rials bigint,
                delegation_uncovered boolean)
  language plpgsql stable security definer set search_path to '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not private.is_active(v_uid)
     or not (private.is_admin(v_uid) or private.has_role(v_uid, 'hr')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select e.id, r.id, r.serial_year, r.serial_seq, p.full_name, r.errand_location, r.start_date,
           e.old_end_date, e.new_end_date, e.reason, q.full_name, r.per_diem_rials,
           exists (select 1 from public.approval_delegations g
                    where g.source_request_id = r.id and g.revoked_at is null)
      from public.errand_extensions e
      join public.leave_requests r on r.id = e.request_id
      join public.profiles p on p.id = r.employee_id
      join public.profiles q on q.id = e.requested_by
      join public.profiles c on c.id = v_uid and c.company_id = e.company_id
     where e.status = 'pending' and r.employee_id <> v_uid
     order by e.requested_at;
end; $$;
revoke all on function public.app_pending_errand_extensions() from public, anon;
grant execute on function public.app_pending_errand_extensions() to authenticated;

create or replace function public.app_decide_errand_extension(p_extension uuid, p_approve boolean,
    p_signature_data text, p_signature_authorized boolean, p_per_diem_rials bigint default null,
    p_note text default null) returns void
  language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := auth.uid();
  e public.errand_extensions%rowtype;
  v_employee uuid;
begin
  select * into e from public.errand_extensions where id = p_extension;
  if e.id is null then raise exception 'extension not found' using errcode = 'P0002'; end if;
  if not private.is_travel_hr(v_uid, e.request_id) then
    raise exception 'not allowed to decide this extension' using errcode = '42501';
  end if;
  if p_approve then
    if not coalesce(p_signature_authorized, false) or p_signature_data is null
       or p_signature_data !~ '^data:image/png;base64,[A-Za-z0-9+/]+=*$' then
      raise exception 'signature is required' using errcode = '22023';
    end if;
    if p_per_diem_rials < 0 then raise exception 'per diem must be 0 or more' using errcode = '22023'; end if;
  end if;
  if char_length(p_note) > 1000 then raise exception 'note is too long' using errcode = '22023'; end if;

  select employee_id into v_employee from public.leave_requests where id = e.request_id;
  perform private.approval_lock(e.company_id);
  perform pg_advisory_xact_lock(hashtextextended('leave:' || v_employee::text, 0));
  select * into e from public.errand_extensions where id = p_extension for update;
  if e.status <> 'pending' then raise exception 'extension is no longer pending' using errcode = '22023'; end if;

  if p_approve then
    perform private.apply_errand_extension(p_extension, v_uid, 'manual', p_signature_data, p_per_diem_rials, p_note);
  else
    update public.errand_extensions
       set status = 'rejected', decided_by = v_uid, decided_at = clock_timestamp(),
           decision_note = nullif(btrim(coalesce(p_note, '')), '')
     where id = p_extension;
    insert into public.audit_log (actor_id, action, entity, entity_id, after)
    values (v_uid, 'errand_extension.reject', 'leave_requests', e.request_id,
            jsonb_build_object('extension_id', p_extension));
  end if;
end; $$;
revoke all on function public.app_decide_errand_extension(uuid, boolean, text, boolean, bigint, text) from public, anon;
grant execute on function public.app_decide_errand_extension(uuid, boolean, text, boolean, bigint, text) to authenticated;

-- Extension history of one request, for whoever may read its approval progress.
create or replace function public.request_errand_extensions(p_id uuid)
  returns table(old_end_date date, new_end_date date, reason text, status text, evidence text,
                requested_by_name text, decided_by_name text, decided_at timestamptz)
  language plpgsql stable security definer set search_path to '' as $$
begin
  if not private.can_read_approval_request(auth.uid(), p_id) then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  return query
    select e.old_end_date, e.new_end_date, e.reason, e.status, e.evidence, q.full_name, d.full_name, e.decided_at
      from public.errand_extensions e
      join public.profiles q on q.id = e.requested_by
      left join public.profiles d on d.id = e.decided_by
     where e.request_id = p_id
     order by e.requested_at;
end; $$;
revoke all on function public.request_errand_extensions(uuid) from public, anon;
grant execute on function public.request_errand_extensions(uuid) to authenticated;

-- Calendar: a pending extension's extra days show as pending (spec §6.2).
create or replace view public.team_leave_calendar as
 select lr.id, lr.employee_id, p.full_name as employee_name, p.department_id, lr.kind, lr.leave_type_id,
        lt.name_fa as leave_type_name_fa, lt.name_en as leave_type_name_en, lt.color as leave_type_color,
        lr.start_date, lr.end_date, lr.day_part, lr.unit, lr.start_time, lr.end_time,
        lr.requested_minutes, lr.status
   from public.leave_requests lr
   join public.profiles p on p.id = lr.employee_id
   left join public.leave_types lt on lt.id = lr.leave_type_id
  where private.is_active(auth.uid()) and lr.status = any (array['pending'::public.leave_status, 'approved'::public.leave_status])
    and (lr.employee_id = auth.uid() or private.same_team(auth.uid(), lr.employee_id) or private.reads_calendar(auth.uid()))
 union all
 select e.id, lr.employee_id, p.full_name, p.department_id, lr.kind, lr.leave_type_id,
        null::text, null::text, null::text,
        e.old_end_date + 1, e.new_end_date, lr.day_part, lr.unit, lr.start_time, lr.end_time,
        0, 'pending'::public.leave_status
   from public.errand_extensions e
   join public.leave_requests lr on lr.id = e.request_id
   join public.profiles p on p.id = lr.employee_id
  where e.status = 'pending' and lr.status = 'approved' and private.is_active(auth.uid())
    and (lr.employee_id = auth.uid() or private.same_team(auth.uid(), lr.employee_id) or private.reads_calendar(auth.uid()));
