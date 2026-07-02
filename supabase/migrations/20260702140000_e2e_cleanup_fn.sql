-- =============================================================================
-- 20260702140000_e2e_cleanup_fn.sql — admin-guarded cleanup of e2e throwaway users
--
-- Playwright e2e runs create disposable employees (codes like mgr<ts>/emp<ts>/
-- ov<ts>/set<ts> with a 13-digit Date.now() timestamp, or set/pwd + 6 trailing
-- digits). Against the shared demo project these accumulate and clutter the
-- team calendar. app_cleanup_e2e_users() deletes them in one atomic statement
-- (auth.users cascades -> profiles -> requests / ledger / allocations / roles).
--
-- Safety: the match patterns are HARDCODED so the function can never touch a
-- real account (real codes are short: admin, m-prod, e-qc-1, 121, ...);
-- admin-only via the standard in-DB guard; deletions are audited.
-- Called by scripts/cleanup-e2e.mjs (npm run cleanup:e2e) and the Playwright
-- global teardown.
-- =============================================================================

create or replace function public.app_cleanup_e2e_users()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not private.is_admin(v_uid) then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  with junk as (
    select id from public.profiles
    where employee_code ~ '^(mgr|emp|cxl|auth|peer|lv|non|ov|e2e|set)[0-9]{13}$'
       or employee_code ~ '^(set|pwd)[0-9]{6}$'
  ),
  del as (
    delete from auth.users u using junk j where u.id = j.id returning u.id
  )
  select count(*) into v_count from del;

  if v_count > 0 then
    insert into public.audit_log (actor_id, action, entity, entity_id, after)
    values (v_uid, 'cleanup_e2e_users', 'auth.users', null,
            jsonb_build_object('deleted', v_count));
  end if;

  return v_count;
end; $$;

revoke execute on function public.app_cleanup_e2e_users() from public, anon;
grant  execute on function public.app_cleanup_e2e_users() to authenticated;
