-- Own text size (UI readability plan, task 4): profiles.font_step 0..4, 0 = 100%.
-- Only the person (or the admin) changes it; a people-edit holder editing someone else may not.
alter table public.profiles
  add column font_step smallint not null default 0;
alter table public.profiles
  add constraint profiles_font_step_range check (font_step between 0 and 4);
comment on column public.profiles.font_step is 'Own text-size step 0..4 (100%..140% label); changed only by the person or the admin.';

CREATE OR REPLACE FUNCTION private.enforce_profile_update_scope() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid     uuid := auth.uid();
  v_allowed text[];
begin
  if coalesce(current_setting('bj.separation_apply', true), '') = 'on'
     and old.active and not new.active
     and (to_jsonb(new) - 'active') = (to_jsonb(old) - 'active')
  then
    return new;
  end if;

  -- Credential writers may change this flag alone. Direct profile updates still pass the normal guard.
  if current_setting('bj.password_flag_write', true) = 'on' and new.must_change_password
     and (to_jsonb(new) - 'must_change_password') = (to_jsonb(old) - 'must_change_password') then
    return new;
  end if;
  if private.is_admin(v_uid) then
    return new;  -- admins may change anything
  end if;

  if new.id = v_uid then
    -- FR-83: a name is no longer the person's own to change; only a people edit holder keeps it.
    v_allowed := array['language_pref', 'calendar_pref', 'font_step'];
    if private.has_perm(v_uid, 'people', 'edit') then
      v_allowed := v_allowed || array['full_name', 'first_name', 'last_name'];
    end if;
  elsif private.has_perm(v_uid, 'people', 'edit')
        -- FR-55 D4: same company, never an admin (even a deactivated one, so an
        -- editor cannot reactivate one), and nothing the editor does not hold.
        and private.can_act_on(v_uid, old.id)
  then
    v_allowed := array['full_name', 'first_name', 'last_name', 'hire_date', 'department_id', 'manager_id', 'job_title', 'active'];
  else
    -- Password resets are the admin's alone (20261013200007).
    raise exception 'not permitted to update this profile' using errcode = '42501';
  end if;

  if (new.id            is distinct from old.id)
     or (new.company_id    is distinct from old.company_id)
     or (new.employee_code is distinct from old.employee_code)
     or (new.personnel_no  is distinct from old.personnel_no)
     or (new.created_at    is distinct from old.created_at)
     or (new.must_change_password is distinct from old.must_change_password
         and coalesce(current_setting('bj.password_flag_write', true), '') <> 'on')
     or (new.full_name     is distinct from old.full_name     and not ('full_name'     = any (v_allowed)))
     or (new.first_name    is distinct from old.first_name    and not ('first_name'    = any (v_allowed)))
     or (new.last_name     is distinct from old.last_name     and not ('last_name'     = any (v_allowed)))
     or (new.hire_date     is distinct from old.hire_date     and not ('hire_date'     = any (v_allowed)))
     or (new.department_id is distinct from old.department_id and not ('department_id' = any (v_allowed)))
     or (new.manager_id    is distinct from old.manager_id    and not ('manager_id'    = any (v_allowed)))
     or (new.job_title     is distinct from old.job_title     and not ('job_title'     = any (v_allowed)))
     or (new.active        is distinct from old.active        and not ('active'        = any (v_allowed)))
     or (new.language_pref is distinct from old.language_pref and not ('language_pref' = any (v_allowed)))
     or (new.calendar_pref is distinct from old.calendar_pref and not ('calendar_pref' = any (v_allowed)))
     or (new.font_step     is distinct from old.font_step     and not ('font_step'     = any (v_allowed)))
  then
    raise exception 'not permitted to modify restricted profile fields' using errcode = '42501';
  end if;

  return new;
end; $$;
