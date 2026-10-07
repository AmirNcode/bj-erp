-- FR-54 clearance form (فرم تسویه حساب).
-- Spec: docs/specs/2026-10-07-clearance-form-design.md. Paper original: docs/forms/leave-company-form.jpeg.
--
--   separation_units     the company's default sign-off rows (admin/hr edit)
--   separations          one form per departure
--   separation_signoffs  the rows of one form, signed in parallel; finance signs last
--
-- Reads go through RLS; every write goes through a security-definer RPC below.
-- private.apply_due_separations() switches the account off the day after the last
-- working day; pg_cron runs it nightly (job 'bj-apply-separations', not in schema.sql,
-- which dumps only the public and private schemas).
-- Adds only; the app version still running during the deploy keeps working.

create extension if not exists pg_cron;

-- ── permissions ─────────────────────────────────────────────────────────────
create or replace function private.has_permission(uid uuid, p_permission text) returns boolean
    language sql stable security definer
    set search_path to ''
    as $$
  select case p_permission
    when 'employees.edit'     then private.is_admin(uid) or private.has_role(uid, 'hr')
    when 'departments.edit'   then private.is_admin(uid) or private.has_role(uid, 'hr')
    when 'accruals.run'       then private.is_admin(uid) or private.has_role(uid, 'hr')
    when 'roles.manager'      then private.is_admin(uid) or private.has_role(uid, 'hr')
    when 'personal_info.view' then private.is_admin(uid) or private.has_role(uid, 'hr')
    when 'personal_info.edit' then private.is_admin(uid) or private.has_role(uid, 'hr')
    when 'separations.manage' then private.is_admin(uid) or private.has_role(uid, 'hr')
    when 'separations.view'   then private.is_admin(uid) or private.has_role(uid, 'hr')
                                   or private.has_role(uid, 'finance')
    else false
  end;
$$;

-- ── tables ──────────────────────────────────────────────────────────────────
create table public.separation_units (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  -- hr: any hr holder signs · department: that department's manager ·
  -- own_department: the leaver's department manager (واحد مربوطه) · person: signer_id
  kind          text not null,
  name_fa       text not null,
  name_en       text not null,
  department_id uuid references public.departments(id) on delete set null,
  signer_id     uuid references public.profiles(id) on delete set null,
  sort_order    integer not null default 0,
  active        boolean not null default true,
  constraint separation_units_kind check (kind in ('hr', 'department', 'own_department', 'person')),
  constraint separation_units_names check (
    char_length(btrim(name_fa)) between 1 and 100 and char_length(btrim(name_en)) between 1 and 100),
  constraint separation_units_shape check (
       (kind = 'hr'             and department_id is null and signer_id is null and active)
    or (kind = 'department'     and signer_id is null)
    or (kind = 'own_department' and department_id is null and signer_id is null)
    or (kind = 'person'         and department_id is null))
);
create unique index separation_units_one_hr on public.separation_units (company_id) where kind = 'hr';
create index separation_units_company_idx on public.separation_units (company_id, sort_order);

create table public.separations (
  id                            uuid primary key default gen_random_uuid(),
  company_id                    uuid not null references public.companies(id),
  employee_id                   uuid not null references public.profiles(id) on delete cascade,
  reason                        text not null,
  last_working_day              date not null,
  hire_date                     date,
  father_name                   text,
  birth_cert_no                 text,
  note                          text,
  status                        text not null default 'in_progress',
  finance_signed_by             uuid references public.profiles(id) on delete set null,
  finance_signed_at             timestamptz,
  finance_signature_data        text,
  finance_signature_consent_at  timestamptz,
  finance_note                  text,
  settlement_date               date,
  deactivated_at                timestamptz,
  created_by                    uuid references public.profiles(id) on delete set null,
  created_at                    timestamptz not null default now(),
  cancelled_by                  uuid references public.profiles(id) on delete set null,
  cancelled_at                  timestamptz,
  constraint separations_reason check (
    reason in ('resignation', 'dismissal', 'contract_end', 'abandonment', 'redundancy')),
  constraint separations_status check (
    status in ('in_progress', 'awaiting_finance', 'completed', 'cancelled')),
  constraint separations_father_name check (
    father_name is null or char_length(btrim(father_name)) between 1 and 100),
  constraint separations_birth_cert_no check (birth_cert_no is null or birth_cert_no ~ '^[0-9]{1,10}$'),
  constraint separations_note_len check (note is null or length(note) <= 500),
  constraint separations_finance_note_len check (finance_note is null or length(finance_note) <= 500),
  constraint separations_completed_shape check (
    (status = 'completed') = (finance_signed_at is not null and settlement_date is not null)),
  constraint separations_cancelled_shape check ((status = 'cancelled') = (cancelled_at is not null)),
  constraint separations_finance_signature_shape check (
    (finance_signature_data is null and finance_signature_consent_at is null)
    or (finance_signature_data is not null and finance_signature_consent_at is not null
        and length(finance_signature_data) between 100 and 350000
        and mod(length(finance_signature_data), 4) = 2
        and finance_signature_data ~ '^data:image/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$'))
);
-- One live form per person: in progress, or finished but not yet applied.
create unique index separations_one_live on public.separations (employee_id)
  where status <> 'cancelled' and deactivated_at is null;
