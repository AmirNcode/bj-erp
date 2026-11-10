-- FR-88 (2026-11-09): the replacement (جانشین) signs the request in the app.
--
-- A leave request that names a replacement asks that person to sign: they see it on Home, in
-- My requests and on the Calendar, and either sign it (signature pad + consent, like the
-- requester and approvers) or decline it, at any moment while the request is pending or
-- approved. Their answer never gates an approval step: approvers sign independently.
-- Declining does not reject the request. It goes back to the requester, who names someone else
-- (a fresh sign-off for them) or marks "no replacement". Approval signatures already given stay.
-- The printed form shows the replacement's signature.
--
-- Additive only: requests filed before this migration have no sign-off row (nothing to sign).

-- ── the sign-off row ────────────────────────────────────────────────────────
-- Its own table, not columns on leave_requests: the approval context is built from
-- to_jsonb(leave_requests) and must not start carrying another PNG.
create table public.leave_request_replacement_signoffs (
  request_id uuid primary key references public.leave_requests(id) on delete cascade,
  replacement_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending',
  signature_data text,
  signature_consent_at timestamptz,
  note text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint replacement_signoff_status check (status in ('pending', 'signed', 'declined')),
  constraint replacement_signoff_note_len check (note is null or length(note) <= 500),
  constraint replacement_signoff_shape check (
    (status = 'pending' and signature_data is null and signature_consent_at is null
      and decided_at is null and note is null)
    or (status = 'signed' and signature_data is not null and signature_consent_at is not null
      and decided_at is not null
      and length(signature_data) between 100 and 350000
      and mod(length(signature_data), 4) = 2
      and signature_data ~ '^data:image/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$')
    or (status = 'declined' and signature_data is null and signature_consent_at is null
      and decided_at is not null))
);

comment on table public.leave_request_replacement_signoffs is
  'FR-88: the named replacement signs (or declines) a leave request. Created by trigger when a request names a replacement; written only by app_replacement_sign / app_replacement_decline; replaced when the requester names someone else (app_change_replacement). Never gates approval. Absent for requests filed before FR-88.';

create index leave_request_replacement_signoffs_replacement_idx
  on public.leave_request_replacement_signoffs (replacement_id, status);

alter table public.leave_request_replacement_signoffs enable row level security;

-- The replacement reads their own sign-off; anyone who may read the request reads it too.
create policy replacement_signoffs_select on public.leave_request_replacement_signoffs
  for select to authenticated
  using ((replacement_id = auth.uid() and private.is_active(auth.uid()))
    or public.app_can_read_approval_request(request_id));

revoke all on table public.leave_request_replacement_signoffs from anon, authenticated;
grant select on table public.leave_request_replacement_signoffs to authenticated;

-- ── keep the row in step with leave_requests.replacement_id ────────────────
create function private.replacement_signoff_sync() returns trigger
  language plpgsql security definer set search_path to ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.replacement_id is not distinct from old.replacement_id then return null; end if;
    delete from public.leave_request_replacement_signoffs where request_id = new.id;
  end if;
  if new.replacement_id is not null and new.status in ('pending', 'approved') then
    insert into public.leave_request_replacement_signoffs (request_id, replacement_id)
    values (new.id, new.replacement_id)
    on conflict (request_id) do nothing;
  end if;
  return null;
end $$;

revoke all on function private.replacement_signoff_sync() from public;

create trigger replacement_signoff_sync
  after insert or update of replacement_id on public.leave_requests
  for each row execute function private.replacement_signoff_sync();

-- ── the replacement's actions ───────────────────────────────────────────────
-- Shared checks; returns the request locked, after the company lock and then the employee
-- lock (CLAUDE.md lock order).
create function private.replacement_signoff_open(p_request uuid, p_uid uuid)
  returns public.leave_requests
  language plpgsql security definer set search_path to ''
as $$
declare r public.leave_requests%rowtype; s public.leave_request_replacement_signoffs%rowtype;
begin
  if p_uid is null or not private.is_active(p_uid) then
    raise exception 'not allowed to sign this request' using errcode = '42501';
  end if;
  select * into r from public.leave_requests where id = p_request;
  if r.id is null or r.replacement_id is distinct from p_uid then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  perform private.approval_lock(r.company_id);
  perform pg_advisory_xact_lock(hashtextextended('leave:' || r.employee_id::text, 0));
  select * into r from public.leave_requests where id = p_request for update;
  select * into s from public.leave_request_replacement_signoffs where request_id = p_request for update;
  if r.replacement_id is distinct from p_uid or s.request_id is null or s.replacement_id <> p_uid then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  if s.status <> 'pending' then
    raise exception 'you have already answered this request' using errcode = '22023';
  end if;
  if r.status not in ('pending', 'approved') then
    raise exception 'this request is no longer open for your signature' using errcode = '22023';
  end if;
  return r;
