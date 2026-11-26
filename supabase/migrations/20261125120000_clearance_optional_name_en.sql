-- Clearance rows: the English unit name is optional (blank = show the Farsi name).
-- Still NOT NULL (the app sends ''), at most 100 characters.

alter table public.separation_units drop constraint separation_units_names;
alter table public.separation_units add constraint separation_units_names check (
  char_length(btrim(name_fa)) between 1 and 100 and char_length(btrim(name_en)) <= 100);
alter table public.separation_signoffs drop constraint separation_signoffs_names;
alter table public.separation_signoffs add constraint separation_signoffs_names check (
  char_length(btrim(name_fa)) between 1 and 100 and char_length(btrim(name_en)) <= 100);

CREATE OR REPLACE FUNCTION private.separation_row_signer(p_company uuid, p_employee uuid, p_row jsonb) RETURNS uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_dept   uuid := nullif(p_row->>'department_id', '')::uuid;
  v_signer uuid := nullif(p_row->>'signer_id', '')::uuid;
begin
  if jsonb_typeof(p_row) <> 'object'
     or coalesce(char_length(btrim(p_row->>'name_fa')), 0) not between 1 and 100
     or p_row->>'name_en' is null or char_length(btrim(p_row->>'name_en')) > 100 then
    raise exception 'invalid rows' using errcode = '22023';
  end if;
  if v_dept is not null
     and not exists (select 1 from public.departments where id = v_dept and company_id = p_company) then
    raise exception 'invalid rows' using errcode = '22023';
  end if;
  if v_signer is not null then
    if v_signer = p_employee then
      raise exception 'the departing employee cannot sign their own form' using errcode = '22023';
    end if;
    if not exists (select 1 from public.profiles
                    where id = v_signer and company_id = p_company and active) then
      raise exception 'invalid rows' using errcode = '22023';
    end if;
    return v_signer;
  end if;
  if v_dept is not null then
    select d.manager_id into v_signer
      from public.departments d
      join public.profiles m on m.id = d.manager_id and m.active
     where d.id = v_dept;
    if v_signer = p_employee then
      return null;
    end if;
    return v_signer;
  end if;
  return null;
end; $$;

CREATE OR REPLACE FUNCTION public.app_save_separation_units(p_units jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid     uuid := auth.uid();
  v_company uuid := private.separation_caller_company(v_uid);
  v_unit    jsonb;
  v_id      uuid;
  v_kind    text;
  v_dept    uuid;
  v_signer  uuid;
  v_keep    uuid[] := '{}';
  v_i       integer := 0;
begin
  if not private.has_perm(v_uid, 'clearance', 'edit') then
    raise exception 'not allowed to manage clearance forms' using errcode = '42501';
  end if;
  if p_units is null or jsonb_typeof(p_units) <> 'array' then
    raise exception 'invalid rows' using errcode = '22023';
  end if;
  insert into public.separation_units (company_id, kind, name_fa, name_en, sort_order)
  values (v_company, 'hr', 'مدیر اداری و منابع انسانی', 'HR & administration', 0)
  on conflict (company_id) where kind = 'hr' do nothing;

  for v_unit in select value from jsonb_array_elements(p_units) loop
    v_kind := v_unit->>'kind';
    if jsonb_typeof(v_unit) <> 'object'
       or coalesce(char_length(btrim(v_unit->>'name_fa')), 0) not between 1 and 100
       or v_unit->>'name_en' is null or char_length(btrim(v_unit->>'name_en')) > 100 then
      raise exception 'invalid rows' using errcode = '22023';
    end if;
    if v_kind = 'hr' then
      update public.separation_units
         set name_fa = btrim(v_unit->>'name_fa'), name_en = btrim(v_unit->>'name_en')
       where company_id = v_company and kind = 'hr';
      continue;
    end if;
    if v_kind is null or v_kind not in ('department', 'own_department', 'person') then
      raise exception 'invalid rows' using errcode = '22023';
    end if;
    v_i := v_i + 1;
    v_dept   := case when v_kind = 'department' then nullif(v_unit->>'department_id', '')::uuid end;
    v_signer := case when v_kind = 'person' then nullif(v_unit->>'signer_id', '')::uuid end;
    if v_kind = 'department' and (v_dept is null or not exists (
         select 1 from public.departments where id = v_dept and company_id = v_company)) then
      raise exception 'invalid rows' using errcode = '22023';
    end if;
    if v_signer is not null and not exists (
         select 1 from public.profiles where id = v_signer and company_id = v_company and active) then
      raise exception 'invalid rows' using errcode = '22023';
    end if;
    v_id := nullif(v_unit->>'id', '')::uuid;
    if v_id is not null and exists (select 1 from public.separation_units
                                     where id = v_id and company_id = v_company and kind <> 'hr') then
      update public.separation_units
         set kind = v_kind, name_fa = btrim(v_unit->>'name_fa'), name_en = btrim(v_unit->>'name_en'),
             department_id = v_dept, signer_id = v_signer, sort_order = v_i,
             active = coalesce((v_unit->>'active')::boolean, true)
       where id = v_id;
    else
      insert into public.separation_units (company_id, kind, name_fa, name_en, department_id, signer_id, sort_order, active)
      values (v_company, v_kind, btrim(v_unit->>'name_fa'), btrim(v_unit->>'name_en'), v_dept, v_signer, v_i,
              coalesce((v_unit->>'active')::boolean, true))
      returning id into v_id;
    end if;
    v_keep := v_keep || v_id;
  end loop;

  delete from public.separation_units
   where company_id = v_company and kind <> 'hr' and not (id = any (v_keep));
  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (v_uid, 'separation.units', 'separation_units', null, jsonb_build_object('units', v_i + 1));
end; $$;
