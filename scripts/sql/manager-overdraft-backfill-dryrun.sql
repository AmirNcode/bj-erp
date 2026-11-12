-- FR-92 backfill dry run. READ-ONLY: a single select, changes nothing.
-- Lists the past leave requests whose unpaid part the backfill migration
-- (20261112120200_manager_overdraft_backfill.sql) would move onto the ledger:
-- kind 'leave', unpaid_minutes > 0, status approved/pending, type manager_overdraft,
-- employee currently a Manager. Approved rows post a consumption entry; pending rows
-- only get unpaid_minutes reset to 0. Run it against a restored live backup, after
-- the manager_overdraft migrations are applied:
--   psqlc -d <db> < scripts/sql/manager-overdraft-backfill-dryrun.sql
-- The output contains personnel data: do not commit it or paste it anywhere public.
with rows as (
  select r.id, r.employee_id, r.leave_type_id, r.status, r.start_date, r.unpaid_minutes,
         r.serial_year, r.serial_seq, r.created_at, p.personnel_no,
         (select l.balance_after_minutes from public.leave_ledger l
           where l.employee_id = r.employee_id and l.leave_type_id = r.leave_type_id
           order by l.seq desc limit 1) as current_balance
    from public.leave_requests r
    join public.leave_types lt on lt.id = r.leave_type_id and lt.manager_overdraft
    join public.profiles p on p.id = r.employee_id
   where r.kind = 'leave' and r.unpaid_minutes > 0 and r.status in ('approved', 'pending')
     and private.has_role(r.employee_id, 'manager')
), calc as (
  select rows.*,
         coalesce(rows.current_balance, 0) - sum(case when status = 'approved' then unpaid_minutes else 0 end)
           over (partition by employee_id, leave_type_id order by created_at, id) as balance_after
    from rows
)
select employee_id, personnel_no, serial_year || '-' || serial_seq as serial, status, start_date,
       unpaid_minutes, coalesce(current_balance, 0) as current_balance, balance_after
  from calc
union all
select null, 'TOTAL (' || count(*) || ' requests)', null, null, null,
       coalesce(sum(unpaid_minutes), 0)::integer, null, null
  from calc
order by 1 nulls last, 4, 5;