create index separations_company_idx on public.separations (company_id, created_at desc);
create index separations_due_idx on public.separations (last_working_day)
  where status <> 'cancelled' and deactivated_at is null;

create table public.separation_signoffs (
  id                    uuid primary key default gen_random_uuid(),
  separation_id         uuid not null references public.separations(id) on delete cascade,
  is_hr                 boolean not null default false,
  name_fa               text not null,
  name_en               text not null,
  department_id         uuid references public.departments(id) on delete set null,
  signer_id             uuid references public.profiles(id) on delete set null,
  sort_order            integer not null default 0,
  signed_by             uuid references public.profiles(id) on delete set null,
  signed_at             timestamptz,
  signature_data        text,
  signature_consent_at  timestamptz,
  note                  text,
  constraint separation_signoffs_names check (
    char_length(btrim(name_fa)) between 1 and 100 and char_length(btrim(name_en)) between 1 and 100),
  constraint separation_signoffs_hr_no_signer check (not is_hr or signer_id is null),
  constraint separation_signoffs_note_len check (note is null or length(note) <= 500),
  constraint separation_signoffs_signed_shape check ((signed_at is null) = (signature_data is null)),
  constraint separation_signoffs_signature_shape check (
    (signature_data is null and signature_consent_at is null)
    or (signature_data is not null and signature_consent_at is not null
        and length(signature_data) between 100 and 350000
        and mod(length(signature_data), 4) = 2
        and signature_data ~ '^data:image/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$'))
);
create unique index separation_signoffs_one_hr on public.separation_signoffs (separation_id) where is_hr;
create index separation_signoffs_separation_idx on public.separation_signoffs (separation_id, sort_order);
create index separation_signoffs_open_signer_idx on public.separation_signoffs (signer_id)
  where signed_at is null;

-- ── read access ─────────────────────────────────────────────────────────────
-- Admin, hr and finance read every form of their company; the leaver reads their
-- own; anyone named on a row reads that whole form (D10).
create function private.can_read_separation(uid uuid, p_id uuid) returns boolean
    language sql stable security definer
    set search_path to ''
    as $$
  select private.is_active(uid)
     and exists (
       select 1
         from public.separations s
         join public.profiles c on c.id = uid and c.company_id = s.company_id
        where s.id = p_id
          and (private.has_permission(uid, 'separations.view')
               or s.employee_id = uid
               or exists (select 1 from public.separation_signoffs o
                           where o.separation_id = s.id and o.signer_id = uid))
     );
$$;
revoke all on function private.can_read_separation(uuid, uuid) from public;
grant execute on function private.can_read_separation(uuid, uuid) to authenticated;

alter table public.separation_units enable row level security;
alter table public.separations enable row level security;
alter table public.separation_signoffs enable row level security;
revoke all on table public.separation_units from anon, authenticated;
revoke all on table public.separations from anon, authenticated;
revoke all on table public.separation_signoffs from anon, authenticated;
grant select on table public.separation_units to authenticated;
grant select on table public.separations to authenticated;
grant select on table public.separation_signoffs to authenticated;

create policy separation_units_select on public.separation_units for select to authenticated
  using (
    private.is_active((select auth.uid()))
    and company_id = (select p.company_id from public.profiles p where p.id = (select auth.uid()))
  );
create policy separations_select on public.separations for select to authenticated
  using (private.can_read_separation((select auth.uid()), id));
create policy separation_signoffs_select on public.separation_signoffs for select to authenticated
  using (private.can_read_separation((select auth.uid()), separation_id));

-- ── the profile guard: let the apply job switch an account off ──────────────
-- Unchanged from 20261007130001 except the first block. pg_cron runs with no
-- auth.uid(), which the guard otherwise refuses. The flag is transaction-local and
-- only set by private.apply_due_separations; it admits an active true→false change
-- and nothing else.
create or replace function private.enforce_profile_update_scope() returns trigger
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  v_uid     uuid := auth.uid();
  v_allowed text[];
