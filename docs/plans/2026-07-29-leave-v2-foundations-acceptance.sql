-- Acceptance checks for the days -> minutes conversion (spec §10.3).
--
-- WHEN: run on a COPY of the client's live database, AFTER 20260729130002
-- (expand) and BEFORE 20260729130003 (contract) drops the day columns. Sections
-- 1 and 2 compare the two unit systems, so they only work while both exist.
-- Section 3 can run at any point after 20260729130001.
--
-- HOW (matches deploy/install.sh — the image requires password auth):
--   docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" <db-container> \
--     psql -U supabase_admin -d postgres -f - < this-file.sql
--
-- 480 is the frozen historical constant (8h × 60), NOT work_settings.hours_per_day:
-- past rows were written when a day meant 8 hours.

-- ── 1. Every converted row is exact. All four counts MUST be 0. ─────────────
select
  (select count(*) from public.leave_ledger      where balance_after_minutes <> round(balance_after * 480)) as bad_balances,
  (select count(*) from public.leave_ledger      where delta_minutes         <> round(delta_days * 480))     as bad_deltas,
  (select count(*) from public.leave_requests    where requested_minutes     <> round(requested_days * 480)) as bad_requests,
  (select count(*) from public.leave_allocations where allocated_minutes     <> round(allocated_days * 480)) as bad_allocations;

-- ── 2. Every employee's CURRENT balance is unchanged in real terms. ─────────
-- This is the one that matters to a worker: their visible balance must not move.
-- Expect (0 rows).
with latest as (
  select distinct on (employee_id, leave_type_id)
         employee_id, leave_type_id, balance_after, balance_after_minutes
    from public.leave_ledger
   order by employee_id, leave_type_id, created_at desc, id desc
)
select p.employee_code, l.balance_after as old_days, l.balance_after_minutes as new_minutes
  from latest l
  join public.profiles p on p.id = l.employee_id
 where l.balance_after_minutes <> round(l.balance_after * 480);

-- ── 3. Calendar table sanity: 612 contiguous months, no gaps. ──────────────
select count(*) as month_rows from public.jalali_months;              -- expect 612

select count(*) as gaps from (
  select gregorian_end, lead(gregorian_start) over (order by gregorian_start) nxt
    from public.jalali_months
) t where nxt is not null and nxt <> gregorian_end + 1;                -- expect 0

-- ── 4. AFTER the contract migration: no day column may survive. ────────────
-- Expect (0 rows).
select table_name, column_name
  from information_schema.columns
 where table_schema = 'public'
   and column_name in ('delta_days', 'balance_after', 'requested_days', 'allocated_days');
