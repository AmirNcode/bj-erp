-- FR-60 (2026-10-12, spec docs/specs/2026-10-12-client-feedback-approvals-settings-design.md §5):
-- the remaining leave balance carries over to the next Jalali year in full.
--
-- accrue_leave used to post a `carryover_forfeit` row at Farvardin 1 for any
-- balance above the policy's carryover_cap_minutes. That step is removed; the
-- function is otherwise unchanged. carryover_cap_minutes (policy) and
-- default_carryover_cap_minutes (leave type) stay for schema compatibility but
-- are no longer read. Existing forfeit rows are history and are left alone.

CREATE OR REPLACE FUNCTION public.accrue_leave(p_employee_id uuid, p_leave_type_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_rate      int;
  v_cap       int;
  v_start     date;
  v_hire      date;
  v_today     date := (now() at time zone 'Asia/Tehran')::date;
  v_this_mon  date;
  v_first_post date;
  v_balance   int;
  v_m         record;
  v_amount    int;
  v_already   int;
  v_rows      int;
begin
  select accrual_minutes_per_month, annual_cap_minutes, accrual_start_month
    into v_rate, v_cap, v_start
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

  -- The oldest month actually posted. If the policy's start is now EARLIER
  -- than this, an admin has backdated accrual_start_month and the months in
  -- between were never credited, so the short-circuit below must not fire.
  select min(period_month) into v_first_post
    from public.leave_ledger
   where employee_id = p_employee_id and leave_type_id = p_leave_type_id
     and entry_type = 'allocation' and period_month is not null;

  if v_this_mon is not null
     and (v_first_post is null or v_first_post <= v_start)
     and exists (
       select 1 from public.leave_ledger
        where employee_id = p_employee_id and leave_type_id = p_leave_type_id
          and entry_type = 'allocation' and period_month = v_this_mon
     )
  then
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
comment on column public.employee_leave_policies.carryover_cap_minutes is
  'Unused since FR-60 (2026-10-12): the whole balance carries over. Kept for schema compatibility.';
comment on column public.leave_types.default_carryover_cap_minutes is
  'Unused since FR-60 (2026-10-12): the whole balance carries over. Kept for schema compatibility.';
