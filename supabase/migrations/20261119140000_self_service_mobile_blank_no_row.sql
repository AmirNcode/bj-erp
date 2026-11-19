-- FR-96 review fix: app_set_my_mobile no longer creates an empty employee_personal_info row (and an
-- audit entry) when a caller with no row clears a number they never had. Everything else is unchanged
-- from 20261119120000_self_service_mobile.sql.

create or replace function public.app_set_my_mobile(p_mobile text) returns text
  language plpgsql security definer
  set search_path to ''
  as $$
declare
  v_uid uuid := auth.uid();
  v_company uuid;
  v_mobile text := private.normalize_ir_mobile(p_mobile);
begin
  if v_uid is null or not private.is_active(v_uid) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_mobile, '')), '') is not null and v_mobile is null then
    raise exception 'invalid mobile' using errcode = '22023';
  end if;

  update public.employee_personal_info set mobile = v_mobile where employee_id = v_uid;
  if not found and v_mobile is not null then
    select company_id into v_company from public.profiles where id = v_uid;
    insert into public.employee_personal_info (employee_id, company_id, mobile, updated_by)
    values (v_uid, v_company, v_mobile, v_uid);
    insert into public.audit_log (actor_id, action, entity, entity_id, after)
    values (v_uid, 'personal_info.update', 'employee_personal_info', v_uid,
            jsonb_build_object('fields', jsonb_build_array('mobile')));
  end if;
  return v_mobile;
end $$;

revoke all on function public.app_set_my_mobile(text) from public, anon;
grant execute on function public.app_set_my_mobile(text) to authenticated;
