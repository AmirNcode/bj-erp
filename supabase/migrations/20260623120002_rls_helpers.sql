-- =============================================================================
-- Migration: 20260623120002_rls_helpers.sql
-- Purpose  : SECURITY DEFINER helper functions used by RLS policies.
-- Spec     : docs/PERMISSIONS.md  (SQL helpers section)
--
-- All functions are:
--   SECURITY DEFINER  — run as function owner (bypasses caller's RLS),
--                        required to avoid infinite recursion when policies
--                        on profiles/user_roles call these helpers.
--   STABLE            — no side-effects; same inputs → same output within a txn.
--   SET search_path = '' — prevents search-path hijacking (mandatory for
--                        SECURITY DEFINER functions).
--   All object references are fully-qualified (public.<table> / auth.<table>).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. has_role(uid, r) → true if user uid holds role r
-- ---------------------------------------------------------------------------

create or replace function public.has_role(uid uuid, r public.app_role)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = uid
      and role    = r
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. is_admin(uid) → true if user is an admin
-- ---------------------------------------------------------------------------

create or replace function public.is_admin(uid uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select public.has_role(uid, 'admin');
$$;

-- ---------------------------------------------------------------------------
-- 3. is_manager_of(uid, target) → true if target's manager_id = uid
-- ---------------------------------------------------------------------------

create or replace function public.is_manager_of(uid uuid, target uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id         = target
      and manager_id = uid
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. same_team(uid, target) → true if both users share the same department
-- ---------------------------------------------------------------------------

create or replace function public.same_team(uid uuid, target uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select
    (select department_id from public.profiles where id = uid)
    =
    (select department_id from public.profiles where id = target)
  and
    (select department_id from public.profiles where id = uid) is not null;
$$;

-- ---------------------------------------------------------------------------
-- 5. can_read_all(uid) → true if user is admin, manager, or security
-- ---------------------------------------------------------------------------

create or replace function public.can_read_all(uid uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select
    public.is_admin(uid)
    or public.has_role(uid, 'manager')
    or public.has_role(uid, 'security');
$$;