end $$;

revoke all on function private.replacement_signoff_open(uuid, uuid) from public;

create function public.app_replacement_sign(p_request uuid, p_signature_data text,
  p_signature_authorized boolean) returns void
  language plpgsql security definer set search_path to ''
as $$
declare v_uid uuid := auth.uid(); r public.leave_requests%rowtype; v_now timestamptz;
begin
  perform private.separation_check_signature(p_signature_data, p_signature_authorized);
  -- Any moment while the request is pending or approved (an HR-exempt or fully signed
  -- request is already approved; the paper form still wants the replacement's box).
  r := private.replacement_signoff_open(p_request, v_uid);
  v_now := clock_timestamp();
  update public.leave_request_replacement_signoffs
     set status = 'signed', signature_data = p_signature_data,
         signature_consent_at = v_now, decided_at = v_now
   where request_id = p_request;
  -- The PNG stays out of the audit row, like the approver's.
  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (v_uid, 'replacement_sign', 'leave_requests', p_request,
          jsonb_build_object('signature_authorized', true, 'consent_at', v_now));
end $$;

revoke all on function public.app_replacement_sign(uuid, text, boolean) from public, anon;
grant execute on function public.app_replacement_sign(uuid, text, boolean) to authenticated;

-- Declining is a note to the requester, so its length message is its own.
create function public.app_replacement_decline(p_request uuid, p_note text default null)
  returns void
  language plpgsql security definer set search_path to ''
as $$
declare v_uid uuid := auth.uid(); r public.leave_requests%rowtype; v_now timestamptz;
  v_note text := nullif(btrim(p_note), '');
begin
  if length(v_note) > 500 then
    raise exception 'note is too long (max 500 characters)' using errcode = '22023';
  end if;
  r := private.replacement_signoff_open(p_request, v_uid);
  v_now := clock_timestamp();
  -- The request itself is untouched (status, approvals): it goes back to the requester.
  update public.leave_request_replacement_signoffs
     set status = 'declined', note = v_note, decided_at = v_now
   where request_id = p_request;
  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (v_uid, 'replacement_decline', 'leave_requests', p_request,
          jsonb_build_object('note', v_note));
end $$;

revoke all on function public.app_replacement_decline(uuid, text) from public, anon;
grant execute on function public.app_replacement_decline(uuid, text) to authenticated;

-- ── the requester answers a decline ────────────────────────────────────────
-- Only after the replacement declined: name someone else (they get a fresh sign-off through
-- the sync trigger) or nobody (p_replacement null = "no replacement"). Same candidates as at
-- submission. Approval rows are left as they are.
create function public.app_change_replacement(p_request uuid, p_replacement_id uuid default null)
  returns void
  language plpgsql security definer set search_path to ''
as $$
declare v_uid uuid := auth.uid(); r public.leave_requests%rowtype;
  s public.leave_request_replacement_signoffs%rowtype; v_dept uuid;
begin
  if v_uid is null or not private.is_active(v_uid) then
    raise exception 'not allowed to change this request' using errcode = '42501';
  end if;
  select * into r from public.leave_requests where id = p_request;
  if r.id is null or r.employee_id <> v_uid then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  perform private.approval_lock(r.company_id);
  perform pg_advisory_xact_lock(hashtextextended('leave:' || r.employee_id::text, 0));
  select * into r from public.leave_requests where id = p_request for update;
  select * into s from public.leave_request_replacement_signoffs where request_id = p_request for update;
  if s.request_id is null or s.status <> 'declined' then
    raise exception 'only a declined replacement can be changed' using errcode = '22023';
  end if;
  if r.status not in ('pending', 'approved') then
    raise exception 'this request is no longer open for your signature' using errcode = '22023';
  end if;
  -- The declined person may also hold this absence's temporary approval authority; moving
  -- the request away from them would leave that grant behind.
  if exists (select 1 from public.approval_delegations d
              where d.source_request_id = r.id and d.revoked_at is null) then
    raise exception 'replacement is the temporary approval delegate; cancel and file again'
      using errcode = '22023';
  end if;
  if p_replacement_id is not null then
    select department_id into v_dept from public.profiles where id = v_uid;
    if p_replacement_id = s.replacement_id then
      raise exception 'choose a different replacement' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.profiles p
       where p.id = p_replacement_id and p.active and p.company_id = r.company_id
         and ((v_dept is not null and p.department_id = v_dept)
              or private.delegate_eligible(v_uid, p.id))
         and p.id <> v_uid
    ) then
      raise exception 'replacement must be an active colleague in your department' using errcode = '22023';
    end if;
    if private.replacement_is_away(p_replacement_id, r.start_date, r.end_date, r.unit,
         r.start_time, r.end_time) then
      raise exception 'replacement is on leave during this period' using errcode = '22023';
    end if;
  end if;
  update public.leave_requests set replacement_id = p_replacement_id where id = p_request;
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (v_uid, 'replacement_change', 'leave_requests', p_request,
          jsonb_build_object('replacement_id', s.replacement_id),
          jsonb_build_object('replacement_id', p_replacement_id));
