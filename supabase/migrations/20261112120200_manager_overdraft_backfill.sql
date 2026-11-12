-- FR-92: past Manager requests that were split into a paid and an unpaid part now follow the
-- overdraft rule: the whole amount comes off the balance. Move each such request's unpaid part onto
-- the ledger (approved) or drop it (pending: approval recomputes).
-- The logic lives in private.manager_overdraft_backfill() (returns the number of requests changed)
-- so tests/sql/manager-overdraft-backfill.sql can call it; the migration runs it once.
-- Lock order: approval_lock(company) first, then each employee's 'leave:' advisory lock.
create function private.manager_overdraft_backfill() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_emp uuid;
  r record;
  v_bal integer;
  v_n integer := 0;
begin
  for v_company in
    select distinct r2.company_id from public.leave_requests r2
      join public.leave_types lt on lt.id = r2.leave_type_id and lt.manager_overdraft
     where r2.kind = 'leave' and r2.unpaid_minutes > 0 and r2.status in ('approved', 'pending')
       and private.has_role(r2.employee_id, 'manager')
     order by 1
  loop
    perform private.approval_lock(v_company);
    for v_emp in
      select distinct r2.employee_id from public.leave_requests r2
        join public.leave_types lt on lt.id = r2.leave_type_id and lt.manager_overdraft
       where r2.company_id = v_company and r2.kind = 'leave' and r2.unpaid_minutes > 0
         and r2.status in ('approved', 'pending') and private.has_role(r2.employee_id, 'manager')
       order by 1
    loop
      perform pg_advisory_xact_lock(hashtextextended('leave:' || v_emp::text, 0));
      for r in
        select r2.id, r2.leave_type_id, r2.status, r2.unpaid_minutes
          from public.leave_requests r2
          join public.leave_types lt on lt.id = r2.leave_type_id and lt.manager_overdraft
         where r2.employee_id = v_emp and r2.kind = 'leave' and r2.unpaid_minutes > 0
           and r2.status in ('approved', 'pending')
         order by r2.created_at, r2.id
      loop
        if r.status = 'approved' then
          select l.balance_after_minutes into v_bal from public.leave_ledger l
           where l.employee_id = v_emp and l.leave_type_id = r.leave_type_id
           order by l.seq desc limit 1;
          insert into public.leave_ledger(employee_id, leave_type_id, request_id, entry_type,
                                          delta_minutes, balance_after_minutes, note)
          values (v_emp, r.leave_type_id, r.id, 'consumption', -r.unpaid_minutes,
                  coalesce(v_bal, 0) - r.unpaid_minutes, 'manager overdraft backfill (FR-92)');
        end if;
        update public.leave_requests set unpaid_minutes = 0 where id = r.id;
        insert into public.audit_log(actor_id, action, entity, entity_id, after)
        values (null, 'leave_request.overdraft_backfill', 'leave_requests', r.id,
                jsonb_build_object('employee_id', v_emp, 'request_id', r.id,
                                   'moved_minutes', r.unpaid_minutes));
        v_n := v_n + 1;
      end loop;
    end loop;
  end loop;
  return v_n;
end $$;
revoke all on function private.manager_overdraft_backfill() from public, anon, authenticated;

select private.manager_overdraft_backfill();