begin
  if coalesce(current_setting('bj.separation_apply', true), '') = 'on'
     and old.active and not new.active
     and (to_jsonb(new) - 'active') = (to_jsonb(old) - 'active')
  then
    return new;
  end if;

  if private.is_admin(v_uid) then
    return new;  -- admins may change anything
  end if;

  if new.id = v_uid then
    v_allowed := array['full_name', 'language_pref', 'calendar_pref'];
  elsif private.has_permission(v_uid, 'employees.edit')
        and old.company_id = (select company_id from public.profiles where id = v_uid)
        -- An admin's record is admin-only, even while that admin is deactivated
        -- (so an editor cannot reactivate one): check the role row, not is_admin.
        and not exists (select 1 from public.user_roles where user_id = old.id and role = 'admin')
  then
    v_allowed := array['full_name', 'hire_date', 'department_id', 'manager_id', 'job_title', 'active'];
  elsif private.is_manager_of(v_uid, new.id) then
    v_allowed := array['full_name', 'hire_date'];
  else
    raise exception 'not permitted to update this profile' using errcode = '42501';
  end if;

  if (new.id            is distinct from old.id)
     or (new.company_id    is distinct from old.company_id)
     or (new.employee_code is distinct from old.employee_code)
     or (new.personnel_no  is distinct from old.personnel_no)
     or (new.created_at    is distinct from old.created_at)
     or (new.must_change_password is distinct from old.must_change_password
         and coalesce(current_setting('bj.password_flag_write', true), '') <> 'on')
     or (new.full_name     is distinct from old.full_name     and not ('full_name'     = any (v_allowed)))
     or (new.hire_date     is distinct from old.hire_date     and not ('hire_date'     = any (v_allowed)))
     or (new.department_id is distinct from old.department_id and not ('department_id' = any (v_allowed)))
     or (new.manager_id    is distinct from old.manager_id    and not ('manager_id'    = any (v_allowed)))
     or (new.job_title     is distinct from old.job_title     and not ('job_title'     = any (v_allowed)))
     or (new.active        is distinct from old.active        and not ('active'        = any (v_allowed)))
     or (new.language_pref is distinct from old.language_pref and not ('language_pref' = any (v_allowed)))
     or (new.calendar_pref is distinct from old.calendar_pref and not ('calendar_pref' = any (v_allowed)))
  then
    raise exception 'not permitted to modify restricted profile fields' using errcode = '42501';
  end if;

  return new;
end; $$;

-- ── apply: switch accounts off after the last working day ───────────────────
-- p_id null = every due form (the nightly job); otherwise only that form, and
-- a refusal is raised to the caller instead of being logged.
create function private.apply_due_separations(p_id uuid default null) returns integer
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  v_today     date := (now() at time zone 'Asia/Tehran')::date;
  v_count     integer := 0;
  v_cancelled integer;
  r           record;
begin
  perform set_config('bj.separation_apply', 'on', true);
  for r in
    select s.id, s.employee_id
      from public.separations s
     where s.status <> 'cancelled'
       and s.deactivated_at is null
       and s.last_working_day < v_today
       and (p_id is null or s.id = p_id)
     order by s.last_working_day
       for update
  loop
    begin
      update public.profiles set active = false where id = r.employee_id and active;
      -- Pending requests die with the account; approved leave is left alone (A9).
      update public.leave_requests
         set status = 'cancelled', decided_at = now()
       where employee_id = r.employee_id and status = 'pending';
      get diagnostics v_cancelled = row_count;
      update public.separations set deactivated_at = now() where id = r.id;
      insert into public.audit_log (actor_id, action, entity, entity_id, after)
      values (auth.uid(), 'separation.deactivate', 'separations', r.id,
              jsonb_build_object('employee_id', r.employee_id, 'pending_cancelled', v_cancelled));
      v_count := v_count + 1;
    exception when others then
      if p_id is not null then
        raise;
      end if;
      insert into public.audit_log (actor_id, action, entity, entity_id, after)
      values (null, 'separation.deactivate_failed', 'separations', r.id,
              jsonb_build_object('employee_id', r.employee_id, 'error', sqlerrm));
    end;
  end loop;
  perform set_config('bj.separation_apply', 'off', true);
  return v_count;
end; $$;
revoke all on function private.apply_due_separations(uuid) from public;

-- ── helpers shared by the RPCs ──────────────────────────────────────────────
create function private.separation_caller_company(p_uid uuid) returns uuid
    language plpgsql stable security definer
    set search_path to ''
    as $$
begin
  if p_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not private.is_active(p_uid) then
    raise exception 'account is inactive' using errcode = '42501';
  end if;
  return (select company_id from public.profiles where id = p_uid);
end; $$;
revoke all on function private.separation_caller_company(uuid) from public;

-- Validates one row of a form's p_rows payload and resolves its signer.
-- A department row is signed by that department's active manager; if there is
-- none, or it is the leaver, the row starts unassigned (A6).
create function private.separation_row_signer(p_company uuid, p_employee uuid, p_row jsonb)
    returns uuid
    language plpgsql stable security definer
    set search_path to ''
    as $$
