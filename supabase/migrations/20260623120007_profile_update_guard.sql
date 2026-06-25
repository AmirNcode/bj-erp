-- =============================================================================
-- Migration: 20260623120007_profile_update_guard.sql
-- Purpose  : Enforce COLUMN-level update scope on profiles at the database.
-- Why       : profiles_update RLS (0003) is row-level only — it lets a manager
--             update a direct report's row, but cannot restrict WHICH columns.
--             The TS allowedProfileFields() filter is NOT a security boundary
--             (the app uses the anon key under RLS; a JWT holder can PATCH
--             PostgREST directly). A BEFORE UPDATE trigger is required because
--             RLS WITH CHECK cannot compare OLD vs NEW.
--
-- Policy enforced for NON-admin updaters:
--   * self  (id = auth.uid())            -> may change: full_name, language_pref, calendar_pref
--   * manager of the row                 -> may change: full_name, hire_date
--   * anyone else                        -> blocked (RLS already blocks, belt-and-suspenders)
--   * company_id, employee_code, department_id, manager_id, active, id, created_at
--     are admin-only and must be unchanged by non-admins.
-- =============================================================================

create or replace function private.enforce_profile_update_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_allowed text[];
begin
  if private.is_admin(v_uid) then
    return new;  -- admins may change anything
  end if;

  if new.id = v_uid then
    v_allowed := array['full_name', 'language_pref', 'calendar_pref'];
  elsif private.is_manager_of(v_uid, new.id) then
    v_allowed := array['full_name', 'hire_date'];
  else
    raise exception 'not permitted to update this profile' using errcode = '42501';
  end if;

  if (new.id            is distinct from old.id)
     or (new.company_id    is distinct from old.company_id)
     or (new.employee_code is distinct from old.employee_code)
     or (new.created_at    is distinct from old.created_at)
     or (new.department_id is distinct from old.department_id)
     or (new.manager_id    is distinct from old.manager_id)
     or (new.active        is distinct from old.active)
     or (new.full_name     is distinct from old.full_name     and not ('full_name'     = any (v_allowed)))
     or (new.hire_date     is distinct from old.hire_date     and not ('hire_date'     = any (v_allowed)))
     or (new.language_pref is distinct from old.language_pref and not ('language_pref' = any (v_allowed)))
     or (new.calendar_pref is distinct from old.calendar_pref and not ('calendar_pref' = any (v_allowed)))
  then
    raise exception 'not permitted to modify restricted profile fields' using errcode = '42501';
  end if;

  return new;
end; $$;

create trigger profiles_enforce_update_scope
  before update on public.profiles
  for each row execute function private.enforce_profile_update_scope();
