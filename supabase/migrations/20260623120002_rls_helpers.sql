-- =============================================================================
-- Migration: 20260623120002_rls_helpers.sql
-- Purpose  : RLS helper functions, in a PRIVATE schema.
-- Spec     : docs/PERMISSIONS.md  (SQL helpers section)
--
-- Why a `private` schema (not `public`):
--   PostgREST only exposes the `public` (and a couple of system) schemas as a
--   REST API. Functions in `private` are therefore NOT callable via
--   /rest/v1/rpc/<fn> by `anon` or `authenticated` clients — closing the
--   information-disclosure surface flagged by the Supabase security advisor
--   (lints 0028 / 0029) — while RLS policies can still call them in-database.
--
-- Each function is:
--   SECURITY DEFINER     — runs as owner, bypassing the caller's RLS; required
--                          to avoid infinite recursion when policies on
--                          profiles / user_roles call these helpers.
--   STABLE               — no side effects.
--   SET search_path = '' — prevents search-path hijacking (mandatory for
--                          SECURITY DEFINER). All refs fully qualified.
--   EXECUTE granted to `authenticated` only (default PUBLIC grant revoked).
-- =============================================================================

create schema if not exists private;

create or replace function private.has_role(uid uuid, r public.app_role)
  returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles where user_id = uid and role = r);
$$;

create or replace function private.is_admin(uid uuid)
  returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_role(uid, 'admin');
$$;

create or replace function private.is_manager_of(uid uuid, target uuid)
  returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = target and manager_id = uid);
$$;

create or replace function private.same_team(uid uuid, target uuid)
  returns boolean language sql stable security definer set search_path = '' as $$
  select (select department_id from public.profiles where id = uid)
       = (select department_id from public.profiles where id = target)
     and (select department_id from public.profiles where id = uid) is not null;
$$;

create or replace function private.can_read_all(uid uuid)
  returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_admin(uid)
      or private.has_role(uid, 'manager')
      or private.has_role(uid, 'security');
$$;

-- Lock down EXECUTE: drop the implicit PUBLIC grant, allow only signed-in users.
revoke execute on all functions in schema private from public;
grant usage on schema private to authenticated;
grant execute on function private.has_role(uuid, public.app_role) to authenticated;
grant execute on function private.is_admin(uuid)                   to authenticated;
grant execute on function private.is_manager_of(uuid, uuid)        to authenticated;
grant execute on function private.same_team(uuid, uuid)            to authenticated;
grant execute on function private.can_read_all(uuid)               to authenticated;
