-- FR-70 (owner review, 2026-10-20): a holder of the built-in Manager role may ask
-- to extend their OWN approved, travel-booked trip. HR still decides it
-- (app_decide_errand_extension is unchanged, and is_travel_hr never lets anyone
-- act on their own trip); the Head of HR's exempt path is unchanged. Everyone else
-- still extends only a direct report's trip (or any trip, as admin), so a
-- manager's direct reports never extend the manager's trip.
--
-- Both functions are copied from migration 20261020120004 / …06 (as in
-- supabase/schema.sql); only the "who may extend" test changes. Signatures are
-- unchanged, so the running app keeps working.

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
  if exists (select 1 from public.approval_request_policy x
              where x.request_id = r.id and cardinality(x.hr_exempt_step_ids) > 0) then
    perform private.apply_errand_extension(v_id, null, 'exempt', null, null, null);
  end if;
  return v_id;
end; $$;

create or replace function public.app_extendable_trips()
  returns table(request_id uuid, serial_year integer, serial_seq integer, employee_name text, errand_location text,
                start_date date, end_date date, pending_extension boolean, delegation_uncovered boolean)
  language plpgsql stable security definer set search_path to '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not private.is_active(v_uid) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select r.id, r.serial_year, r.serial_seq, p.full_name, r.errand_location, r.start_date, r.end_date,
           exists (select 1 from public.errand_extensions e where e.request_id = r.id and e.status = 'pending'),
           exists (select 1 from public.approval_delegations g where g.source_request_id = r.id and g.revoked_at is null)
      from public.travel_bookings b
      join public.leave_requests r on r.id = b.request_id
      join public.profiles p on p.id = r.employee_id
      join public.profiles c on c.id = v_uid and c.company_id = r.company_id
     where r.status = 'approved' and b.opened_at is not null
       and r.end_date >= (now() at time zone 'Asia/Tehran')::date
       and case when r.employee_id = v_uid
                then private.has_role(v_uid, 'manager')
                else p.manager_id = v_uid or private.is_admin(v_uid) end
     order by r.start_date, r.serial_year, r.serial_seq;
end; $$;

notify pgrst, 'reload schema';
