-- =============================================================================
-- Migration: 20260818170001_weekend_frequency.sql
-- Purpose  : A weekday may be off EVERY week or EVERY OTHER week. The client's
--            real working week is Friday off weekly and Thursday off fortnightly,
--            which `work_settings.weekend_days int[]` cannot express.
-- Requirement: FR-41 (extends FR-12, FR-24)
-- Spec     : docs/specs/2026-08-18-holidays-weekends-approvers-design.md Part 3
-- Depends  : 20260623120005_leave.sql (work_settings.weekend_days)
--
-- Schema + the shared rule only. `compute_requested_minutes` is redefined in
-- 20260818170002 so a failure in one leaves the other resumable — the migration
-- ledger records each file separately.
--
-- ── Why weekend_days is NOT migrated ────────────────────────────────────────
--
-- The weekly list keeps its exact current meaning, and the new column defaults to
-- an empty array. A date is a weekend when its ISO weekday is in `weekend_days`
-- OR it is in `biweekly_weekend_days` AND its week matches the anchor's parity.
-- With the default empty array the second branch can never fire, so every
-- existing install — including the client's, which is live with real data —
-- behaves exactly as before until an admin changes the setting. That is what
-- makes this safe to deploy against a running system.
--
-- ── Why the week grid starts on SATURDAY ────────────────────────────────────
--
-- Parity is counted in whole weeks from 2000-01-01, which was a Saturday — the
-- first day of the Iranian week. On an ISO Monday grid a Saturday and the
-- Thursday of the SAME Iranian working week fall in different buckets and could
-- land on opposite parities, so one week would show two days off and the next
-- none. Nothing in the existing schema forced this choice, which is exactly why
-- it is written down here.
--
-- Idempotent: add column if not exists + create or replace. Safe to re-run.
-- =============================================================================

-- ── config ───────────────────────────────────────────────────────────────────

alter table public.work_settings
  add column if not exists biweekly_weekend_days int[] not null default '{}';

alter table public.work_settings
  add column if not exists biweekly_anchor date;

comment on column public.work_settings.biweekly_weekend_days is
  'FR-41: ISO weekday numbers that are off every OTHER week. Empty = feature unused.';
comment on column public.work_settings.biweekly_anchor is
  'FR-41: any date whose week is an off week. Required whenever biweekly_weekend_days is non-empty.';

-- Both lists hold ISO weekday numbers, and together they must leave at least one
-- working weekday — otherwise every request would compute zero minutes and leave
-- could never be spent. Enforced here as well as in the action, because the
-- action is not the boundary.
alter table public.work_settings
  drop constraint if exists work_settings_biweekly_days_valid;
-- `<@` is "is contained by", so `array[1..7] <@ union` means all seven weekdays
-- are covered; negating it is the "at least one working day" rule. Written this
-- way because a CHECK constraint may not contain a subquery, which rules out the
-- obvious `cardinality(array(select distinct unnest(...)))` form.
alter table public.work_settings
  add constraint work_settings_biweekly_days_valid check (
    biweekly_weekend_days <@ array[1,2,3,4,5,6,7]
    and not (
      array[1,2,3,4,5,6,7]
      <@ (coalesce(weekend_days, '{}') || coalesce(biweekly_weekend_days, '{}'))
    )
  );

-- A biweekly rule with no anchor has no defined parity. Refusing the row is the
-- only honest option: defaulting the anchor would silently pick which Thursdays
-- are off.
alter table public.work_settings
  drop constraint if exists work_settings_biweekly_anchor_required;
alter table public.work_settings
  add constraint work_settings_biweekly_anchor_required check (
    cardinality(coalesce(biweekly_weekend_days, '{}')) = 0 or biweekly_anchor is not null
  );

-- ── the rule, in ONE place ───────────────────────────────────────────────────
--
-- `compute_requested_minutes` repeats its weekend test in four places (hourly
-- leave, half-day, the daily loop, and the daily-errand path). Adding a second
-- condition to four copies is precisely how the `allocated_days` breakage in
-- docs/MEMORY.md happened: a later migration redefined one copy and the port
-- missed another. So the test moves here and the callers ask.
--
-- Marked STABLE, not IMMUTABLE: it reads work_settings.
create or replace function private.is_company_weekend(p_company_id uuid, p_date date)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_weekly   int[];
  v_biweekly int[];
  v_anchor   date;
  v_dow      int;
begin
  if p_date is null then return false; end if;

  select coalesce(weekend_days, '{5}'),
         coalesce(biweekly_weekend_days, '{}'),
         biweekly_anchor
    into v_weekly, v_biweekly, v_anchor
    from public.work_settings
   where company_id = p_company_id
   limit 1;

  -- No settings row: same fallback the callers have always used (Friday only).
  if v_weekly is null then
    v_weekly := '{5}';
    v_biweekly := '{}';
  end if;

  v_dow := extract(isodow from p_date)::int;

  if v_dow = any(v_weekly) then
    return true;
  end if;

  if v_anchor is null or array_length(v_biweekly, 1) is null then
    return false;
  end if;

  if v_dow <> all(v_biweekly) then
    return false;
  end if;

  -- Whole weeks between the two dates' week buckets, on a Saturday-aligned grid.
  -- floor() division matters: `/` on integers truncates toward zero in Postgres,
  -- so a date BEFORE the epoch would bucket wrongly without it. The epoch is far
  -- in the past, but relying on that is the kind of assumption that breaks once.
  return mod(
           abs(
             floor((p_date  - date '2000-01-01') / 7.0)::int
             - floor((v_anchor - date '2000-01-01') / 7.0)::int
           ),
           2
         ) = 0;
end;
$$;

comment on function private.is_company_weekend(uuid, date) is
  'FR-41: single source of truth for "is this date a non-working weekend day for this company". Mirrored in lib/leave/weekend.ts.';

revoke all on function private.is_company_weekend(uuid, date) from public;
grant execute on function private.is_company_weekend(uuid, date) to authenticated;

-- ── assert the contract this migration relies on ─────────────────────────────
--
-- The default MUST be an empty array, or deploying this against the client's live
-- database would silently start treating weekdays as days off.
--
-- Asserting the COLUMN DEFAULT rather than the current rows: once an admin has
-- configured a biweekly weekday, a row-based assertion would raise on every
-- subsequent replay and break the deploy. The default is the thing that actually
-- protects the live database, and it does not change with use.
do $$
declare
  v_default text;
begin
  select column_default into v_default
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'work_settings'
     and column_name = 'biweekly_weekend_days';

  if v_default is null or v_default not like '%{}%' then
    raise exception
      'FR-41: biweekly_weekend_days must default to an empty array, found %', coalesce(v_default, 'NULL');
  end if;
end $$;
