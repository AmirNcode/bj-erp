-- FR-56 / FR-59 / FR-62 (2026-10-12, spec
-- docs/specs/2026-10-12-client-feedback-approvals-settings-design.md §1, §4, §7, §8).
--
-- Three new permission keys behind the FR-51 seam (FR-55 will turn the seam
-- into a table lookup; its presets must keep these grants):
--   settings.edit  admin, hr        work hours, days off, hourly cap, holidays
--   absences.view  admin, security  the approved-absences board
--   finance.view   admin, finance   completed approvals with per diem
--
-- HR writes work_settings and holidays of its own company. A trigger keeps
-- approval_order_enforced and hours_per_day admin-only, because those belong to
-- the approval chain and the day/minute conversion, not the calendar.
--
-- finance_approved_requests() is the only way finance reads requests: it
-- returns approved rows only, without signatures or reasons.

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
    when 'settings.edit'      then private.is_admin(uid) or private.has_role(uid, 'hr')
    when 'absences.view'      then private.is_admin(uid) or private.has_role(uid, 'security')
    when 'finance.view'       then private.is_admin(uid) or private.has_role(uid, 'finance')
    else false
  end;
$$;

-- ── work_settings / holidays: admin → settings.edit, own company ───────────
drop policy work_settings_insert_admin on public.work_settings;
drop policy work_settings_update_admin on public.work_settings;
drop policy work_settings_delete_admin on public.work_settings;
drop policy holidays_insert_admin on public.holidays;
drop policy holidays_update_admin on public.holidays;
drop policy holidays_delete_admin on public.holidays;

create policy work_settings_insert_editor on public.work_settings for insert to authenticated
  with check (private.has_permission((select auth.uid()), 'settings.edit')
              and company_id = (select p.company_id from public.profiles p where p.id = (select auth.uid())));
create policy work_settings_update_editor on public.work_settings for update to authenticated
  using (private.has_permission((select auth.uid()), 'settings.edit')
         and company_id = (select p.company_id from public.profiles p where p.id = (select auth.uid())))
  with check (private.has_permission((select auth.uid()), 'settings.edit')
              and company_id = (select p.company_id from public.profiles p where p.id = (select auth.uid())));
create policy work_settings_delete_admin on public.work_settings for delete to authenticated
  using (private.is_admin((select auth.uid())));

create policy holidays_insert_editor on public.holidays for insert to authenticated
  with check (private.has_permission((select auth.uid()), 'settings.edit')
              and company_id = (select p.company_id from public.profiles p where p.id = (select auth.uid())));
create policy holidays_update_editor on public.holidays for update to authenticated
  using (private.has_permission((select auth.uid()), 'settings.edit')
         and company_id = (select p.company_id from public.profiles p where p.id = (select auth.uid())))
  with check (private.has_permission((select auth.uid()), 'settings.edit')
              and company_id = (select p.company_id from public.profiles p where p.id = (select auth.uid())));
create policy holidays_delete_editor on public.holidays for delete to authenticated
  using (private.has_permission((select auth.uid()), 'settings.edit')
         and company_id = (select p.company_id from public.profiles p where p.id = (select auth.uid())));

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
    if new.approval_order_enforced is distinct from false
       or new.hours_per_day is distinct from 8 then
      raise exception 'only an admin may change approval order or hours per day' using errcode = '42501';
    end if;
  elsif new.approval_order_enforced is distinct from old.approval_order_enforced
        or new.hours_per_day is distinct from old.hours_per_day then
    raise exception 'only an admin may change approval order or hours per day' using errcode = '42501';
  end if;
  return new;
end; $$;

create trigger work_settings_enforce_scope
  before insert or update on public.work_settings
  for each row execute function private.enforce_work_settings_scope();

-- ── finance: completed approvals ────────────────────────────────────────────
create or replace function public.finance_approved_requests(p_from date, p_to date)
returns table(
  id uuid,
  serial_year int,
  serial_seq int,
  kind public.request_kind,
  employee_name text,
  personnel_no text,
  department_name_fa text,
  department_name_en text,
  leave_type_name_fa text,
  leave_type_name_en text,
  is_paid boolean,
  start_date date,
  end_date date,
  unit public.leave_unit,
  start_time time,
  end_time time,
  requested_minutes int,
  unpaid_minutes int,
  errand_location text,
  per_diem_rials bigint,
  decided_at timestamptz
)
    language plpgsql stable security definer
    set search_path to ''
    as $$
declare
  v_uid uuid := auth.uid();
  v_company uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not private.is_active(v_uid) or not private.has_permission(v_uid, 'finance.view') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'invalid date range' using errcode = '22023';
  end if;
  if p_to - p_from > 400 then
    raise exception 'date range too long' using errcode = '22023';
  end if;
  select company_id into v_company from public.profiles where profiles.id = v_uid;

  return query
    select r.id, r.serial_year, r.serial_seq, r.kind,
           p.full_name, p.personnel_no,
           d.name_fa, d.name_en,
           t.name_fa, t.name_en, t.is_paid,
           r.start_date, r.end_date, r.unit, r.start_time, r.end_time,
           r.requested_minutes, r.unpaid_minutes,
           r.errand_location, r.per_diem_rials, r.decided_at
      from public.leave_requests r
      join public.profiles p on p.id = r.employee_id
      left join public.departments d on d.id = p.department_id
      left join public.leave_types t on t.id = r.leave_type_id
     where r.company_id = v_company
       and r.status = 'approved'
       and r.start_date <= p_to
       and r.end_date >= p_from
     order by r.start_date, r.serial_year, r.serial_seq;
end; $$;

revoke all on function public.finance_approved_requests(date, date) from public;
grant execute on function public.finance_approved_requests(date, date) to authenticated;
