-- Approval signatures and Persian-only calendar (2026-08-05).
--
-- Historical approved requests remain nullable. Every approval after this
-- migration must use the signed three-argument RPC; rejecting remains unsigned.

alter table public.leave_requests
  add column if not exists approver_signature_data text,
  add column if not exists approver_signature_consent_at timestamptz;

alter table public.leave_requests
  drop constraint if exists leave_requests_approver_signature_shape;

alter table public.leave_requests
  add constraint leave_requests_approver_signature_shape check (
    (approver_signature_data is null and approver_signature_consent_at is null)
    or
    (
      -- Keep the approver's evidence when an approved future request is later
      -- cancelled; cancellation reverses the ledger but must not erase proof.
      status in ('approved', 'cancelled')
      and approver_signature_data is not null
      and approver_signature_consent_at is not null
      and length(approver_signature_data) between 100 and 350000
      and mod(length(approver_signature_data), 4) = 2
      and approver_signature_data ~ '^data:image/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$'
    )
  );

comment on column public.leave_requests.approver_signature_data is
  'Fresh PNG data URL drawn by the manager/admin who approved the request. Private base-row evidence.';
comment on column public.leave_requests.approver_signature_consent_at is
  'Database timestamp when the approving manager/admin authorized their digital signature.';

-- Remove the unsigned approval endpoint before publishing its signed replacement.
drop function if exists public.approve_leave_request(uuid);

create function public.approve_leave_request(
  p_id uuid,
  p_signature_data text,
  p_signature_authorized boolean
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_emp        uuid;
  v_type       uuid;
  v_minutes    int;
  v_status     public.leave_status;
  v_start      date;
  v_end        date;
  v_unit       public.leave_unit;
  v_st         time;
  v_et         time;
  v_repl       uuid;
  v_affects    boolean;
  v_prev       int;
  v_rows       int;
  v_consent_at timestamptz := now();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
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

  select employee_id into v_emp
    from public.leave_requests
   where id = p_id;
  if v_emp is null then
    raise exception 'request not found' using errcode = 'P0002';
  end if;

  if not (private.is_manager_of(v_uid, v_emp) or private.is_admin(v_uid)) then
    raise exception 'not allowed to decide this request' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('leave:' || v_emp::text, 0));

  select leave_type_id, requested_minutes, status, start_date, end_date,
         unit, start_time, end_time, replacement_id
    into v_type, v_minutes, v_status, v_start, v_end, v_unit, v_st, v_et, v_repl
    from public.leave_requests
   where id = p_id;

  if v_status <> 'pending' then
    raise exception 'only pending requests can be approved' using errcode = '22023';
  end if;

  if exists (
    select 1
      from public.leave_requests r
     where r.employee_id = v_emp
       and r.id <> p_id
       and r.status = 'approved'
       and r.start_date <= v_end
       and r.end_date >= v_start
       and (
         r.unit = 'day'
         or v_unit = 'day'
         or (r.start_time < v_et and r.end_time > v_st)
       )
  ) then
    raise exception 'overlapping approved leave exists' using errcode = '22023';
  end if;

  if v_repl is not null
     and private.replacement_is_away(v_repl, v_start, v_end, v_unit, v_st, v_et)
  then
    raise exception 'replacement is on leave during this period' using errcode = '22023';
  end if;

  select affects_balance into v_affects
    from public.leave_types
   where id = v_type;
  if v_affects then
    v_prev := public.current_leave_balance(v_emp, v_type);
    if v_minutes > v_prev then
      raise exception 'insufficient balance: % minute(s) requested, % available',
        v_minutes, v_prev using errcode = '22023';
    end if;
  end if;

  update public.leave_requests
     set status = 'approved',
         decided_by = v_uid,
         decided_at = v_consent_at,
         approver_signature_data = p_signature_data,
         approver_signature_consent_at = v_consent_at
   where id = p_id
     and status = 'pending'
     and approver_signature_data is null
     and approver_signature_consent_at is null;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'request was already decided' using errcode = '22023';
  end if;

  if v_affects then
    insert into public.leave_ledger(
      employee_id, leave_type_id, request_id, entry_type,
      delta_minutes, balance_after_minutes, note
    )
    values (
      v_emp, v_type, p_id, 'consumption',
      -v_minutes, v_prev - v_minutes, 'consumption on approval'
    );
  end if;

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (
    v_uid, 'approve_leave_request', 'leave_requests', p_id,
    jsonb_build_object(
      'employee_id', v_emp,
      'minutes', v_minutes,
      'affects_balance', coalesce(v_affects, false),
      'replacement_id', v_repl,
      'digital_signature_authorized', true,
      'signature_consent_at', v_consent_at
    )
  );
end;
$$;

revoke execute on function public.approve_leave_request(uuid, text, boolean)
  from public, anon;
grant execute on function public.approve_leave_request(uuid, text, boolean)
  to authenticated;

-- Persian is now the only supported display/picker calendar. Keep the column
-- for installed-schema/RPC compatibility while preventing preference drift.
update public.profiles
   set calendar_pref = 'jalali'
 where calendar_pref <> 'jalali';

alter table public.profiles
  alter column calendar_pref set default 'jalali';

alter table public.profiles
  drop constraint if exists profiles_calendar_pref_persian_only;

alter table public.profiles
  add constraint profiles_calendar_pref_persian_only
  check (calendar_pref = 'jalali');

comment on column public.profiles.calendar_pref is
  'Compatibility column fixed to jalali; the application no longer exposes a calendar preference.';

notify pgrst, 'reload schema';
