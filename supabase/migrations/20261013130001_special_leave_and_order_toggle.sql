-- FR-65 / FR-66 (2026-10-13).
--
-- FR-65 «مرخصی خارج از لیست»: hr (or admin) grants 3 extra days of annual leave
--   * for a FIRST marriage — once, only while personal info says single
--     (مجرد); the grant switches marital status to married (متأهل), and
--   * for the death of a close relative — once per death.
--   Each grant posts an `allocation` ledger row on the company's Annual Leave
--   type (3 x the company day length) and is recorded in special_leave_grants.
--   A grant made by mistake is revoked with a reversing `adjustment` row (a
--   revoked marriage grant also restores the previous marital status).
--   Permission key `special_leave.grant` (admin, hr) — FR-55 maps it.
--   As with balances (FR-43), nobody but an admin grants to themself, and hr
--   never to an admin.
--
-- FR-66: hr may switch approval_order_enforced (it already edits the steps);
--   the work_settings scope trigger now keeps only hours_per_day admin-only.

CREATE OR REPLACE FUNCTION private.has_permission(uid uuid, p_permission text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select case p_permission
    when 'employees.edit'     then private.is_admin(uid) or private.has_role(uid, 'hr')
    when 'departments.edit'   then private.is_admin(uid) or private.has_role(uid, 'hr')
    when 'accruals.run'       then private.is_admin(uid) or private.has_role(uid, 'hr')
    when 'roles.manager'      then private.is_admin(uid) or private.has_role(uid, 'hr')
    when 'personal_info.view' then private.is_admin(uid) or private.has_role(uid, 'hr')
    when 'personal_info.edit' then private.is_admin(uid) or private.has_role(uid, 'hr')
    when 'personal_info.edit_own' then private.is_admin(uid)
    when 'special_leave.grant' then private.is_admin(uid) or private.has_role(uid, 'hr')
    when 'separations.manage' then private.is_admin(uid) or private.has_role(uid, 'hr')
    when 'separations.view'   then private.is_admin(uid) or private.has_role(uid, 'hr')
                                   or private.has_role(uid, 'finance')
    when 'settings.edit'      then private.is_admin(uid) or private.has_role(uid, 'hr')
    when 'absences.view'      then private.is_admin(uid) or private.has_role(uid, 'security')
    when 'finance.view'       then private.is_admin(uid) or private.has_role(uid, 'finance')
    else false
  end;
$$;

create or replace function private.enforce_work_settings_scope() returns trigger
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  v_uid uuid := auth.uid();
begin
  -- Direct SQL (migrations, superuser) has no JWT and is not limited.
  if v_uid is null or private.is_admin(v_uid) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.hours_per_day is distinct from 8 then
      raise exception 'only an admin may change the hours per day' using errcode = '42501';
    end if;
  elsif new.hours_per_day is distinct from old.hours_per_day then
    raise exception 'only an admin may change the hours per day' using errcode = '42501';
  end if;
  return new;
end; $$;

-- ── special leave grants ────────────────────────────────────────────────────
create table public.special_leave_grants (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id),
  employee_id         uuid not null references public.profiles(id) on delete cascade,
  kind                text not null check (kind in ('marriage', 'bereavement')),
  leave_type_id       uuid not null references public.leave_types(id),
  minutes             integer not null check (minutes > 0),
  prev_marital_status text,
  granted_by          uuid references public.profiles(id),
  granted_at          timestamptz not null default now(),
  revoked_by          uuid references public.profiles(id),
  revoked_at          timestamptz
);

comment on table public.special_leave_grants is
  'FR-65: extra annual-leave days for a first marriage (once) or a close relative''s death (each). Written only by app_grant_special_leave / app_revoke_special_leave.';

-- At most one standing marriage grant per person.
create unique index special_leave_grants_one_marriage
  on public.special_leave_grants (employee_id)
  where kind = 'marriage' and revoked_at is null;
create index special_leave_grants_employee on public.special_leave_grants (employee_id);

alter table public.special_leave_grants enable row level security;

create policy special_leave_grants_select on public.special_leave_grants
  for select to authenticated
  using (private.is_active((select auth.uid()))
         and (employee_id = (select auth.uid())
              or (private.has_permission((select auth.uid()), 'special_leave.grant')
                  and company_id = (select p.company_id from public.profiles p where p.id = (select auth.uid())))));

grant select on public.special_leave_grants to authenticated;

-- Shared guard: caller may grant/revoke for this employee. Returns the company.
create or replace function private.special_leave_target(p_actor uuid, p_employee uuid) returns uuid
    language plpgsql stable security definer
    set search_path to ''
    as $$
declare
  v_company uuid;
  v_target_company uuid;