declare
  v_dept   uuid := nullif(p_row->>'department_id', '')::uuid;
  v_signer uuid := nullif(p_row->>'signer_id', '')::uuid;
begin
  if jsonb_typeof(p_row) <> 'object'
     or coalesce(char_length(btrim(p_row->>'name_fa')), 0) not between 1 and 100
     or coalesce(char_length(btrim(p_row->>'name_en')), 0) not between 1 and 100 then
    raise exception 'invalid rows' using errcode = '22023';
  end if;
  if v_dept is not null
     and not exists (select 1 from public.departments where id = v_dept and company_id = p_company) then
    raise exception 'invalid rows' using errcode = '22023';
  end if;
  if v_signer is not null then
    if v_signer = p_employee then
      raise exception 'the departing employee cannot sign their own form' using errcode = '22023';
    end if;
    if not exists (select 1 from public.profiles
                    where id = v_signer and company_id = p_company and active) then
      raise exception 'invalid rows' using errcode = '22023';
    end if;
    return v_signer;
  end if;
  if v_dept is not null then
    select d.manager_id into v_signer
      from public.departments d
      join public.profiles m on m.id = d.manager_id and m.active
     where d.id = v_dept;
    if v_signer = p_employee then
      return null;
    end if;
    return v_signer;
  end if;
  return null;
end; $$;
revoke all on function private.separation_row_signer(uuid, uuid, jsonb) from public;

-- in_progress → awaiting_finance once no row is left unsigned.
create function private.refresh_separation_status(p_id uuid) returns void
    language sql security definer
    set search_path to ''
    as $$
  update public.separations s
     set status = 'awaiting_finance'
   where s.id = p_id
     and s.status = 'in_progress'
     and not exists (select 1 from public.separation_signoffs o
                      where o.separation_id = s.id and o.signed_at is null);
$$;
revoke all on function private.refresh_separation_status(uuid) from public;

-- The manager may act on this form: same company, and hr never on an admin's (A2).
create function private.separation_manageable(p_uid uuid, p_company uuid, p_employee uuid)
    returns void
    language plpgsql stable security definer
    set search_path to ''
    as $$
begin
  if not private.has_permission(p_uid, 'separations.manage') then
    raise exception 'not allowed to manage clearance forms' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_employee and company_id = p_company) then
    raise exception 'employee not found' using errcode = '42501';
  end if;
  if not private.is_admin(p_uid)
     and exists (select 1 from public.user_roles where user_id = p_employee and role = 'admin') then
    raise exception 'not allowed to file a clearance form for this employee' using errcode = '42501';
  end if;
end; $$;
revoke all on function private.separation_manageable(uuid, uuid, uuid) from public;

create function private.separation_check_signature(p_data text, p_authorized boolean) returns void
    language plpgsql immutable
    set search_path to ''
    as $$
begin
  if not coalesce(p_authorized, false) then
    raise exception 'signature authorization is required' using errcode = '22023';
  end if;
  if p_data is null or p_data = '' then
    raise exception 'signature is required' using errcode = '22023';
  end if;
  if length(p_data) not between 100 and 350000
     or mod(length(p_data), 4) <> 2
     or p_data !~ '^data:image/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$' then
    raise exception 'signature data is invalid' using errcode = '22023';
  end if;
end; $$;
revoke all on function private.separation_check_signature(text, boolean) from public;

create function private.separation_check_fields(p_reason text, p_last_day date, p_note text) returns void
    language plpgsql immutable
    set search_path to ''
    as $$
begin
  if p_reason is null
     or p_reason not in ('resignation', 'dismissal', 'contract_end', 'abandonment', 'redundancy') then
    raise exception 'invalid reason' using errcode = '22023';
  end if;
  if p_last_day is null then
    raise exception 'last working day is required' using errcode = '22023';
  end if;
  if p_note is not null and length(p_note) > 500 then
    raise exception 'note is too long' using errcode = '22023';
  end if;
end; $$;
revoke all on function private.separation_check_fields(text, date, text) from public;

-- ── RPCs ────────────────────────────────────────────────────────────────────
create function public.app_create_separation(
  p_employee_id uuid, p_reason text, p_last_working_day date,
  p_father_name text, p_birth_cert_no text, p_note text, p_rows jsonb)
    returns uuid
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  v_uid     uuid := auth.uid();
  v_company uuid := private.separation_caller_company(v_uid);
  v_father  text := nullif(btrim(p_father_name), '');
  v_cert    text := nullif(btrim(p_birth_cert_no), '');
  v_note    text := nullif(btrim(p_note), '');
  v_hr_fa   text;
  v_hr_en   text;
  v_id      uuid;
  v_row     jsonb;
  v_i       integer := 0;
