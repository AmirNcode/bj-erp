-- FR-92: convert a negative annual balance to unpaid leave; Employees totals, negatives list,
-- pending counts and payroll rows. Writes only leave_ledger, leave_unpaid_conversions and audit_log.
-- The public entry points take private.approval_lock(company) first, then the per-employee
-- 'leave:' advisory locks (CLAUDE.md lock order).

create table public.leave_unpaid_conversions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  employee_id uuid not null references public.profiles(id) on delete cascade,
  leave_type_id uuid not null references public.leave_types(id),
  minutes integer not null check (minutes > 0),
  ledger_id uuid not null references public.leave_ledger(id),
  note text check (char_length(note) <= 500),
  converted_by uuid references public.profiles(id) on delete set null,
  converted_at timestamptz not null default clock_timestamp()
);
create index leave_unpaid_conversions_company_converted_idx
  on public.leave_unpaid_conversions (company_id, converted_at);
alter table public.leave_unpaid_conversions enable row level security;
revoke all on public.leave_unpaid_conversions from anon, public;
grant select on public.leave_unpaid_conversions to authenticated;
create policy leave_unpaid_conversions_select on public.leave_unpaid_conversions
  for select to authenticated using (
    company_id = (select private.caller_company())
    and (employee_id = (select auth.uid())
         or private.is_admin((select auth.uid()))
         or private.has_perm((select auth.uid()), 'leave_balances', 'read')
         or private.has_perm((select auth.uid()), 'reports', 'read')));

