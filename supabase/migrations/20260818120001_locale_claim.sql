-- =============================================================================
-- Migration: 20260818120001_locale_claim.sql
-- Purpose  : Add an `app_locale` claim to the access token, beside the existing
--            `app_roles`, so the middleware can honour a user's chosen language
--            on a URL that names no locale without a database round-trip.
-- Requirement: FR-34
-- Spec     : docs/specs/2026-08-18-hr-role-and-locale-persistence-design.md
--
-- Why the token and not just a cookie:
--   The cookie (`bj-locale`) is written the instant the setting changes and is
--   what makes the switch feel immediate. But it is per-browser: a new device, a
--   cleared browser, or a reinstalled PWA has no cookie, and those are precisely
--   the moments the old behaviour dumped an English user back into Farsi. The
--   claim follows the account instead of the browser and is refreshed on every
--   token issue, so it heals itself within an hour of any change.
--
--   Consequence, accepted and identical to how `app_roles` already behaves: a
--   language change made elsewhere reaches an existing session on its next token
--   refresh (≤1 h). The cookie covers the local case instantly, so this is only
--   the cross-device path.
--
-- Idempotent: create or replace, plus guarded grants/policy. Safe to re-run.
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
  locale text;
begin
  select coalesce(jsonb_agg(role order by role), '[]'::jsonb)
    into roles
    from public.user_roles
   where user_id = (event->>'user_id')::uuid;

  select p.language_pref
    into locale
    from public.profiles p
   where p.id = (event->>'user_id')::uuid;

  claims := jsonb_set(coalesce(event->'claims', '{}'::jsonb), '{app_roles}', roles);

  -- Constrain to the locales the app actually routes. A junk value here would
  -- become a URL path segment in the middleware; lib/i18n/locale.ts rejects
  -- anything unknown as well, but emitting a bad claim in the first place is
  -- worse than pinning it to the default.
  claims := jsonb_set(
    claims,
    '{app_locale}',
    to_jsonb(case when locale in ('fa', 'en') then locale else 'fa' end)
  );

  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- The hook runs as `supabase_auth_admin`, which is NOT `authenticated` and so is
-- not covered by any existing policy on profiles. It therefore needs its own
-- read path — mirroring what 20260702150001 already did for user_roles.
--
-- Deliberately narrower than that precedent: a COLUMN-level grant, so the auth
-- role can read the two columns the hook needs and none of the personal data on
-- the rest of the row (full_name, personnel_no, hire_date, …).
grant select (id, language_pref) on table public.profiles to supabase_auth_admin;

drop policy if exists "profiles_select_auth_admin" on public.profiles;
create policy "profiles_select_auth_admin" on public.profiles
  as permissive for select
  to supabase_auth_admin
  using (true);

comment on policy "profiles_select_auth_admin" on public.profiles is
  'Lets the GoTrue auth role read language_pref for the app_locale JWT claim (FR-34). Paired with a column-level grant on (id, language_pref); no other role is affected.';
