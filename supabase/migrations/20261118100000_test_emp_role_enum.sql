-- =============================================================================
-- Migration: 20261118100000_test_emp_role_enum.sql
-- Purpose  : Add 'test-emp' to the app_role enum. THAT IS ALL THIS FILE MAY DO.
-- Requirement: FR-95 (built-in test roles)
--
-- ⚠️  DO NOT ADD ANYTHING ELSE TO THIS FILE. Postgres refuses to use a new enum
--     value in the transaction that added it (see 20260818130001_hr_role_enum.sql).
--
-- 'test-emp' is the system_key of the fixed built-in test-emp role (seeded in
-- 20261118100100): an outside reviewer sees the Employee screens, never other
-- people's data, and cannot file requests. Future test roles use the 'test-' prefix.
-- Never an approval-step role: approval_steps_role_allowed admits manager, hr, employee.
-- =============================================================================

alter type public.app_role add value if not exists 'test-emp';
