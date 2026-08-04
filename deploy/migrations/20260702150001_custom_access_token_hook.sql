-- =============================================================================
-- Migration: 20260702150001_custom_access_token_hook.sql
-- Purpose  : Embed the user's role slugs in the JWT as an `app_roles` claim,
--            so per-navigation role checks read the (locally verified) token
--            instead of querying user_roles — one fewer round-trip per render.
-- Spec     : docs/plans/2026-07-02-nav-performance.md (P2)
--
-- How it works (Supabase Custom Access Token auth hook):
--   Auth calls public.custom_access_token_hook(event) as `supabase_auth_admin`
--   every time it issues an access token (login + each refresh). The function
--   injects `app_roles`: a JSON array of the user's role slugs, [] when none.
--
--   NOTE: the hook must also be ENABLED per environment —
--     hosted: Dashboard → Authentication → Hooks → Customize Access Token
--     local : supabase/config.toml [auth.hook.custom_access_token]
--   Until enabled, tokens simply lack the claim and the app falls back to
--   querying user_roles (lib/auth/context.ts) — no behavior change.
--
--   Role edits reach a user on their next token refresh (≤1 h), not instantly
--   (accepted trade-off — RLS keeps enforcing from user_roles in real time).
--
-- Permissions follow the official Supabase RBAC guide: grant only what
-- supabase_auth_admin needs, keep the function un-callable via the Data API,
-- and leave existing `authenticated` access to user_roles untouched (the app
-- and its RLS helpers still read the table directly).
-- =============================================================================

create or replace function public.custom_access_token_hook(event jsonb)
  returns jsonb
  language plpgsql
  stable
  set search_path = ''
as $$
declare
  claims jsonb;
  roles  jsonb;
begin
  select coalesce(jsonb_agg(role order by role), '[]'::jsonb)
    into roles
    from public.user_roles
   where user_id = (event->>'user_id')::uuid;

  claims := jsonb_set(coalesce(event->'claims', '{}'::jsonb), '{app_roles}', roles);
  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- Auth server (supabase_auth_admin) must be able to call the hook and read
-- user_roles; nobody else gains anything new.
grant usage on schema public to supabase_auth_admin;

grant execute
  on function public.custom_access_token_hook(jsonb)
  to supabase_auth_admin;

revoke execute
  on function public.custom_access_token_hook(jsonb)
  from authenticated, anon, public;

grant select on table public.user_roles to supabase_auth_admin;

drop policy if exists "user_roles_select_auth_admin" on public.user_roles;
create policy "user_roles_select_auth_admin" on public.user_roles
  as permissive for select
  to supabase_auth_admin
  using (true);
