-- =============================================================================
-- Migration: 20260729130002_leave_minutes_expand.sql
-- Purpose  : EXPAND phase of the days -> minutes conversion (spec §5). Adds the
--            minutes columns, backfills them, and keeps them in sync with the
--            day columns via triggers. Behaviour is unchanged: the day columns
--            stay authoritative until the CONTRACT migration (…130003).
--
--            Split expand/contract deliberately: this runs against the client's
--            live balances, so the schema must be provably correct before any
--            function is rewritten or any column dropped, and every intermediate
--            state stays deployable.
--
-- Backfill constant is 480 (8h × 60) ON PURPOSE, not work_settings.hours_per_day:
-- history was recorded when a day meant 8 hours, and an admin later setting a
-- 7.5h day must not retroactively shift past balances.
--
-- Idempotent: the dev machine has no "supabase db reset" and deploy/update.sh
-- replays every migration file on the client's server.
-- Target is Postgres 15 (supabase/postgres:15.8.1.085) — no PG16+ syntax.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. work_settings.hours_per_day — what a "day" of leave means going forward
-- ---------------------------------------------------------------------------
alter table public.work_settings
  add column if not exists hours_per_day numeric not null default 8;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'work_settings_hours_per_day_sane'
  ) then
    alter table public.work_settings
      add constraint work_settings_hours_per_day_sane
      check (hours_per_day > 0 and hours_per_day <= 24);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Minutes columns, nullable at first so the backfill can populate them
-- ---------------------------------------------------------------------------
alter table public.leave_ledger
  add column if not exists delta_minutes         int,
  add column if not exists balance_after_minutes int;

alter table public.leave_requests
  add column if not exists requested_minutes int;

alter table public.leave_allocations
  add column if not exists allocated_minutes int;

-- ---------------------------------------------------------------------------
-- 3. Backfill. Existing values are whole days or .5, so ×480 is exact.
-- ---------------------------------------------------------------------------
update public.leave_ledger
   set delta_minutes         = round(delta_days * 480),
       balance_after_minutes = round(balance_after * 480)
 where delta_minutes is null or balance_after_minutes is null;

update public.leave_requests
   set requested_minutes = round(requested_days * 480)
 where requested_minutes is null;

update public.leave_allocations
   set allocated_minutes = round(allocated_days * 480)
 where allocated_minutes is null;

-- ---------------------------------------------------------------------------
-- 4. Now enforce NOT NULL
-- ---------------------------------------------------------------------------
alter table public.leave_ledger      alter column delta_minutes         set not null;
alter table public.leave_ledger      alter column balance_after_minutes set not null;
alter table public.leave_requests    alter column requested_minutes     set not null;
alter table public.leave_allocations alter column allocated_minutes     set not null;

-- ---------------------------------------------------------------------------
-- 5. Sync triggers. The existing definer functions write only the day columns;
--    these fill the minutes columns from them. Dropped in …130003 once the
--    functions write minutes natively.
--    Direction is days -> minutes only: days remain authoritative this phase.
-- ---------------------------------------------------------------------------
create or replace function public.leave_ledger_sync_minutes()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.delta_minutes         := round(new.delta_days * 480);
  new.balance_after_minutes := round(new.balance_after * 480);
  return new;
end; $$;

create or replace trigger leave_ledger_sync_minutes_trg
  before insert or update on public.leave_ledger
  for each row execute function public.leave_ledger_sync_minutes();

create or replace function public.leave_requests_sync_minutes()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.requested_minutes := round(new.requested_days * 480);
  return new;
end; $$;

create or replace trigger leave_requests_sync_minutes_trg
  before insert or update on public.leave_requests
  for each row execute function public.leave_requests_sync_minutes();

create or replace function public.leave_allocations_sync_minutes()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.allocated_minutes := round(new.allocated_days * 480);
  return new;
end; $$;

create or replace trigger leave_allocations_sync_minutes_trg
  before insert or update on public.leave_allocations
  for each row execute function public.leave_allocations_sync_minutes();