end $$;

revoke all on function public.app_change_replacement(uuid, uuid) from public, anon;
grant execute on function public.app_change_replacement(uuid, uuid) to authenticated;

-- ── what the replacement reads ──────────────────────────────────────────────
-- Explicit columns, like team_leave_calendar: never the reason (FR-25), the requester's
-- signature, the location or balances.
create function public.my_replacement_requests()
  returns table (request_id uuid, employee_name text, kind public.request_kind,
    leave_type_name_fa text, leave_type_name_en text, leave_type_color text,
    start_date date, end_date date, day_part public.day_part, unit public.leave_unit,
    start_time time, end_time time, requested_minutes integer, status public.leave_status,
    serial_year integer, serial_seq integer, created_at timestamptz,
    signoff_status text, signed_at timestamptz, signoff_note text)
  language sql stable security definer set search_path to ''
as $$
  select r.id, p.full_name, r.kind, lt.name_fa, lt.name_en, lt.color,
         r.start_date, r.end_date, r.day_part, r.unit, r.start_time, r.end_time,
         r.requested_minutes, r.status, r.serial_year, r.serial_seq, r.created_at,
         s.status, s.signature_consent_at, s.note
    from public.leave_requests r
    join public.profiles p on p.id = r.employee_id
    left join public.leave_types lt on lt.id = r.leave_type_id
    left join public.leave_request_replacement_signoffs s on s.request_id = r.id
   where private.is_active(auth.uid())
     and r.replacement_id = auth.uid()
   order by r.created_at desc
   limit 200;
$$;

revoke all on function public.my_replacement_requests() from public, anon;
grant execute on function public.my_replacement_requests() to authenticated;

-- ── calendar: the replacement sees the requests they cover ──────────────────
create or replace view public.team_leave_calendar as
 SELECT lr.id,
    lr.employee_id,
    p.full_name AS employee_name,
    p.department_id,
    lr.kind,
    lr.leave_type_id,
    lt.name_fa AS leave_type_name_fa,
    lt.name_en AS leave_type_name_en,
    lt.color AS leave_type_color,
    lr.start_date,
    lr.end_date,
    lr.day_part,
    lr.unit,
    lr.start_time,
    lr.end_time,
    lr.requested_minutes,
    lr.status
   FROM ((public.leave_requests lr
     JOIN public.profiles p ON ((p.id = lr.employee_id)))
     LEFT JOIN public.leave_types lt ON ((lt.id = lr.leave_type_id)))
  WHERE (private.is_active(auth.uid()) AND (lr.status = ANY (ARRAY['pending'::public.leave_status, 'approved'::public.leave_status])) AND ((lr.employee_id = auth.uid()) OR (lr.replacement_id = auth.uid()) OR private.same_team(auth.uid(), lr.employee_id) OR private.reads_calendar(auth.uid())))
UNION ALL
 SELECT e.id,
    lr.employee_id,
    p.full_name AS employee_name,
    p.department_id,
    lr.kind,
    lr.leave_type_id,
    NULL::text AS leave_type_name_fa,
    NULL::text AS leave_type_name_en,
    NULL::text AS leave_type_color,
    (e.old_end_date + 1) AS start_date,
    e.new_end_date AS end_date,
    lr.day_part,
    lr.unit,
    lr.start_time,
    lr.end_time,
    0 AS requested_minutes,
    'pending'::public.leave_status AS status
   FROM ((public.errand_extensions e
     JOIN public.leave_requests lr ON ((lr.id = e.request_id)))
     JOIN public.profiles p ON ((p.id = lr.employee_id)))
  WHERE ((e.status = 'pending'::text) AND (lr.status = 'approved'::public.leave_status) AND private.is_active(auth.uid()) AND ((lr.employee_id = auth.uid()) OR private.same_team(auth.uid(), lr.employee_id) OR private.reads_calendar(auth.uid())));

