-- =============================================================================
-- Migration: 20260729130007_leave_ledger_seq.sql
-- Purpose  : Make "the latest ledger row" deterministic.
--
-- THE BUG (found while verifying accrual against its TS planner):
--   balance = latest balance_after_minutes ordered by (created_at desc, id desc).
--   Accrual posts several months in ONE transaction, and now() is frozen for a
--   transaction, so every row it writes shares a created_at. The tie-break then
--   falls to a random uuid, and the balance read comes back as whichever month
--   happened to have the highest id — 960 instead of 1440 in the case that
--   caught this.
--
--   It never surfaced before because every ledger row used to come from its own
--   transaction, so created_at was naturally distinct.
--
-- THE FIX: a monotonic `seq`. Ordering by it is deterministic regardless of how
-- many rows a single transaction writes. Every reader (SQL and TS) must order by
-- seq, never by created_at.
--
-- Idempotent. Postgres 15. Apply as supabase_admin.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The column + a backfill in the historical order we can still trust.
-- ---------------------------------------------------------------------------
alter table public.leave_ledger add column if not exists seq bigint;

with ordered as (
  select id, row_number() over (order by created_at, id) as rn
    from public.leave_ledger
)
update public.leave_ledger l
   set seq = o.rn
  from ordered o
 where o.id = l.id and l.seq is null;

-- ---------------------------------------------------------------------------
-- 2. A sequence owned by the column, positioned past the backfill.
-- ---------------------------------------------------------------------------
create sequence if not exists public.leave_ledger_seq_seq owned by public.leave_ledger.seq;

select setval('public.leave_ledger_seq_seq',
              coalesce((select max(seq) from public.leave_ledger), 0) + 1,
              false);

alter table public.leave_ledger alter column seq set default nextval('public.leave_ledger_seq_seq');
alter table public.leave_ledger alter column seq set not null;

-- ---------------------------------------------------------------------------
-- 3. The index that backs the latest-balance lookup, now on seq.
--    The old (…, created_at desc, id desc) index stays: harmless, and other
--    chronological queries still use it.
-- ---------------------------------------------------------------------------
create index if not exists leave_ledger_emp_type_seq_idx
  on public.leave_ledger (employee_id, leave_type_id, seq desc);

-- ---------------------------------------------------------------------------
-- 4. current_leave_balance — order by seq. Return type is unchanged (int), so
--    create or replace is fine here.
-- ---------------------------------------------------------------------------
create or replace function public.current_leave_balance(p_employee_id uuid, p_leave_type_id uuid)
returns int language sql stable security definer set search_path = '' as $$
  select coalesce((
    select balance_after_minutes from public.leave_ledger
    where employee_id = p_employee_id and leave_type_id = p_leave_type_id
    order by seq desc limit 1
  ), 0);
$$;

revoke execute on function public.current_leave_balance(uuid, uuid) from public, anon, authenticated;
