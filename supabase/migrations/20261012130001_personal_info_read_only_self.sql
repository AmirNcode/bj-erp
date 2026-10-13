-- FR-63 (2026-10-12): personal information is read-only to its owner.
--
-- An employee sees their own personal information on Profile but can no longer
-- change it; hr and admin edit OTHER people's (hr still never an admin's). The
-- owner's own row is editable only with the new permission key
-- `personal_info.edit_own` — today admin only. That key is the switch FR-55's
-- configurable roles exposes per role ("may edit own personal information").
--
-- Covers every write path: the RLS update policy (Profile form and Manage ›
-- Employees › Edit) and the CSV import RPC. The clearance form writes the
-- leaver's father's name / birth certificate number, never the filer's own.

CREATE OR REPLACE FUNCTION private.has_permission(uid uuid, p_permission text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select case p_permission
    when 'employees.edit'     then private.is_admin(uid) or private.has_role(uid, 'hr')
    when 'departments.edit'   then private.is_admin(uid) or private.has_role(uid, 'hr')
    when 'accruals.run'       then private.is_admin(uid) or private.has_role(uid, 'hr')
    when 'roles.manager'      then private.is_admin(uid) or private.has_role(uid, 'hr')
    when 'personal_info.view' then private.is_admin(uid) or private.has_role(uid, 'hr')
    when 'personal_info.edit' then private.is_admin(uid) or private.has_role(uid, 'hr')
    when 'personal_info.edit_own' then private.is_admin(uid)
    when 'separations.manage' then private.is_admin(uid) or private.has_role(uid, 'hr')
    when 'separations.view'   then private.is_admin(uid) or private.has_role(uid, 'hr')
                                   or private.has_role(uid, 'finance')
    when 'settings.edit'      then private.is_admin(uid) or private.has_role(uid, 'hr')
    when 'absences.view'      then private.is_admin(uid) or private.has_role(uid, 'security')
    when 'finance.view'       then private.is_admin(uid) or private.has_role(uid, 'finance')
    else false
  end;
$$;

CREATE OR REPLACE FUNCTION public.app_import_personal_info(p_rows jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid      uuid := auth.uid();
  v_company  uuid;
  v_is_admin boolean := private.is_admin(auth.uid());
  v_row      jsonb;
  v_pno      text;
  v_target   uuid;
  v_updated  int := 0;
  v_fields   constant text[] := array[
    'national_id','birth_cert_no','father_name','birth_date','birth_place','gender',
    'marital_status','bank_name','bank_account_no','sheba','card_no','mobile','home_phone',
    'address','postal_code','emergency_name','emergency_phone','insurance_no','education',
    'military_status','children_count'];
  v_key      text;
begin
  if not private.has_permission(v_uid, 'personal_info.edit') then
    raise exception 'not permitted to import personal info' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'no rows to import' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'too many rows (max 2000)' using errcode = '22023';
  end if;
  select company_id into v_company from public.profiles where id = v_uid;

  if (select count(distinct r->>'personnel_no') <> count(*) from jsonb_array_elements(p_rows) r) then
    raise exception 'duplicate personnel number in file' using errcode = '22023';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_pno := v_row->>'personnel_no';
    select id into v_target from public.profiles
     where company_id = v_company and personnel_no = v_pno;
    if v_target is null then
      raise exception 'unknown personnel number: %', coalesce(v_pno, '(empty)') using errcode = '22023';
    end if;
    -- FR-63: one's own row follows personal_info.edit_own, not the import.
    if v_target = v_uid and not private.has_permission(v_uid, 'personal_info.edit_own') then
      raise exception 'not permitted to edit your own personal info: %', v_pno using errcode = '42501';
    end if;
    if not v_is_admin and exists (select 1 from public.user_roles
                                   where user_id = v_target and role = 'admin') then
      raise exception 'not permitted to edit an admin''s personal info: %', v_pno using errcode = '42501';
    end if;
    for v_key in select jsonb_object_keys(v_row) loop
      if v_key <> 'personnel_no' and not (v_key = any (v_fields)) then
        raise exception 'unknown field: %', v_key using errcode = '22023';
      end if;
    end loop;

    update public.employee_personal_info i set
      national_id     = coalesce(v_row->>'national_id', i.national_id),
      birth_cert_no   = coalesce(v_row->>'birth_cert_no', i.birth_cert_no),
      father_name     = coalesce(v_row->>'father_name', i.father_name),
      birth_date      = coalesce((v_row->>'birth_date')::date, i.birth_date),
      birth_place     = coalesce(v_row->>'birth_place', i.birth_place),
      gender          = coalesce(v_row->>'gender', i.gender),
      marital_status  = coalesce(v_row->>'marital_status', i.marital_status),
      bank_name       = coalesce(v_row->>'bank_name', i.bank_name),
      bank_account_no = coalesce(v_row->>'bank_account_no', i.bank_account_no),
      sheba           = coalesce(v_row->>'sheba', i.sheba),
      card_no         = coalesce(v_row->>'card_no', i.card_no),
      mobile          = coalesce(v_row->>'mobile', i.mobile),
      home_phone      = coalesce(v_row->>'home_phone', i.home_phone),
      address         = coalesce(v_row->>'address', i.address),
      postal_code     = coalesce(v_row->>'postal_code', i.postal_code),
      emergency_name  = coalesce(v_row->>'emergency_name', i.emergency_name),
      emergency_phone = coalesce(v_row->>'emergency_phone', i.emergency_phone),
      insurance_no    = coalesce(v_row->>'insurance_no', i.insurance_no),
      education       = coalesce(v_row->>'education', i.education),
      military_status = coalesce(v_row->>'military_status', i.military_status),
      children_count  = coalesce((v_row->>'children_count')::smallint, i.children_count)
     where i.employee_id = v_target;
    v_updated := v_updated + 1;
  end loop;

  insert into public.audit_log(actor_id, action, entity, entity_id, after)
  values (v_uid, 'personal_info.import', 'employee_personal_info', null,
          jsonb_build_object('rows', v_updated));

  return jsonb_build_object('updated', v_updated);
end; $$;

drop policy employee_personal_info_update on public.employee_personal_info;

create policy employee_personal_info_update on public.employee_personal_info
  for update to authenticated
  using (
    private.is_active((select auth.uid()))
    and (
      (employee_id = (select auth.uid())
        and private.has_permission((select auth.uid()), 'personal_info.edit_own'))
      or (employee_id <> (select auth.uid())
        and private.has_permission((select auth.uid()), 'personal_info.edit')
        and company_id = (select p.company_id from public.profiles p where p.id = (select auth.uid()))
        and (private.is_admin((select auth.uid()))
             or not exists (select 1 from public.user_roles r
                             where r.user_id = employee_personal_info.employee_id and r.role = 'admin')))
    )
  )
  with check (
    private.is_active((select auth.uid()))
    and (
      (employee_id = (select auth.uid())
        and private.has_permission((select auth.uid()), 'personal_info.edit_own'))
      or (employee_id <> (select auth.uid())
        and private.has_permission((select auth.uid()), 'personal_info.edit')
        and company_id = (select p.company_id from public.profiles p where p.id = (select auth.uid())))
    )
  );