-- ── approval context: whether the replacement has signed ────────────────────
-- Same body as 20261108200021 plus replacement_signoff_status / replacement_signed_at
-- (null = nothing to sign: no replacement, or filed before FR-88). Informational only.
create or replace function private.request_data_app_request_approval_context(p_id uuid, p_print boolean)
  returns jsonb
  language plpgsql stable security definer set search_path to ''
as $$
declare r public.leave_requests%rowtype; v_progress jsonb; v_result jsonb;
begin
  if not (private.can_read_approval_request(auth.uid(),p_id) or
    (p_print and private.can_print_finance_request(auth.uid(),p_id))) then
    raise exception 'request not found' using errcode='P0002'; end if;
  select * into r from public.leave_requests where id=p_id;
  v_progress:=private.request_data_app_request_approval_progress(p_id,p_print);
  select (to_jsonb(r)-'signature_data'-'approver_signature_data')||jsonb_build_object(
    'employee_name',p.full_name,'employee_code',p.employee_code,
    'personnel_no',p.personnel_no,
    'job_title',case when p_print or p.id=auth.uid() or private.reads_people(auth.uid())
      or private.is_direct_manager_of(auth.uid(),p.id) or private.is_department_manager_of(auth.uid(),p.id) then p.job_title end,
    'employee_manager_id',p.manager_id,'department_id',p.department_id,
    'department_name',dep.name_fa,'department_name_fa',dep.name_fa,'department_name_en',dep.name_en,
    'employee_department_manager_id',private.department_manager_for(p.id),
    'leave_type_name_fa',lt.name_fa,'leave_type_name_en',lt.name_en,'affects_balance',lt.affects_balance,
    'leave_type_affects_balance',lt.affects_balance,'is_paid',lt.is_paid,
    'replacement_name',rp.full_name,'decided_by_name',dp.full_name,
    'replacement_conflict',case when r.replacement_id is null then false else
      private.replacement_is_away(r.replacement_id,r.start_date,r.end_date,r.unit,r.start_time,r.end_time) end,
    'replacement_signoff_status',rs.status,'replacement_signed_at',rs.signature_consent_at,
    'can_override',r.status='pending' and private.is_admin(auth.uid()),
    'can_approve',r.status='pending' and (private.is_admin(auth.uid()) or exists
      (select 1 from jsonb_array_elements(v_progress) item where (item->>'can_approve')::boolean)),
    'can_reject',r.status='pending' and (private.is_admin(auth.uid()) or exists
      (select 1 from jsonb_array_elements(v_progress) item where (item->>'can_reject')::boolean)),
    'configuration_changed',coalesce(pol.configuration_changed,false),
    'legacy_reconciliation_required',private.ambiguous_legacy_approval(r.id),
    'progress',v_progress)
  into v_result from public.profiles p left join public.departments dep on dep.id=p.department_id
    left join public.leave_types lt on lt.id=r.leave_type_id
    left join public.profiles rp on rp.id=r.replacement_id left join public.profiles dp on dp.id=r.decided_by
    left join public.leave_request_replacement_signoffs rs on rs.request_id=r.id
    left join public.approval_request_policy pol on pol.request_id=r.id where p.id=r.employee_id;
  return v_result;
end; $$;

-- ── signatures: the replacement's image beside the others ───────────────────
create or replace function private.request_data_get_leave_request_signatures(p_id uuid, p_print boolean)
  returns jsonb
  language plpgsql stable security definer set search_path to ''
as $$
declare v_result jsonb; v_progress jsonb;
begin
  if not (private.can_read_approval_request(auth.uid(),p_id) or
    (p_print and private.can_print_finance_request(auth.uid(),p_id))) then
    raise exception 'request not found' using errcode='P0002'; end if;
  v_progress:=private.request_data_app_request_approval_progress(p_id,p_print);
  select jsonb_build_object('requester_signature_data',r.signature_data,
    'requester_consent_at',r.signature_consent_at,'approver_signature_data',r.approver_signature_data,
    'approver_signature_consent_at',r.approver_signature_consent_at,
    'replacement_status',rs.status,'replacement_signature_data',rs.signature_data,
    'replacement_signature_consent_at',rs.signature_consent_at,
    'approvals',coalesce((select jsonb_agg(item||jsonb_build_object('signature_data',a.signature_data,
      'signature_consent_at',a.signature_consent_at) order by (item->>'step_order')::integer)
      from jsonb_array_elements(v_progress) item left join public.leave_request_approvals a
        on a.request_id=r.id and (a.step_id=(item->>'step_id')::uuid
          or (a.step_id is null and item->>'step_id' is null and a.step_role::text=item->>'step_role'))),'[]'))
    into v_result from public.leave_requests r
    left join public.leave_request_replacement_signoffs rs on rs.request_id=r.id
    where r.id=p_id;
  return v_result;
end; $$;