begin
  if p_employee_id = v_uid then
    raise exception 'cannot file a clearance form for yourself' using errcode = '42501';
  end if;
  perform private.separation_manageable(v_uid, v_company, p_employee_id);
  perform private.separation_check_fields(p_reason, p_last_working_day, v_note);
  if v_father is not null and char_length(v_father) > 100 then
    raise exception 'invalid father name' using errcode = '22023';
  end if;
  if v_cert is not null and v_cert !~ '^[0-9]{1,10}$' then
    raise exception 'invalid birth certificate number' using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'invalid rows' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('separation:' || p_employee_id::text, 0));
  if exists (select 1 from public.separations
              where employee_id = p_employee_id and status <> 'cancelled' and deactivated_at is null) then
    raise exception 'employee already has an open clearance form' using errcode = '23505';
  end if;
  -- The last active admin can never be switched off; refuse the form up front.
  if exists (select 1 from public.user_roles where user_id = p_employee_id and role = 'admin')
     and not exists (select 1 from public.profiles p
                       join public.user_roles r on r.user_id = p.id and r.role = 'admin'
                      where p.active and p.id <> p_employee_id) then
    raise exception 'cannot deactivate the last active admin' using errcode = '22023';
  end if;

  -- D8: personal info wins; what HR typed fills only what is missing there, and is
  -- written back so the profile is complete next time.
  update public.employee_personal_info
     set father_name   = coalesce(father_name, v_father),
         birth_cert_no = coalesce(birth_cert_no, v_cert)
   where employee_id = p_employee_id
     and ((father_name is null and v_father is not null)
          or (birth_cert_no is null and v_cert is not null));
  select coalesce(i.father_name, v_father), coalesce(i.birth_cert_no, v_cert)
    into v_father, v_cert
    from (select 1) one
    left join public.employee_personal_info i on i.employee_id = p_employee_id;

  insert into public.separations (company_id, employee_id, reason, last_working_day, hire_date,
                                  father_name, birth_cert_no, note, created_by)
  select v_company, p_employee_id, p_reason, p_last_working_day, p.hire_date,
         v_father, v_cert, v_note, v_uid
    from public.profiles p where p.id = p_employee_id
  returning id into v_id;

  select name_fa, name_en into v_hr_fa, v_hr_en
    from public.separation_units where company_id = v_company and kind = 'hr';
  insert into public.separation_signoffs (separation_id, is_hr, name_fa, name_en, sort_order)
  values (v_id, true, coalesce(v_hr_fa, 'مدیر اداری و منابع انسانی'),
          coalesce(v_hr_en, 'HR & administration'), 0);

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    insert into public.separation_signoffs (separation_id, name_fa, name_en, department_id, signer_id, sort_order)
    values (v_id, btrim(v_row->>'name_fa'), btrim(v_row->>'name_en'),
            nullif(v_row->>'department_id', '')::uuid,
            private.separation_row_signer(v_company, p_employee_id, v_row), v_i);
  end loop;

  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (v_uid, 'separation.create', 'separations', v_id,
          jsonb_build_object('employee_id', p_employee_id, 'reason', p_reason,
                             'last_working_day', p_last_working_day, 'rows', v_i + 1));

  perform private.apply_due_separations(v_id);
  return v_id;
end; $$;

create function public.app_update_separation(
  p_id uuid, p_reason text, p_last_working_day date, p_note text)
    returns void
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  v_uid     uuid := auth.uid();
  v_company uuid := private.separation_caller_company(v_uid);
  v_note    text := nullif(btrim(p_note), '');
  s         record;
begin
  select * into s from public.separations where id = p_id and company_id = v_company for update;
  if not found then
    raise exception 'clearance form not found' using errcode = 'P0002';
  end if;
  perform private.separation_manageable(v_uid, v_company, s.employee_id);
  if s.status = 'cancelled' then
    raise exception 'form is not open for changes' using errcode = '22023';
  end if;
  if s.deactivated_at is not null then
    raise exception 'form already applied' using errcode = '22023';
  end if;
  perform private.separation_check_fields(p_reason, p_last_working_day, v_note);

  update public.separations
     set reason = p_reason, last_working_day = p_last_working_day, note = v_note
   where id = p_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (v_uid, 'separation.update', 'separations', p_id,
          jsonb_build_object('reason', s.reason, 'last_working_day', s.last_working_day),
          jsonb_build_object('reason', p_reason, 'last_working_day', p_last_working_day));
  perform private.apply_due_separations(p_id);
end; $$;

-- Replace the non-HR rows of an in-progress form. Rows with an id keep their
-- identity; a signed row must be present and only its position may change (A4).
create function public.app_set_separation_signoffs(p_id uuid, p_rows jsonb)
    returns void
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  v_uid     uuid := auth.uid();
  v_company uuid := private.separation_caller_company(v_uid);
  s         record;
  v_row     jsonb;
  v_row_id  uuid;
  v_keep    uuid[] := '{}';
  v_i       integer := 0;
  o         record;
