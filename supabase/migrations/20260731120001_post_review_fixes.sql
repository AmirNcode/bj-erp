-- =============================================================================
-- Migration: 20260731120001_post_review_fixes.sql
-- Purpose  : Three defects found by the pre-merge review of
--            feat/leave-v2-hourly-accrual-replacement, all reproduced by
--            executing SQL against a copy of the live database.
--
--   1) accrue_leave under-credited SILENTLY when an admin corrected a policy's
--      accrual_start_month BACKWARDS. The hot-path short-circuit returns as soon
--      as the month containing today is posted, so months newly brought into
--      range were never credited and "Post accruals now" could not repair it.
--      Reproduced: moving the start from Mordad to Farvardin 1405 left four
--      months uncredited with no error. It also made the SQL disagree with its
--      own pure mirror, lib/leave/accrual.ts (planAccruals has no such
--      short-circuit), which the header of that file requires to stay in
--      lockstep.
--
--   2) An approved errand could NEVER be cancelled. cancel_leave_request allows
--      cancelling an approved request only while `start_date > today`, which is
--      right for leave — you cannot un-take leave you have started. But BJ-F
--      50207 is a SAME-DAY form by construction, so `start_date = today` is the
--      normal case: the trip is called off, the manager cannot reject an
--      already-approved row, and the dead row keeps blocking that time slot
--      through the overlap check.
--
--   3) leave_requests_kind_shape did not forbid a replacement on an errand.
--      submit_leave_impl already hard-nulls it (D3: an errand names no cover),
--      so this is belt-and-braces — it makes the constraint state what the
--      writer already guarantees.
--
-- Idempotent. PostgreSQL 15. Apply as supabase_admin.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. accrue_leave — the short-circuit must not fire when the policy now starts
--    earlier than the oldest month we have ever posted.
--
--    Body copied from 20260729130006 with ONLY the short-circuit predicate
--    changed; every other branch, error string and the advisory lock are
--    preserved verbatim.
-- ---------------------------------------------------------------------------
create or replace function public.accrue_leave(
  p_employee_id uuid,
  p_leave_type_id uuid
) returns int language plpgsql security definer set search_path = '' as $$
declare
  v_rate      int;
  v_cap       int;
  v_carry     int;
  v_start     date;
  v_hire      date;
  v_today     date := (now() at time zone 'Asia/Tehran')::date;
  v_this_mon  date;
  v_first_post date;
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

revoke execute on function public.accrue_leave(uuid, uuid) from public, anon;
grant  execute on function public.accrue_leave(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. cancel_leave_request — a same-day approved ERRAND stays cancellable.
--
--    Body copied from the installed definition (20260730120001 §5) with only
--    the approved-branch date gate widened for kind='errand'. Errands write no
--    ledger row (NULL leave_type_id -> v_affects NULL), so the reversal block
--    below is skipped for them exactly as before.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_leave_request(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := auth.uid();
  v_owner   uuid;
  v_status  public.leave_status;
  v_start   date;
  v_type    uuid;
  v_kind    public.request_kind;
  v_minutes int;
  v_affects boolean;
  v_prev    int;
  v_rows    int;
  v_today   date := (now() at time zone 'Asia/Tehran')::date;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not private.is_active(v_uid) then raise exception 'account is inactive' using errcode = '42501'; end if;

  select employee_id into v_owner from public.leave_requests where id = p_id;
  if v_owner is null then raise exception 'request not found' using errcode = 'P0002'; end if;

  if not (v_owner = v_uid or private.is_admin(v_uid)) then
    raise exception 'not allowed to cancel this request' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('leave:' || v_owner::text, 0));

  select status, start_date, leave_type_id, requested_minutes, kind
    into v_status, v_start, v_type, v_minutes, v_kind
    from public.leave_requests where id = p_id;

  if v_status = 'pending' then
    update public.leave_requests
       set status = 'cancelled', decided_by = v_uid, decided_at = now()
     where id = p_id and status = 'pending';
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then raise exception 'request was already decided' using errcode = '22023'; end if;

  -- An errand is a same-day form, so `> today` would make an approved one
  -- permanently uncancellable; leave keeps the stricter rule.
  elsif v_status = 'approved'
        and (v_start > v_today or (v_kind = 'errand' and v_start >= v_today)) then
    update public.leave_requests
       set status = 'cancelled', decided_by = v_uid, decided_at = now()
     where id = p_id and status = 'approved';
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then raise exception 'request was already decided' using errcode = '22023'; end if;

    select affects_balance into v_affects from public.leave_types where id = v_type;
    if v_affects then
      v_prev := public.current_leave_balance(v_owner, v_type);
      insert into public.leave_ledger(
        employee_id, leave_type_id, request_id, entry_type,
        delta_minutes, balance_after_minutes, note
      )
      values (
        v_owner, v_type, p_id, 'reversal',
        v_minutes, v_prev + v_minutes, 'reversal on cancel'
      );
    end if;

  else
    raise exception 'only pending or not-yet-started approved requests can be cancelled'
      using errcode = '22023';
  end if;

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (
    v_uid, 'cancel_leave_request', 'leave_requests', p_id,
    jsonb_build_object(
      'status_before', v_status,
      'minutes', v_minutes,
      'kind', v_kind,
      'reversed', (v_status = 'approved' and coalesce(v_affects, false))
    )
  );
end;
$$;

revoke execute on function public.cancel_leave_request(uuid) from public, anon;
grant  execute on function public.cancel_leave_request(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. An errand names no cover — say so in the constraint, not only the writer.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'leave_requests_kind_shape') then
    alter table public.leave_requests drop constraint leave_requests_kind_shape;
  end if;

  alter table public.leave_requests
    add constraint leave_requests_kind_shape check (
      (kind = 'leave'
         and leave_type_id is not null
         and errand_location is null)
      or
      (kind = 'errand'
         and leave_type_id is null
         and replacement_id is null
         and errand_location is not null
         and btrim(errand_location) <> ''
         and length(errand_location) <= 200
         and unit = 'hour')
    );
end $$;
