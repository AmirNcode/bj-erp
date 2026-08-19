-- =============================================================================
-- Migration: 20260818170002_weekend_frequency_counting.sql
-- Purpose  : Route every weekend test in compute_requested_minutes through
--            private.is_company_weekend, so the bi-weekly rule (FR-41) applies to
--            leave duration, half-days and hourly leave.
-- Requirement: FR-41 (extends FR-12)
-- Spec     : docs/specs/2026-08-18-holidays-weekends-approvers-design.md Part 3
-- Depends  : 20260818170001_weekend_frequency.sql (the helper)
--
-- ── How this body was produced ──────────────────────────────────────────────
--
-- Dumped from `pg_get_functiondef` on the LIVE database and patched by a script
-- whose every anchor had to match exactly once, per docs/MEMORY.md. Migration
-- history holds several versions of this function (20260729130003,
-- 20260729130009, 20260730130001, 20260806014310) and only the last one runs;
-- retyping it by hand is how a transcription slip becomes invisible in review.
--
-- ── What changed, and what deliberately did not ─────────────────────────────
--
-- THREE weekend tests existed, not four: the hourly-leave branch, the am/pm
-- half-day branch, and the daily loop. The daily-ERRAND branch returns inclusive
-- calendar days times hours_per_day and never consulted weekend_days, because an
-- errand may fall on a weekend or holiday (DATA_MODEL, FR-30/FR-33). It stays
-- that way — routing it through the helper would have quietly changed errand
-- durations.
--
-- The `v_weekend` local is gone: the rule now lives in the helper, and a stale
-- copy of the weekly list sitting in this function is exactly the kind of second
-- source of truth that caused the allocated_days breakage in docs/MEMORY.md.
--
-- Behaviour is UNCHANGED for any company that has not set a bi-weekly weekday,
-- because the helper's second branch cannot fire on an empty array.
--
-- Idempotent: create or replace with an unchanged signature. Safe to re-run.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.compute_requested_minutes(p_company_id uuid, p_start date, p_end date, p_day_part day_part, p_unit leave_unit DEFAULT 'day'::leave_unit, p_start_time time without time zone DEFAULT NULL::time without time zone, p_end_time time without time zone DEFAULT NULL::time without time zone, p_kind request_kind DEFAULT 'leave'::request_kind)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_per_day numeric;
  v_count numeric := 0;
  d date;
  v_working boolean;
begin
  if p_end < p_start then return 0; end if;

  select hours_per_day into v_per_day
    from public.work_settings where company_id = p_company_id limit 1;
  if v_per_day is null then v_per_day := 8; end if;

  if p_unit = 'hour' then
    if p_start_time is null or p_end_time is null or p_end_time <= p_start_time then
      return 0;
    end if;
    if p_kind = 'errand' then
      return (extract(epoch from (p_end_time - p_start_time)) / 60)::int;
    end if;

    v_working := (not private.is_company_weekend(p_company_id, p_start))
                 and not exists (
                   select 1 from public.holidays h
                    where h.company_id = p_company_id and h.holiday_date = p_start
                 );
    if not v_working then return 0; end if;
    return (extract(epoch from (p_end_time - p_start_time)) / 60)::int;
  end if;

  if p_kind = 'errand' then
    return round(((p_end - p_start) + 1) * v_per_day * 60);
  end if;

  if p_day_part in ('am', 'pm') then
    if p_start <> p_end then return 0; end if;
    v_working := (not private.is_company_weekend(p_company_id, p_start))
                 and not exists (
                   select 1 from public.holidays h
                    where h.company_id = p_company_id and h.holiday_date = p_start
                 );
    return case when v_working then round(v_per_day * 60 / 2) else 0 end;
  end if;

  d := p_start;
  while d <= p_end loop
    if (not private.is_company_weekend(p_company_id, d))
       and not exists (
         select 1 from public.holidays h
          where h.company_id = p_company_id and h.holiday_date = d
       )
    then
      v_count := v_count + 1;
    end if;
    d := d + 1;
  end loop;

  return round(v_count * v_per_day * 60);
end;
$function$;