begin
  select * into s from public.separations where id = p_id and company_id = v_company for update;
  if not found then
    raise exception 'clearance form not found' using errcode = 'P0002';
  end if;
  perform private.separation_manageable(v_uid, v_company, s.employee_id);
  if s.status <> 'in_progress' then
    raise exception 'form is not open for changes' using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'invalid rows' using errcode = '22023';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    v_row_id := nullif(v_row->>'id', '')::uuid;
    if v_row_id is null then
      insert into public.separation_signoffs (separation_id, name_fa, name_en, department_id, signer_id, sort_order)
      values (p_id, btrim(v_row->>'name_fa'), btrim(v_row->>'name_en'),
              nullif(v_row->>'department_id', '')::uuid,
              private.separation_row_signer(v_company, s.employee_id, v_row), v_i)
      returning id into v_row_id;
    else
      select * into o from public.separation_signoffs where id = v_row_id and separation_id = p_id;
      if not found or o.is_hr then
        raise exception 'invalid rows' using errcode = '22023';
      end if;
      if o.signed_at is not null then
        update public.separation_signoffs set sort_order = v_i where id = v_row_id;
      else
        update public.separation_signoffs
           set name_fa = btrim(v_row->>'name_fa'), name_en = btrim(v_row->>'name_en'),
               department_id = nullif(v_row->>'department_id', '')::uuid,
               signer_id = private.separation_row_signer(v_company, s.employee_id, v_row),
               sort_order = v_i
         where id = v_row_id;
      end if;
    end if;
    v_keep := v_keep || v_row_id;
  end loop;

  if exists (select 1 from public.separation_signoffs
              where separation_id = p_id and not is_hr and signed_at is not null
                and not (id = any (v_keep))) then
    raise exception 'signed rows cannot be changed' using errcode = '22023';
  end if;
  delete from public.separation_signoffs
   where separation_id = p_id and not is_hr and signed_at is null and not (id = any (v_keep));

  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (v_uid, 'separation.rows', 'separations', p_id, jsonb_build_object('rows', v_i + 1));
  perform private.refresh_separation_status(p_id);
end; $$;

create function public.app_sign_separation_row(
  p_row_id uuid, p_signature_data text, p_signature_authorized boolean, p_note text)
    returns void
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  v_uid     uuid := auth.uid();
  v_company uuid := private.separation_caller_company(v_uid);
  v_note    text := nullif(btrim(p_note), '');
  o         record;
  s         record;
begin
  perform private.separation_check_signature(p_signature_data, p_signature_authorized);
  if v_note is not null and length(v_note) > 500 then
    raise exception 'note is too long' using errcode = '22023';
  end if;

  select * into s from public.separations
   where id = (select separation_id from public.separation_signoffs where id = p_row_id)
     and company_id = v_company
     for update;
  if not found then
    raise exception 'clearance form not found' using errcode = 'P0002';
  end if;
  if s.employee_id = v_uid then
    raise exception 'you cannot sign your own clearance form' using errcode = '42501';
  end if;
  if s.status <> 'in_progress' then
    raise exception 'form is not open for signing' using errcode = '22023';
  end if;
  -- Re-read under the form lock: a concurrent signer may have just signed it.
  select * into o from public.separation_signoffs where id = p_row_id;
  if o.signed_at is not null then
    raise exception 'row already signed' using errcode = '22023';
  end if;
  if o.is_hr then
    -- A5: any hr holder or an admin signs the HR row.
    if not (private.has_role(v_uid, 'hr') or private.is_admin(v_uid)) then
      raise exception 'row is not yours to sign' using errcode = '42501';
    end if;
  elsif o.signer_id is null then
    raise exception 'row has no signer yet' using errcode = '22023';
  elsif o.signer_id <> v_uid then
    raise exception 'row is not yours to sign' using errcode = '42501';
  end if;

  update public.separation_signoffs
     set signed_by = v_uid, signed_at = now(), signature_data = p_signature_data,
         signature_consent_at = now(), note = v_note
   where id = p_row_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (v_uid, 'separation.sign', 'separation_signoffs', p_row_id,
          jsonb_build_object('separation_id', s.id));
  perform private.refresh_separation_status(s.id);
end; $$;

create function public.app_sign_separation_finance(
  p_id uuid, p_signature_data text, p_signature_authorized boolean, p_note text, p_settlement_date date)
    returns void
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  v_uid     uuid := auth.uid();
  v_company uuid := private.separation_caller_company(v_uid);
  v_note    text := nullif(btrim(p_note), '');
  s         record;
