-- FR-70 (security review of migration 20261020120010): "the Head of HR's own trip"
-- was judged only by the HR exemption recorded at submission. Once the admin names
-- someone else Head of HR, the former one could still tick or extend those trips
-- alone, and their own extension still applied at once. The self paths now also
-- require that the caller is the Head of HR today (approval_executive_settings).
-- A former Head of HR's own extension, if they hold the Manager role, waits for HR
-- like any manager's. Requests by their manager or the admin keep the exempt path.
-- Bodies otherwise as in migration …10.

create or replace function private.is_current_hr_head(p_uid uuid, p_company uuid)
  returns boolean language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.approval_executive_settings x
                  where x.company_id = p_company and x.hr_head_id = p_uid);
$$;
revoke all on function private.is_current_hr_head(uuid, uuid) from public, anon;
grant execute on function private.is_current_hr_head(uuid, uuid) to authenticated;

create or replace function public.app_set_travel_booking(p_request uuid, p_on boolean)
  returns void language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := auth.uid();
  r public.leave_requests%rowtype;
  b public.travel_bookings%rowtype;
  v_today date := (now() at time zone 'Asia/Tehran')::date;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into r from public.leave_requests where id = p_request;
  if r.id is null then raise exception 'request not found' using errcode = 'P0002'; end if;
  -- HR (never on their own request), or the Head of HR on their own HR-exempt trip.
  if not (private.is_travel_hr(v_uid, p_request)
          or (r.employee_id = v_uid and private.is_active(v_uid) and private.request_has_hr_exemption(p_request)
              and private.is_current_hr_head(v_uid, r.company_id))) then
    raise exception 'not allowed to mark travel booking' using errcode = '42501';
  end if;
  if r.kind <> 'errand' or r.unit <> 'day' then
    raise exception 'travel booking applies to daily work errands only' using errcode = '22023';
  end if;
  if r.status not in ('pending', 'approved') then
    raise exception 'request is not pending or approved' using errcode = '22023';
  end if;
  if r.end_date < v_today then
    raise exception 'trip has already ended' using errcode = '22023';
  end if;

  select * into b from public.travel_bookings where request_id = p_request for update;
  if p_on then
    if b.request_id is null then
      insert into public.travel_bookings (request_id, company_id, ticked_by, ticked_at, opened_at)
      values (p_request, r.company_id, v_uid, now(),
              case when r.status = 'approved' then clock_timestamp() end);
      insert into public.audit_log (actor_id, action, entity, entity_id, after)
      values (v_uid, 'travel_booking.tick', 'leave_requests', p_request, null);
    end if;
  elsif b.request_id is not null then
    if b.first_saved_at is not null or b.done_at is not null then
      raise exception 'booking already started' using errcode = '22023';
    end if;
    delete from public.travel_bookings where request_id = p_request;
    insert into public.audit_log (actor_id, action, entity, entity_id, after)
    values (v_uid, 'travel_booking.untick', 'leave_requests', p_request, null);
  end if;
end; $$;

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
  if not (case when r.employee_id = v_uid
               then private.has_role(v_uid, 'manager')
                    or (private.request_has_hr_exemption(r.id) and private.is_current_hr_head(v_uid, r.company_id))
               else v_manager = v_uid
                    or (private.is_admin(v_uid)
                        and exists (select 1 from public.profiles c where c.id = v_uid and c.company_id = r.company_id))
          end) then
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
  if private.request_has_hr_exemption(r.id)
     and (r.employee_id <> v_uid or private.is_current_hr_head(v_uid, r.company_id)) then
    perform private.apply_errand_extension(v_id, null, 'exempt', null, null, null);
  end if;
  return v_id;
end; $$;

drop function if exists public.app_extendable_trips();
create function public.app_extendable_trips()
  returns table(request_id uuid, serial_year integer, serial_seq integer, employee_name text, errand_location text,
                start_date date, end_date date, pending_extension boolean, delegation_uncovered boolean,
                hr_exempt boolean)
  language plpgsql stable security definer set search_path to '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not private.is_active(v_uid) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select r.id, r.serial_year, r.serial_seq, p.full_name, r.errand_location, r.start_date, r.end_date,
           exists (select 1 from public.errand_extensions e where e.request_id = r.id and e.status = 'pending'),
           exists (select 1 from public.approval_delegations g where g.source_request_id = r.id and g.revoked_at is null),
           private.request_has_hr_exemption(r.id)
             and (r.employee_id <> v_uid or private.is_current_hr_head(v_uid, r.company_id))
      from public.travel_bookings b
      join public.leave_requests r on r.id = b.request_id
      join public.profiles p on p.id = r.employee_id
      join public.profiles c on c.id = v_uid and c.company_id = r.company_id
     where r.status = 'approved' and b.opened_at is not null
       and r.end_date >= (now() at time zone 'Asia/Tehran')::date
       and case when r.employee_id = v_uid
                then private.has_role(v_uid, 'manager')
                     or (private.request_has_hr_exemption(r.id) and private.is_current_hr_head(v_uid, r.company_id))
                else p.manager_id = v_uid or private.is_admin(v_uid) end
     order by r.start_date, r.serial_year, r.serial_seq;
end; $$;
revoke all on function public.app_extendable_trips() from public, anon;
grant execute on function public.app_extendable_trips() to authenticated;

notify pgrst, 'reload schema';