-- The active overdraft-capable ("annual") type of a company.
create function private.annual_type(p_company uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.leave_types
   where company_id = p_company and active and manager_overdraft
   order by name_en limit 1;
$$;
revoke all on function private.annual_type(uuid) from public, anon, authenticated;

-- First day (Gregorian) of the Jalali year containing p_day.
create function private.jalali_year_start(p_day date) returns date
language sql stable security definer set search_path = '' as $$
  select min(gregorian_start) from public.jalali_months
   where jalali_year = (select jalali_year from public.jalali_months
                         where p_day between gregorian_start and gregorian_end limit 1);
$$;
revoke all on function private.jalali_year_start(date) from public, anon, authenticated;

create function private.convert_negative_impl(p_actor uuid, p_employee uuid, p_minutes integer, p_note text)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_type uuid;
  v_balance integer;
  v_amount integer;
  v_ledger uuid;
  v_conv uuid;
begin
  select company_id into v_company from public.profiles where id = p_employee;
  if v_company is distinct from (select company_id from public.profiles where id = p_actor) then
    raise exception 'not allowed to change this employee''s leave' using errcode = '42501';
  end if;
  v_type := private.annual_type(v_company);
  if v_type is null then return 0; end if;
  perform pg_advisory_xact_lock(hashtextextended('leave:' || p_employee::text, 0));
  select balance_after_minutes into v_balance from public.leave_ledger
   where employee_id = p_employee and leave_type_id = v_type order by seq desc limit 1;
  if v_balance is null or v_balance >= 0 then return 0; end if;
  v_amount := coalesce(p_minutes, -v_balance);
  if v_amount <= 0 then raise exception 'amount must be more than 0' using errcode = '22023'; end if;
  if v_amount > -v_balance then
    raise exception 'amount exceeds the negative balance' using errcode = '22023';
  end if;
  insert into public.leave_ledger(employee_id, leave_type_id, entry_type, delta_minutes,
                                  balance_after_minutes, note, created_by)
  values (p_employee, v_type, 'adjustment', v_amount, v_balance + v_amount,
          coalesce(p_note, 'converted to unpaid'), p_actor)
  returning id into v_ledger;
  insert into public.leave_unpaid_conversions(company_id, employee_id, leave_type_id, minutes,
                                              ledger_id, note, converted_by)
  values (v_company, p_employee, v_type, v_amount, v_ledger, p_note, p_actor)
  returning id into v_conv;
  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (p_actor, 'leave_balance.convert_unpaid', 'leave_unpaid_conversions', v_conv,
          jsonb_build_object('employee_id', p_employee, 'leave_type_id', v_type,
                             'previous_minutes', v_balance, 'converted_minutes', v_amount));
  return v_amount;
end $$;
revoke all on function private.convert_negative_impl(uuid, uuid, integer, text) from public, anon, authenticated;

create function public.app_convert_negatives(p_employee_ids uuid[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_count integer := 0;
begin
  if not (private.is_admin(v_uid) or private.has_perm(v_uid, 'leave_balances', 'edit')) then
    raise exception 'only admins or hr can set leave balance' using errcode = '42501';
  end if;
  perform private.approval_lock((select company_id from public.profiles where id = v_uid));
  for v_id in select distinct x from unnest(coalesce(p_employee_ids, '{}')) as u(x) where x is not null order by x loop
    if v_id = v_uid and not private.is_admin(v_uid) then continue; end if;
    if not (private.is_admin(v_uid) or private.can_manage_leave_of(v_uid, v_id)) then
      raise exception 'not allowed to change this employee''s leave' using errcode = '42501';
    end if;
    if private.convert_negative_impl(v_uid, v_id, null, null) > 0 then v_count := v_count + 1; end if;
  end loop;
  return v_count;
end $$;

create function public.app_convert_negative(p_employee_id uuid, p_minutes integer, p_note text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_done integer;
begin
  if not (private.is_admin(v_uid) or private.has_perm(v_uid, 'leave_balances', 'edit')) then
    raise exception 'only admins or hr can set leave balance' using errcode = '42501';
  end if;
  perform private.approval_lock((select company_id from public.profiles where id = v_uid));
  if not private.is_admin(v_uid) and p_employee_id = v_uid then
    raise exception 'you cannot change your own leave balance' using errcode = '42501';
  end if;
  if not private.is_admin(v_uid) and not private.can_manage_leave_of(v_uid, p_employee_id) then
    raise exception 'not allowed to change this employee''s leave' using errcode = '42501';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'reason is too long' using errcode = '22023';
  end if;
  if p_minutes is not null and p_minutes <= 0 then
    raise exception 'amount must be more than 0' using errcode = '22023';
  end if;
  v_done := private.convert_negative_impl(v_uid, p_employee_id, p_minutes, v_note);
  if v_done = 0 then raise exception 'balance is not negative' using errcode = '22023'; end if;
  return v_done;
end $$;

create function public.app_negative_balances()
returns table(employee_id uuid, full_name text, personnel_no text, department_name_fa text,
              department_name_en text, balance_minutes integer)
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_company uuid;
begin
  if not (private.is_admin(v_uid) or private.has_perm(v_uid, 'leave_balances', 'edit')) then
    raise exception 'only admins or hr can set leave balance' using errcode = '42501';
  end if;
  select company_id into v_company from public.profiles where id = v_uid;
  return query
    select p.id, p.full_name, p.personnel_no, d.name_fa, d.name_en, b.bal
      from public.profiles p
      left join public.departments d on d.id = p.department_id
      cross join lateral (
        select l.balance_after_minutes as bal from public.leave_ledger l
         where l.employee_id = p.id and l.leave_type_id = private.annual_type(v_company)
         order by l.seq desc limit 1) b
     where p.company_id = v_company and p.active and b.bal < 0
       and not private.is_admin(p.id)
       and (private.is_admin(v_uid)
            or (p.id <> v_uid and private.can_manage_leave_of(v_uid, p.id)))
     order by p.full_name;
end $$;

create function public.app_employee_leave_totals(p_ids uuid[])
returns table(employee_id uuid, balance_minutes integer, used_minutes integer, unpaid_minutes integer)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_company uuid;
  v_type uuid;
  v_today date := (now() at time zone 'Asia/Tehran')::date;
  v_ys date;
begin
  if not (private.is_admin(v_uid) or private.has_perm(v_uid, 'people', 'read')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select company_id into v_company from public.profiles where id = v_uid;
  v_type := private.annual_type(v_company);
  v_ys := private.jalali_year_start(v_today);
  return query
    select p.id,
      (select l.balance_after_minutes from public.leave_ledger l
        where l.employee_id = p.id and l.leave_type_id = v_type order by l.seq desc limit 1),
      coalesce((select sum(r.requested_minutes - r.unpaid_minutes) from public.leave_requests r
                 where r.employee_id = p.id and r.status = 'approved' and r.kind = 'leave'
                   and r.leave_type_id = v_type and r.start_date between v_ys and v_today), 0)::integer,
      (coalesce((select sum(case when lt.affects_balance then r.unpaid_minutes
                                 when not lt.is_paid then r.requested_minutes else 0 end)
                   from public.leave_requests r
                   join public.leave_types lt on lt.id = r.leave_type_id
                  where r.employee_id = p.id and r.status = 'approved' and r.kind = 'leave'
                    and r.start_date between v_ys and v_today), 0)
       + coalesce((select sum(c.minutes) from public.leave_unpaid_conversions c
                    where c.employee_id = p.id
                      and (c.converted_at at time zone 'Asia/Tehran')::date between v_ys and v_today), 0))::integer
      from public.profiles p
     where p.id = any(coalesce(p_ids, '{}')) and p.company_id = v_company;
end $$;

create function public.app_pending_leave_counts(p_employee_id uuid)
returns table(leave_type_id uuid, pending_count integer, pending_minutes integer)
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if not (private.is_admin(v_uid) or private.has_perm(v_uid, 'leave_balances', 'read')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select r.leave_type_id, count(*)::integer, coalesce(sum(r.requested_minutes), 0)::integer
      from public.leave_requests r
      join public.profiles me on me.id = v_uid and me.company_id = r.company_id
     where r.employee_id = p_employee_id and r.status = 'pending' and r.kind = 'leave'
     group by r.leave_type_id;
end $$;

create function public.app_payroll_unpaid(p_from date, p_to date)
returns table(employee_id uuid, full_name text, personnel_no text, department_name_fa text,
              department_name_en text, source text, serial_year integer, serial_seq integer,
              on_date date, leave_type_name_fa text, leave_type_name_en text,
              unpaid_minutes integer, balance_minutes integer)
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_company uuid;
begin
  if not (private.is_admin(v_uid) or private.has_perm(v_uid, 'reports', 'read')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select company_id into v_company from public.profiles where id = v_uid;
  return query
    select u.employee_id, p.full_name, p.personnel_no, d.name_fa, d.name_en, u.source, u.serial_year, u.serial_seq,
           u.on_date, u.tn_fa, u.tn_en, u.minutes,
           (select l.balance_after_minutes from public.leave_ledger l
             where l.employee_id = u.employee_id and l.leave_type_id = private.annual_type(v_company)
             order by l.seq desc limit 1)
      from (
        select r.employee_id, case when lt.affects_balance then 'unpaid_part' else 'unpaid_type' end as source,
               r.serial_year, r.serial_seq,
               r.start_date as on_date, lt.name_fa as tn_fa, lt.name_en as tn_en,
               case when lt.affects_balance then r.unpaid_minutes
                    when not lt.is_paid then r.requested_minutes else 0 end as minutes
          from public.leave_requests r
          join public.leave_types lt on lt.id = r.leave_type_id
         where r.company_id = v_company and r.status = 'approved' and r.kind = 'leave'
           and r.start_date between p_from and p_to
           and ((not lt.affects_balance and not lt.is_paid)
                or (lt.affects_balance and r.unpaid_minutes > 0))
        union all
        select c.employee_id, 'conversion', null::integer, null::integer,
               (c.converted_at at time zone 'Asia/Tehran')::date, lt.name_fa, lt.name_en, c.minutes
          from public.leave_unpaid_conversions c
          join public.leave_types lt on lt.id = c.leave_type_id
         where c.company_id = v_company
           and (c.converted_at at time zone 'Asia/Tehran')::date between p_from and p_to
      ) u
      join public.profiles p on p.id = u.employee_id
      left join public.departments d on d.id = p.department_id
     order by p.full_name, u.on_date;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.app_convert_negatives(uuid[])', 'public.app_convert_negative(uuid,integer,text)',
    'public.app_negative_balances()', 'public.app_employee_leave_totals(uuid[])',
    'public.app_pending_leave_counts(uuid)', 'public.app_payroll_unpaid(date,date)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