begin
  if not private.has_role(v_uid, 'finance') then
    raise exception 'not allowed to sign as finance' using errcode = '42501';
  end if;
  perform private.separation_check_signature(p_signature_data, p_signature_authorized);
  if v_note is not null and length(v_note) > 500 then
    raise exception 'note is too long' using errcode = '22023';
  end if;
  select * into s from public.separations where id = p_id and company_id = v_company for update;
  if not found then
    raise exception 'clearance form not found' using errcode = 'P0002';
  end if;
  if s.employee_id = v_uid then
    raise exception 'you cannot sign your own clearance form' using errcode = '42501';
  end if;
  if s.status <> 'awaiting_finance' then
    raise exception 'form is not awaiting finance' using errcode = '22023';
  end if;

  update public.separations
     set status = 'completed', finance_signed_by = v_uid, finance_signed_at = now(),
         finance_signature_data = p_signature_data, finance_signature_consent_at = now(),
         finance_note = v_note,
         settlement_date = coalesce(p_settlement_date, (now() at time zone 'Asia/Tehran')::date)
   where id = p_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (v_uid, 'separation.finance', 'separations', p_id, null);
end; $$;

create function public.app_cancel_separation(p_id uuid)
    returns void
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  v_uid     uuid := auth.uid();
  v_company uuid := private.separation_caller_company(v_uid);
  s         record;
begin
  select * into s from public.separations where id = p_id and company_id = v_company for update;
  if not found then
    raise exception 'clearance form not found' using errcode = 'P0002';
  end if;
  perform private.separation_manageable(v_uid, v_company, s.employee_id);
  if s.status = 'cancelled' then
    raise exception 'form is not open for changes' using errcode = '22023';
  end if;
  if s.deactivated_at is not null then
    raise exception 'form already applied' using errcode = '22023';
  end if;
  update public.separations set status = 'cancelled', cancelled_by = v_uid, cancelled_at = now()
   where id = p_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (v_uid, 'separation.cancel', 'separations', p_id, null);
end; $$;

-- Replace the company's default rows. The HR row is kept and may only be renamed.
create function public.app_save_separation_units(p_units jsonb)
    returns void
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  v_uid     uuid := auth.uid();
  v_company uuid := private.separation_caller_company(v_uid);
  v_unit    jsonb;
  v_id      uuid;
  v_kind    text;
  v_dept    uuid;
  v_signer  uuid;
  v_keep    uuid[] := '{}';
  v_i       integer := 0;
begin
  if not private.has_permission(v_uid, 'separations.manage') then
    raise exception 'not allowed to manage clearance forms' using errcode = '42501';
  end if;
  if p_units is null or jsonb_typeof(p_units) <> 'array' then
    raise exception 'invalid rows' using errcode = '22023';
  end if;
  insert into public.separation_units (company_id, kind, name_fa, name_en, sort_order)
  values (v_company, 'hr', 'مدیر اداری و منابع انسانی', 'HR & administration', 0)
  on conflict (company_id) where kind = 'hr' do nothing;

  for v_unit in select value from jsonb_array_elements(p_units) loop
    v_kind := v_unit->>'kind';
    if jsonb_typeof(v_unit) <> 'object'
       or coalesce(char_length(btrim(v_unit->>'name_fa')), 0) not between 1 and 100
       or coalesce(char_length(btrim(v_unit->>'name_en')), 0) not between 1 and 100 then
      raise exception 'invalid rows' using errcode = '22023';
    end if;
    if v_kind = 'hr' then
      update public.separation_units
         set name_fa = btrim(v_unit->>'name_fa'), name_en = btrim(v_unit->>'name_en')
       where company_id = v_company and kind = 'hr';
      continue;
    end if;
    if v_kind is null or v_kind not in ('department', 'own_department', 'person') then
      raise exception 'invalid rows' using errcode = '22023';
    end if;
    v_i := v_i + 1;
    v_dept   := case when v_kind = 'department' then nullif(v_unit->>'department_id', '')::uuid end;
    v_signer := case when v_kind = 'person' then nullif(v_unit->>'signer_id', '')::uuid end;
    if v_kind = 'department' and (v_dept is null or not exists (
         select 1 from public.departments where id = v_dept and company_id = v_company)) then
      raise exception 'invalid rows' using errcode = '22023';
    end if;
    if v_signer is not null and not exists (
         select 1 from public.profiles where id = v_signer and company_id = v_company and active) then
      raise exception 'invalid rows' using errcode = '22023';
    end if;
    v_id := nullif(v_unit->>'id', '')::uuid;
    if v_id is not null and exists (select 1 from public.separation_units
                                     where id = v_id and company_id = v_company and kind <> 'hr') then
      update public.separation_units
         set kind = v_kind, name_fa = btrim(v_unit->>'name_fa'), name_en = btrim(v_unit->>'name_en'),
             department_id = v_dept, signer_id = v_signer, sort_order = v_i,
             active = coalesce((v_unit->>'active')::boolean, true)
       where id = v_id;
    else
      insert into public.separation_units (company_id, kind, name_fa, name_en, department_id, signer_id, sort_order, active)
      values (v_company, v_kind, btrim(v_unit->>'name_fa'), btrim(v_unit->>'name_en'), v_dept, v_signer, v_i,
              coalesce((v_unit->>'active')::boolean, true))
      returning id into v_id;
    end if;
    v_keep := v_keep || v_id;
  end loop;

  delete from public.separation_units
   where company_id = v_company and kind <> 'hr' and not (id = any (v_keep));
  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (v_uid, 'separation.units', 'separation_units', null, jsonb_build_object('units', v_i + 1));
