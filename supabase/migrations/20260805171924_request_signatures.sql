-- Requester digital signatures (2026-08-05).
--
-- Historical requests remain nullable. Every public submission wrapper now
-- requires a bounded PNG and an explicit authorization flag, then records the
-- consent timestamp inside the same transaction as the request insert.

alter table public.leave_requests
  add column if not exists signature_data text,
  add column if not exists signature_consent_at timestamptz;

alter table public.leave_requests
  drop constraint if exists leave_requests_signature_shape;

alter table public.leave_requests
  add constraint leave_requests_signature_shape check (
    (signature_data is null and signature_consent_at is null)
    or
    (
      signature_data is not null
      and signature_consent_at is not null
      and length(signature_data) between 100 and 350000
      and mod(length(signature_data), 4) = 2
      and signature_data ~ '^data:image/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$'
    )
  );

comment on column public.leave_requests.signature_data is
  'Requester-drawn PNG data URL. Private with the request base row; never exposed by team_leave_calendar.';
comment on column public.leave_requests.signature_consent_at is
  'Database timestamp when the requester authorized this digital signature for the request.';

create or replace function private.attach_request_signature(
  p_request_id uuid,
  p_signature_data text,
  p_signature_authorized boolean
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_signature_authorized is not true then
    raise exception 'signature authorization is required' using errcode = '22023';
  end if;
  if p_signature_data is null or p_signature_data = '' then
    raise exception 'signature is required' using errcode = '22023';
  end if;
  if length(p_signature_data) not between 100 and 350000
     or mod(length(p_signature_data), 4) <> 2
     or p_signature_data !~ '^data:image/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$'
  then
    raise exception 'signature data is invalid' using errcode = '22023';
  end if;

  update public.leave_requests
     set signature_data = p_signature_data,
         signature_consent_at = now()
   where id = p_request_id
     and signature_data is null
     and signature_consent_at is null;

  if not found then
    raise exception 'request signature could not be attached' using errcode = '55000';
  end if;
end;
$$;

revoke all on function private.attach_request_signature(uuid, text, boolean)
  from public, anon, authenticated;

-- Replace the exposed wrappers rather than leaving PostgREST-visible overloads
-- that could submit a new request without signature evidence.
drop function if exists public.submit_leave_request(
  uuid, date, date, public.day_part, text, uuid
);
drop function if exists public.submit_hourly_leave_request(
  uuid, date, time, time, text, uuid
);
drop function if exists public.submit_errand_request(
  date, time, time, text, text
);

create or replace function public.submit_leave_request(
  p_leave_type_id uuid,
  p_start date,
  p_end date,
  p_day_part public.day_part,
  p_signature_data text,
  p_signature_authorized boolean,
  p_reason text default null,
  p_replacement_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_id uuid;
begin
  if not private.is_active(auth.uid()) then
    raise exception 'account is inactive' using errcode = '42501';
  end if;

  v_request_id := private.submit_leave_impl(
    p_leave_type_id, p_start, p_end, p_day_part, p_reason,
    'day', null, null, p_replacement_id, 'leave', null
  );
  perform private.attach_request_signature(
    v_request_id, p_signature_data, p_signature_authorized
  );
  return v_request_id;
end;
$$;

create or replace function public.submit_hourly_leave_request(
  p_leave_type_id uuid,
  p_date date,
  p_start_time time,
  p_end_time time,
  p_signature_data text,
  p_signature_authorized boolean,
  p_reason text default null,
  p_replacement_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_id uuid;
begin
  if not private.is_active(auth.uid()) then
    raise exception 'account is inactive' using errcode = '42501';
  end if;

  v_request_id := private.submit_leave_impl(
    p_leave_type_id, p_date, p_date, 'full', p_reason,
    'hour', p_start_time, p_end_time, p_replacement_id, 'leave', null
  );
  perform private.attach_request_signature(
    v_request_id, p_signature_data, p_signature_authorized
  );
  return v_request_id;
end;
$$;

create or replace function public.submit_errand_request(
  p_date date,
  p_start_time time,
  p_end_time time,
  p_location text,
  p_signature_data text,
  p_signature_authorized boolean,
  p_description text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_id uuid;
begin
  if not private.is_active(auth.uid()) then
    raise exception 'account is inactive' using errcode = '42501';
  end if;

  v_request_id := private.submit_leave_impl(
    null::uuid, p_date, p_date, 'full', p_description,
    'hour', p_start_time, p_end_time, null::uuid, 'errand', p_location
  );
  perform private.attach_request_signature(
    v_request_id, p_signature_data, p_signature_authorized
  );
  return v_request_id;
end;
$$;

revoke execute on function public.submit_leave_request(
  uuid, date, date, public.day_part, text, boolean, text, uuid
) from public, anon;
grant execute on function public.submit_leave_request(
  uuid, date, date, public.day_part, text, boolean, text, uuid
) to authenticated;

revoke execute on function public.submit_hourly_leave_request(
  uuid, date, time, time, text, boolean, text, uuid
) from public, anon;
grant execute on function public.submit_hourly_leave_request(
  uuid, date, time, time, text, boolean, text, uuid
) to authenticated;

revoke execute on function public.submit_errand_request(
  date, time, time, text, text, boolean, text
) from public, anon;
grant execute on function public.submit_errand_request(
  date, time, time, text, text, boolean, text
) to authenticated;

-- PostgREST may keep the old RPC signatures until its schema cache is refreshed.
notify pgrst, 'reload schema';
