-- =============================================================================
-- Migration: 20261020120000_procurement_role_enum.sql
-- Purpose  : Add 'procurement' to the app_role enum. THAT IS ALL THIS FILE MAY DO.
-- Requirement: FR-70 (travel booking)
-- Spec     : docs/specs/2026-10-20-travel-booking-design.md
--
-- ⚠️  DO NOT ADD ANYTHING ELSE TO THIS FILE. Postgres refuses to use a new enum
--     value in the transaction that added it (see 20260818130001_hr_role_enum.sql).
--
-- 'procurement' is only the system_key of the editable Procurement preset role
-- (seeded in 20261020120001). It is never an approval-step role:
-- approval_steps_role_allowed admits manager, hr and employee only.
-- =============================================================================

alter type public.app_role add value if not exists 'procurement';
