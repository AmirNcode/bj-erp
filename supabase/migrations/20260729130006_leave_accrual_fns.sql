-- =============================================================================
-- Migration: 20260729130006_leave_accrual_fns.sql
-- Purpose  : Lazy, idempotent monthly accrual (spec §6.2–6.4).
--
-- MIRRORS lib/leave/accrual.ts — same order of operations, same rounding. Keep
-- them in lockstep; the TS side is where the rules are unit-tested (15 tests).
--
-- Not scheduled, by design (D3): the client's VM is LAN-only and can be powered
-- off, so pg_cron would need catch-up logic anyway — i.e. this design plus a
-- dependency. Missing months are posted whenever a balance is read, and the
-- partial unique index from …130005 makes double-crediting impossible.
--
-- Idempotent. Postgres 15. Apply as supabase_admin.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. accrue_leave — post every month this employee has earned for one leave
--    type; return the resulting balance in minutes.
--
--    INTERNAL: it takes an arbitrary employee id, so it is revoked from
--    authenticated and reachable only through the guarded wrappers below.
-- ---------------------------------------------------------------------------
create or replace function public.accrue_leave(p_employee_id uuid, p_leave_type_id uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_rate      int;
  v_cap       int;
  v_carry     int;
  v_start     date;
  v_hire      date;
  v_today     date := (now() at time zone 'Asia/Tehran')::date;
  v_this_mon  date;
  v_balance   int;
  v_m         record;
  v_amount    int;
  v_already   int;
  v_excess    int;
  v_earlier   boolean;
  v_rows      int;
begin
  select accrual_minutes_per_month, annual_cap_minutes, carryover_cap_minutes, accrual_start_month
    into v_rate, v_cap, v_carry, v_start
    from public.employee_leave_policies
   where employee_id = p_employee_id and leave_type_id = p_leave_type_id;

  -- No policy, or a non-accruing type (sick leave): nothing to do.
  if v_rate is null or v_rate <= 0 then
    return public.current_leave_balance(p_employee_id, p_leave_type_id);
  end if;

  -- Hot-path short-circuit: this runs on every balance read, so if the month
  -- containing today is already posted there is nothing to do and we skip both
  -- the lock and the loop. Steady-state cost is one indexed EXISTS.
  select gregorian_start into v_this_mon
    from public.jalali_months
   where v_today between gregorian_start and gregorian_end;

  if v_this_mon is not null and exists (
    select 1 from public.leave_ledger
     where employee_id = p_employee_id and leave_type_id = p_leave_type_id
       and entry_type = 'allocation' and period_month = v_this_mon
  ) then
    return public.current_leave_balance(p_employee_id, p_leave_type_id);
  end if;

  -- Serialize with every other leave write for this employee (2026-07-02 hardening).
  perform pg_advisory_xact_lock(hashtextextended('leave:' || p_employee_id::text, 0));

  select hire_date into v_hire from public.profiles where id = p_employee_id;
  v_balance := public.current_leave_balance(p_employee_id, p_leave_type_id);

  for v_m in
    select jm.jalali_year, jm.jalali_month, jm.gregorian_start, jm.gregorian_end
      from public.jalali_months jm
     where jm.gregorian_start >= v_start
       and jm.gregorian_start <= v_today
     order by jm.gregorian_start
  loop
    -- Nobody accrues for a month that ended before they were hired.
    if v_hire is not null and v_m.gregorian_end < v_hire then
      continue;
    end if;

    -- Year boundary: clamp the carried balance BEFORE crediting this month.
    if v_m.jalali_month = 1 then
      select exists (
        select 1 from public.leave_ledger
         where employee_id = p_employee_id and leave_type_id = p_leave_type_id
           and entry_type = 'allocation' and period_month is not null
           and period_month < v_m.gregorian_start
      ) into v_earlier;

      if v_earlier and v_balance > v_carry then
        v_excess := v_balance - v_carry;
        insert into public.leave_ledger(employee_id, leave_type_id, entry_type,
                                        delta_minutes, balance_after_minutes, period_month, note)
        values (p_employee_id, p_leave_type_id, 'carryover_forfeit',
                -v_excess, v_carry, v_m.gregorian_start, 'carryover above cap forfeited')
        on conflict do nothing;
        -- Only move the running balance if the row was actually written; a
        -- concurrent caller may have posted it first.
        get diagnostics v_rows = row_count;
        if v_rows = 1 then
          v_balance := v_carry;
        end if;
      end if;
    end if;

    v_amount := v_rate;

    -- Pro-rate the hire month by calendar days remaining in it.
    if v_hire is not null and v_hire between v_m.gregorian_start and v_m.gregorian_end then
      v_amount := round(v_rate::numeric
                        * ((v_m.gregorian_end - v_hire) + 1)
                        / ((v_m.gregorian_end - v_m.gregorian_start) + 1));
    end if;

    -- The annual cap counts ACCRUALS within this Jalali year, not the balance.
    -- Opening allocations have a null period_month and so never consume it.
    if v_cap is not null then
      select coalesce(sum(l.delta_minutes), 0) into v_already
        from public.leave_ledger l
        join public.jalali_months jm on jm.gregorian_start = l.period_month
       where l.employee_id = p_employee_id and l.leave_type_id = p_leave_type_id
         and l.entry_type = 'allocation'
         and jm.jalali_year = v_m.jalali_year;
      v_amount := least(v_amount, greatest(v_cap - v_already, 0));
    end if;

    if v_amount > 0 then
      insert into public.leave_ledger(employee_id, leave_type_id, entry_type,
                                      delta_minutes, balance_after_minutes, period_month, note)
      values (p_employee_id, p_leave_type_id, 'allocation',
              v_amount, v_balance + v_amount, v_m.gregorian_start, 'monthly accrual')
      on conflict do nothing;
      get diagnostics v_rows = row_count;
      if v_rows = 1 then
        v_balance := v_balance + v_amount;
      end if;
    end if;
  end loop;

  return v_balance;
end; $$;

-- ---------------------------------------------------------------------------
-- 2. accrue_my_leave — self only. Takes no employee argument, so it cannot be
--    pointed at anyone else.
-- ---------------------------------------------------------------------------
create or replace function public.accrue_my_leave()
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_type uuid;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;

  for v_type in
    select leave_type_id from public.employee_leave_policies where employee_id = v_uid
  loop
    perform public.accrue_leave(v_uid, v_type);
  end loop;
end; $$;

-- ---------------------------------------------------------------------------
-- 3. accrue_employee_leave — manager-of or admin.
-- ---------------------------------------------------------------------------
create or replace function public.accrue_employee_leave(p_employee_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_type uuid;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not (private.is_manager_of(v_uid, p_employee_id) or private.is_admin(v_uid)) then
    raise exception 'not allowed to accrue for this employee' using errcode = '42501';
  end if;

  for v_type in
    select leave_type_id from public.employee_leave_policies where employee_id = p_employee_id
  loop
    perform public.accrue_leave(p_employee_id, v_type);
  end loop;
end; $$;

-- ---------------------------------------------------------------------------
-- 4. accrue_all_leave — admin "Post accruals now". Returns a summary the UI
--    shows, so the admin sees what happened instead of trusting invisible work.
-- ---------------------------------------------------------------------------
create or replace function public.accrue_all_leave()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_p            record;
  v_employees    int := 0;
  v_rows_before  int;
  v_rows_after   int;
  v_last_emp     uuid;
begin
  if not private.is_admin(auth.uid()) then
    raise exception 'only admins can post accruals' using errcode = '42501';
  end if;

  select count(*) into v_rows_before from public.leave_ledger where period_month is not null;

  for v_p in
    select p.employee_id, p.leave_type_id
      from public.employee_leave_policies p
      join public.profiles pr on pr.id = p.employee_id
     where pr.active
       and p.accrual_minutes_per_month > 0
     order by p.employee_id
  loop
    perform public.accrue_leave(v_p.employee_id, v_p.leave_type_id);
    if v_last_emp is null or v_last_emp <> v_p.employee_id then
      v_employees := v_employees + 1;
      v_last_emp := v_p.employee_id;
    end if;
  end loop;

  select count(*) into v_rows_after from public.leave_ledger where period_month is not null;

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (auth.uid(), 'accrue_all_leave', 'leave_ledger', null,
          jsonb_build_object('employees', v_employees, 'rows_posted', v_rows_after - v_rows_before));

  return jsonb_build_object('employees', v_employees, 'rows_posted', v_rows_after - v_rows_before);
end; $$;

-- ---------------------------------------------------------------------------
-- 5. set_employee_leave_policy — admin upsert. Validates the start month
--    against jalali_months: an arbitrary date would silently never match a
--    month row and the employee would accrue nothing, forever.
-- ---------------------------------------------------------------------------
create or replace function public.set_employee_leave_policy(
  p_employee_id             uuid,
  p_leave_type_id           uuid,
  p_accrual_minutes_per_month int,
  p_annual_cap_minutes      int,
  p_carryover_cap_minutes   int,
  p_accrual_start_month     date
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not private.is_admin(auth.uid()) then
    raise exception 'only admins can set a leave policy' using errcode = '42501';
  end if;
  if p_accrual_minutes_per_month is null or p_accrual_minutes_per_month < 0 then
    raise exception 'accrual per month must be 0 or more' using errcode = '22023';
  end if;
  if p_carryover_cap_minutes is null or p_carryover_cap_minutes < 0 then
    raise exception 'carryover cap must be 0 or more' using errcode = '22023';
  end if;
  if p_annual_cap_minutes is not null and p_annual_cap_minutes < 0 then
    raise exception 'annual cap must be 0 or more' using errcode = '22023';
  end if;
  if not exists (select 1 from public.jalali_months where gregorian_start = p_accrual_start_month) then
    raise exception 'accrual start month must be a jalali month start' using errcode = '22023';
  end if;

  insert into public.employee_leave_policies as elp (
    employee_id, leave_type_id, accrual_minutes_per_month,
    annual_cap_minutes, carryover_cap_minutes, accrual_start_month, created_by
  ) values (
    p_employee_id, p_leave_type_id, p_accrual_minutes_per_month,
    p_annual_cap_minutes, p_carryover_cap_minutes, p_accrual_start_month, auth.uid()
  )
  on conflict (employee_id, leave_type_id) do update
     set accrual_minutes_per_month = excluded.accrual_minutes_per_month,
         annual_cap_minutes        = excluded.annual_cap_minutes,
         carryover_cap_minutes     = excluded.carryover_cap_minutes,
         accrual_start_month       = excluded.accrual_start_month
  returning elp.id into v_id;

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (auth.uid(), 'set_employee_leave_policy', 'employee_leave_policies', v_id,
          jsonb_build_object('employee_id', p_employee_id, 'leave_type_id', p_leave_type_id,
                             'accrual_minutes_per_month', p_accrual_minutes_per_month,
                             'annual_cap_minutes', p_annual_cap_minutes,
                             'carryover_cap_minutes', p_carryover_cap_minutes,
                             'accrual_start_month', p_accrual_start_month));
  return v_id;
end; $$;

-- ---------------------------------------------------------------------------
-- 6. Grants. accrue_leave stays internal (arbitrary employee id); the wrappers
--    and the setter are self- or role-guarded. anon always revoked.
-- ---------------------------------------------------------------------------
revoke execute on function public.accrue_leave(uuid, uuid) from public, anon, authenticated;

revoke execute on function public.accrue_my_leave() from public, anon;
grant  execute on function public.accrue_my_leave() to authenticated;
revoke execute on function public.accrue_employee_leave(uuid) from public, anon;
grant  execute on function public.accrue_employee_leave(uuid) to authenticated;
revoke execute on function public.accrue_all_leave() from public, anon;
grant  execute on function public.accrue_all_leave() to authenticated;
revoke execute on function public.set_employee_leave_policy(uuid, uuid, int, int, int, date) from public, anon;
grant  execute on function public.set_employee_leave_policy(uuid, uuid, int, int, int, date) to authenticated;