end; $$;

-- D12: what the leaver still holds, shown as warnings while filing.
create function public.app_separation_warnings(p_employee_id uuid)
    returns jsonb
    language plpgsql stable security definer
    set search_path to ''
    as $$
declare
  v_uid     uuid := auth.uid();
  v_company uuid := private.separation_caller_company(v_uid);
begin
  if not private.has_permission(v_uid, 'separations.manage') then
    raise exception 'not allowed to manage clearance forms' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_employee_id and company_id = v_company) then
    raise exception 'employee not found' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'pending_requests', (select count(*) from public.leave_requests
                          where employee_id = p_employee_id and status = 'pending'),
    'direct_reports', (select count(*) from public.profiles
                        where manager_id = p_employee_id and active),
    'departments_managed', (select count(*) from public.departments
                             where manager_id = p_employee_id),
    'approval_steps', (select count(*) from public.approval_steps
                        where approver_id = p_employee_id and active));
end; $$;

-- D13: the leaver's remaining balance per type, for anyone who may read the form
-- (finance cannot read the ledger directly).
create function public.app_separation_balances(p_id uuid)
    returns table (leave_type_id uuid, name_fa text, name_en text, balance_minutes integer)
    language plpgsql stable security definer
    set search_path to ''
    as $$
declare
  v_uid uuid := auth.uid();
  v_emp uuid;
begin
  if not private.can_read_separation(v_uid, p_id) then
    raise exception 'clearance form not found' using errcode = 'P0002';
  end if;
  select employee_id into v_emp from public.separations where id = p_id;
  return query
    select t.id, t.name_fa, t.name_en,
           coalesce((select l.balance_after_minutes from public.leave_ledger l
                      where l.employee_id = v_emp and l.leave_type_id = t.id
                      order by l.seq desc limit 1), 0)
      from public.leave_types t
      join public.profiles p on p.id = v_emp and p.company_id = t.company_id
     where t.active and t.affects_balance
     order by t.name_fa;
end; $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.app_create_separation(uuid, text, date, text, text, text, jsonb)',
    'public.app_update_separation(uuid, text, date, text)',
    'public.app_set_separation_signoffs(uuid, jsonb)',
    'public.app_sign_separation_row(uuid, text, boolean, text)',
    'public.app_sign_separation_finance(uuid, text, boolean, text, date)',
    'public.app_cancel_separation(uuid)',
    'public.app_save_separation_units(jsonb)',
    'public.app_separation_warnings(uuid)',
    'public.app_separation_balances(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ── seed: the paper form's rows (D3), plus IT ───────────────────────────────
-- Non-HR rows start unassigned; admin or hr links departments / people in the
-- default-rows screen. The paper's finance-manager row is left out: finance signs
-- the final step.
insert into public.separation_units (company_id, kind, name_fa, name_en, sort_order)
select c.id, u.kind, u.name_fa, u.name_en, u.ord
  from public.companies c
 cross join (values
   ('hr',             'مدیر اداری و منابع انسانی', 'HR & administration',     0),
   ('person',         'مسئول انبارها',              'Warehouses',              1),
   ('person',         'مسئول تعمیرات',              'Maintenance',             2),
   ('person',         'مدیر کنترل کیفیت',           'Quality control manager', 3),
   ('own_department', 'واحد مربوطه',                'Employee''s department',  4),
   ('person',         'صندوق',                      'Cashier',                 5),
   ('person',         'جمع‌داری',                   'Asset custody',           6),
   ('person',         'فناوری اطلاعات',             'IT (equipment return)',   7),
   ('person',         'مدیر اجرایی',                'Executive manager',       8),
   ('person',         'مدیریت',                     'Management',              9)
 ) as u(kind, name_fa, name_en, ord);

-- ── nightly job: 20:35 UTC = 00:05 Asia/Tehran (no DST since 2022) ─────────
select cron.schedule('bj-apply-separations', '35 20 * * *',
                     'select private.apply_due_separations()');