begin
  if p_actor is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not private.is_active(p_actor) or not private.has_permission(p_actor, 'special_leave.grant') then
    raise exception 'not allowed to grant special leave' using errcode = '42501';
  end if;
  select company_id into v_company from public.profiles where id = p_actor;
  select company_id into v_target_company from public.profiles where id = p_employee;
  if v_target_company is null or v_target_company <> v_company then
    raise exception 'employee not found' using errcode = 'P0002';
  end if;
  if not private.is_admin(p_actor) then
    if p_employee = p_actor then
      raise exception 'you cannot change your own leave balance' using errcode = '42501';
    end if;
    if exists (select 1 from public.user_roles where user_id = p_employee and role = 'admin') then
      raise exception 'not allowed to grant special leave to an admin' using errcode = '42501';
    end if;
  end if;
  return v_company;
end; $$;

create or replace function public.app_grant_special_leave(p_employee_id uuid, p_kind text) returns uuid
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  v_uid     uuid := auth.uid();
  v_company uuid;
  v_type    uuid;
  v_minutes int;
  v_prev    int;
  v_status  text;
  v_id      uuid;
begin
  v_company := private.special_leave_target(v_uid, p_employee_id);
  if p_kind not in ('marriage', 'bereavement') then
    raise exception 'invalid special leave kind' using errcode = '22023';
  end if;

  select id into v_type from public.leave_types
   where company_id = v_company and name_en = 'Annual Leave' and active
   limit 1;
  if v_type is null then
    raise exception 'annual leave type not found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('leave:' || p_employee_id::text, 0));

  if p_kind = 'marriage' then
    if exists (select 1 from public.special_leave_grants
                where employee_id = p_employee_id and kind = 'marriage' and revoked_at is null) then
      raise exception 'marriage leave was already granted' using errcode = '22023';
    end if;
    select marital_status into v_status from public.employee_personal_info where employee_id = p_employee_id;
    if v_status is distinct from 'single' then
      raise exception 'marriage leave needs marital status single' using errcode = '22023';
    end if;
  end if;

  v_minutes := 3 * private.company_minutes_per_day(v_company);
  v_prev := public.current_leave_balance(p_employee_id, v_type);

  insert into public.special_leave_grants (company_id, employee_id, kind, leave_type_id, minutes, prev_marital_status, granted_by)
  values (v_company, p_employee_id, p_kind, v_type, v_minutes, v_status, v_uid)
  returning id into v_id;

  insert into public.leave_ledger (employee_id, leave_type_id, entry_type, delta_minutes, balance_after_minutes, note)
  values (p_employee_id, v_type, 'allocation', v_minutes, v_prev + v_minutes,
          case p_kind when 'marriage' then 'marriage leave (3 days)' else 'bereavement leave (3 days)' end);

  if p_kind = 'marriage' then
    update public.employee_personal_info set marital_status = 'married' where employee_id = p_employee_id;
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (v_uid, 'special_leave.grant', 'special_leave_grants', v_id,
          jsonb_build_object('employee_id', p_employee_id, 'kind', p_kind, 'minutes', v_minutes));
  return v_id;
end; $$;

create or replace function public.app_revoke_special_leave(p_grant_id uuid) returns void
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  v_uid  uuid := auth.uid();
  v_g    public.special_leave_grants;
  v_prev int;
begin
  select * into v_g from public.special_leave_grants where id = p_grant_id;
  if v_g.id is null then
    raise exception 'special leave grant not found' using errcode = 'P0002';
  end if;
  perform private.special_leave_target(v_uid, v_g.employee_id);

  perform pg_advisory_xact_lock(hashtextextended('leave:' || v_g.employee_id::text, 0));

  update public.special_leave_grants
     set revoked_at = now(), revoked_by = v_uid
   where id = p_grant_id and revoked_at is null;
  if not found then
    raise exception 'special leave grant was already revoked' using errcode = '22023';
  end if;

  v_prev := public.current_leave_balance(v_g.employee_id, v_g.leave_type_id);
  insert into public.leave_ledger (employee_id, leave_type_id, entry_type, delta_minutes, balance_after_minutes, note)
  values (v_g.employee_id, v_g.leave_type_id, 'adjustment', -v_g.minutes, v_prev - v_g.minutes,
          case v_g.kind when 'marriage' then 'marriage leave revoked' else 'bereavement leave revoked' end);

  if v_g.kind = 'marriage' then
    update public.employee_personal_info set marital_status = v_g.prev_marital_status
     where employee_id = v_g.employee_id;
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (v_uid, 'special_leave.revoke', 'special_leave_grants', p_grant_id,
          jsonb_build_object('employee_id', v_g.employee_id, 'kind', v_g.kind, 'minutes', v_g.minutes));
end; $$;

revoke all on function private.special_leave_target(uuid, uuid) from public;
revoke all on function public.app_grant_special_leave(uuid, text) from public;
revoke all on function public.app_revoke_special_leave(uuid) from public;
grant execute on function public.app_grant_special_leave(uuid, text) to authenticated;
grant execute on function public.app_revoke_special_leave(uuid) to authenticated;
