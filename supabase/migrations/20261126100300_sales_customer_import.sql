-- FR-98 ERP › Sales customer registry: bulk customer import (spec §9).
-- One resolver (private.sales_customer_import_resolve) serves the preview and the import, so the
-- preview shows exactly what the import will do. The import reuses the form's validation
-- (private.sales_customer_values). Every write takes the customer lock first.

-- ---------------------------------------------------------------- merge of a file row into a customer
-- Pure: the customer after an import row is applied. v = the file row's validated values (kind already
-- the effective kind). Update fills only empty fields; overwrite replaces with every non-empty file value.
-- The name never changes. Rank / category survive only on a contractor.
create function private.sales_customer_import_merge(m public.sales_customers, v public.sales_customers, p_overwrite boolean)
  returns public.sales_customers
  language plpgsql immutable set search_path = '' as $$
declare r public.sales_customers := m;
begin
  if p_overwrite then
    if v.name_en is not null then r.name_en := v.name_en; r.name_en_key := v.name_en_key; end if;
    r.kind := coalesce(v.kind, m.kind);
    r.ceo_name := coalesce(v.ceo_name, m.ceo_name);
    r.address := coalesce(v.address, m.address);
    if v.province_code is not null then
      -- A new province drops the old city (the city belongs to its province).
      if v.province_code is distinct from m.province_code then r.city_id := null; end if;
      r.province_code := v.province_code;
    end if;
    if v.city_id is not null then r.city_id := v.city_id; r.province_code := v.province_code; end if;
    r.rank := coalesce(v.rank, m.rank);
    r.category_id := coalesce(v.category_id, m.category_id);
  else
    if m.name_en is null and v.name_en is not null then r.name_en := v.name_en; r.name_en_key := v.name_en_key; end if;
    r.kind := coalesce(m.kind, v.kind);
    r.ceo_name := coalesce(m.ceo_name, v.ceo_name);
    r.address := coalesce(m.address, v.address);
    if m.province_code is null then r.province_code := v.province_code; end if;
    -- The city only together with its province, or when the customer already has that province.
    if m.city_id is null and v.city_id is not null and r.province_code is not distinct from v.province_code then
      r.city_id := v.city_id;
    end if;
    r.rank := coalesce(m.rank, v.rank);
    r.category_id := coalesce(m.category_id, v.category_id);
  end if;
  if r.kind is distinct from 'contractor' then r.rank := null; r.category_id := null; end if;
  return r;
end $$;

-- ---------------------------------------------------------------- resolver (shared, read-only)
-- p_maps (import only): {categories: {"<key>": uuid}, cities: {"<province>|<key>": uuid}} — decisions
-- that map an unknown file value to a list entry. Returns the shape documented in the plan (Task 4);
-- row error is also 'invalid' for a name over 200 characters.
create function private.sales_customer_import_resolve(p_company uuid, p_rows jsonb, p_maps jsonb default null)
  returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_e jsonb; v_o bigint; v_num numeric;
  v_out jsonb := '[]'::jsonb; v_ucat jsonb := '{}'::jsonb; v_ucity jsonb := '{}'::jsonb;
  v_new integer := 0; v_match integer := 0; v_err integer := 0;
  v_seen_ids uuid[] := '{}'; v_seen_keys text[] := '{}';
  v_row integer; v_status text; v_error text; v_name text; v_name_key text; v_en text; v_en_key text;
  v_match_id uuid; v_m public.sales_customers; v_m_kind text; v_m_prov text;
  v_vals jsonb; v_contact jsonb; v_dropped jsonb; v_unknown jsonb; v_incomplete boolean;
  v_txt text; v_k text; v_kind text; v_eff_kind text; v_ceo text; v_addr text; v_prov text; v_ctx_prov text;
  v_city uuid; v_cat uuid; v_rank integer; v_mapped text;
  v_pers text; v_title text; v_label text; v_phone text; v_email text; v_cv public.sales_customers;
  v_merged public.sales_customers; v_nc integer;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 1000 then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  for v_e in select x from jsonb_array_elements(p_rows) as t(x) loop
    if jsonb_typeof(v_e) <> 'object'
       or exists (select 1 from jsonb_each(v_e) j where jsonb_typeof(j.value) not in ('string', 'number', 'null')) then
      raise exception 'sales: invalid input' using errcode = '22023';
    end if;
  end loop;

  for v_e, v_o in select x, n from jsonb_array_elements(p_rows) with ordinality as t(x, n) loop
    v_num := private.sales_num(v_e->>'row');
    v_row := case when v_num is not null and v_num = trunc(v_num) and v_num between 1 and 2147483647
                  then v_num::integer else v_o::integer end;
    v_status := 'new'; v_error := null; v_match_id := null; v_m := null; v_m_kind := null; v_m_prov := null;
    v_vals := '{}'::jsonb; v_contact := null; v_dropped := '[]'::jsonb; v_unknown := '[]'::jsonb;
    v_incomplete := false; v_en_key := null;

    v_name := private.sales_clean(v_e->>'name');
    v_name_key := private.sales_name_key(v_name);
    v_en := private.sales_clean(v_e->>'name_en');

    -- ---- identity: error / match / new / duplicate in the file
    if v_name is null or v_name_key = '' then
      v_status := 'error'; v_error := 'no_name';
    elsif char_length(v_name) > 200 then
      v_status := 'error'; v_error := 'invalid';
    else
      v_match_id := private.sales_customer_find(p_company, v_name);
      if v_match_id is null and v_en is not null then
        v_match_id := private.sales_customer_find(p_company, v_en);
      end if;
      if v_match_id is not null then
        select * into v_m from public.sales_customers where id = v_match_id;
        v_m_kind := v_m.kind; v_m_prov := v_m.province_code;
        if v_match_id = any (v_seen_ids) then
          v_status := 'error'; v_error := 'duplicate_in_file';
        else
          v_status := 'match'; v_seen_ids := v_seen_ids || v_match_id;
        end if;
      elsif v_name_key = any (v_seen_keys) then
        v_status := 'error'; v_error := 'duplicate_in_file';
      end if;
    end if;

    if v_status in ('new', 'match') then
      -- ---- English name
      if v_en is not null then
        v_en_key := nullif(private.sales_name_key(v_en), '');
        if char_length(v_en) > 200 or v_en_key is null then
          v_dropped := v_dropped || jsonb_build_object('field', 'name_en', 'reason', 'invalid');
          v_en := null; v_en_key := null;
        elsif private.sales_customer_name_clash(p_company, v_en_key, v_match_id) is not null
              or v_en_key = any (v_seen_keys) then
          v_dropped := v_dropped || jsonb_build_object('field', 'name_en', 'reason', 'duplicate');
          v_en := null; v_en_key := null;
        end if;
      end if;

      -- ---- kind
      v_kind := null;
      v_txt := private.sales_clean(v_e->>'kind');
      if v_txt is not null then
        v_k := private.sales_word_key(v_txt);
        if v_k in ('government', 'دولتی') then v_kind := 'government';
        elsif v_k in ('contractor', 'پیمانکار') then v_kind := 'contractor';
        else v_dropped := v_dropped || jsonb_build_object('field', 'kind', 'reason', 'invalid');
        end if;
      end if;
      v_eff_kind := coalesce(v_kind, v_m_kind);

      -- ---- CEO, address
      v_ceo := private.sales_clean(v_e->>'ceo_name');
      if v_ceo is not null and char_length(v_ceo) > 120 then
        v_dropped := v_dropped || jsonb_build_object('field', 'ceo_name', 'reason', 'invalid'); v_ceo := null;
      end if;
      v_addr := private.sales_clean(v_e->>'address');
      if v_addr is not null and char_length(v_addr) > 500 then
        v_dropped := v_dropped || jsonb_build_object('field', 'address', 'reason', 'invalid'); v_addr := null;
      end if;

      -- ---- province (fixed list), then city (active list of that province)
      v_prov := null;
      v_txt := private.sales_clean(v_e->>'province');
      if v_txt is not null then
        v_k := private.sales_word_key(v_txt);
        select p.code into v_prov from public.iran_provinces p
         where v_k <> '' and (private.sales_word_key(p.code) = v_k or private.sales_word_key(p.name_fa) = v_k
                              or private.sales_word_key(p.name_en) = v_k)
         order by p.position limit 1;
        if v_prov is null then
          v_dropped := v_dropped || jsonb_build_object('field', 'province', 'reason', 'unknown');
        end if;
      end if;
      v_ctx_prov := coalesce(v_prov, v_m_prov);

      v_city := null;
      v_txt := private.sales_clean(v_e->>'city');
      if v_txt is not null then
        v_k := private.sales_word_key(v_txt);
        if v_ctx_prov is null or v_k = '' then
          v_dropped := v_dropped || jsonb_build_object('field', 'city', 'reason', 'invalid');
        else
          v_mapped := p_maps->'cities'->>(v_ctx_prov || '|' || v_k);
          if v_mapped is not null then
            v_city := private.sales_uuid(v_mapped);
          else
            select c.id into v_city from public.sales_cities c
             where c.company_id = p_company and c.province_code = v_ctx_prov and c.active
               and (private.sales_word_key(c.name_fa) = v_k or private.sales_word_key(c.name_en) = v_k)
             limit 1;
          end if;
          if v_city is null then
            v_unknown := v_unknown || jsonb_build_object('field', 'city', 'key', v_k, 'value', v_txt);
            v_mapped := v_ctx_prov || '|' || v_k;
            v_ucity := v_ucity || jsonb_build_object(v_mapped, jsonb_build_object(
              'key', v_k, 'province_code', v_ctx_prov, 'value', coalesce(v_ucity->v_mapped->>'value', v_txt),
              'rows', coalesce((v_ucity->v_mapped->>'rows')::integer, 0) + 1,
              'first', coalesce((v_ucity->v_mapped->>'first')::integer, v_o::integer)));
          elsif v_prov is null then
            v_prov := v_ctx_prov;
          end if;
        end if;
      end if;

      -- ---- rank, category (contractors only)
      v_rank := null; v_cat := null;
      v_txt := private.sales_clean(v_e->>'rank');
      if v_txt is not null then
        if v_eff_kind is distinct from 'contractor' then
          v_dropped := v_dropped || jsonb_build_object('field', 'rank', 'reason', 'not_contractor');
        else
          v_num := private.sales_num(translate(v_txt, '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'));
          if v_num is not null and v_num = trunc(v_num) and v_num between 1 and 5 then v_rank := v_num::integer;
          else v_dropped := v_dropped || jsonb_build_object('field', 'rank', 'reason', 'invalid');
          end if;
        end if;
      end if;
      v_txt := private.sales_clean(v_e->>'category');
      if v_txt is not null then
        if v_eff_kind is distinct from 'contractor' then
          v_dropped := v_dropped || jsonb_build_object('field', 'category', 'reason', 'not_contractor');
        else
          v_k := private.sales_word_key(v_txt);
          if v_k = '' then
            v_dropped := v_dropped || jsonb_build_object('field', 'category', 'reason', 'invalid');
          else
            v_mapped := p_maps->'categories'->>v_k;
            if v_mapped is not null then
              v_cat := private.sales_uuid(v_mapped);
            else
              select c.id into v_cat from public.sales_contractor_categories c
               where c.company_id = p_company and c.active
                 and (private.sales_word_key(c.name_fa) = v_k or private.sales_word_key(c.name_en) = v_k)
               limit 1;
            end if;
            if v_cat is null then
              v_unknown := v_unknown || jsonb_build_object('field', 'category', 'key', v_k, 'value', v_txt);
              v_ucat := v_ucat || jsonb_build_object(v_k, jsonb_build_object(
                'key', v_k, 'value', coalesce(v_ucat->v_k->>'value', v_txt),
                'rows', coalesce((v_ucat->v_k->>'rows')::integer, 0) + 1,
                'first', coalesce((v_ucat->v_k->>'first')::integer, v_o::integer)));
            end if;
          end if;
        end if;
      end if;

      -- ---- contact (kept with person + a valid phone; a bad email is dropped, the contact stays)
      v_pers := private.sales_clean(v_e->>'contact_person');
      v_title := private.sales_clean(v_e->>'contact_title');
      v_phone := private.sales_phone(v_e->>'phone');
      v_email := lower(private.sales_clean(v_e->>'email'));
      if v_pers is not null or v_phone is not null or v_email is not null then
        if v_pers is null or char_length(v_pers) > 120 then
          v_dropped := v_dropped || jsonb_build_object('field', 'contact', 'reason', 'invalid', 'detail', 'person');
        end if;
        if v_phone is null or v_phone !~ '^\+?[0-9]{5,15}$' then
          v_dropped := v_dropped || jsonb_build_object('field', 'contact', 'reason', 'invalid', 'detail', 'phone');
        end if;
        if not (v_pers is null or char_length(v_pers) > 120 or v_phone is null or v_phone !~ '^\+?[0-9]{5,15}$') then
          v_k := private.sales_word_key(private.sales_clean(v_e->>'contact_label'));
          v_label := case
            when v_k = '' then 'office'
            when v_k in ('office', 'دفتر') then 'office'
            when v_k in ('mobile', 'موبایل', 'همراه') then 'mobile'
            when v_k in ('fax', 'فکس', 'نمابر') then 'fax'
            when v_k in ('other', 'سایر', 'دیگر') then 'other'
            else 'other' end;
          if v_k <> '' and v_k not in ('office', 'دفتر', 'mobile', 'موبایل', 'همراه', 'fax', 'فکس', 'نمابر',
                                        'other', 'سایر', 'دیگر') then
            v_dropped := v_dropped || jsonb_build_object('field', 'contact', 'reason', 'invalid', 'detail', 'label');
          end if;
          if v_title is not null and char_length(v_title) > 80 then
            v_dropped := v_dropped || jsonb_build_object('field', 'contact', 'reason', 'invalid', 'detail', 'title');
            v_title := null;
          end if;
          if v_email is not null and (char_length(v_email) > 200 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
            v_dropped := v_dropped || jsonb_build_object('field', 'contact', 'reason', 'invalid', 'detail', 'email');
            v_email := null;
          end if;
          v_contact := jsonb_build_object('person', v_pers, 'title', v_title, 'label', v_label,
                                          'phone', v_phone, 'email', v_email);
        end if;
      end if;

      -- ---- values as the form would validate them (a match keeps its own kind for the rank / category check)
      v_vals := jsonb_strip_nulls(jsonb_build_object('name', v_name, 'name_en', v_en, 'kind', v_kind,
        'ceo_name', v_ceo, 'province_code', v_prov, 'city_id', v_city, 'address', v_addr,
        'rank', v_rank, 'category_id', v_cat));
      begin
        v_cv := private.sales_customer_values(p_company, v_vals || jsonb_build_object('kind', v_eff_kind));
      exception when others then
        v_status := 'error'; v_error := 'invalid';
      end;
    end if;

    if v_status in ('new', 'match') then
      -- The row's keys are taken now, so a later row cannot repeat them.
      if v_status = 'new' then v_seen_keys := v_seen_keys || v_name_key; end if;
      if v_en_key is not null then v_seen_keys := v_seen_keys || v_en_key; end if;
      if v_status = 'new' then
        v_incomplete := cardinality(private.sales_customer_missing_of(v_cv,
          case when v_contact is not null then 1 else 0 end)) > 0;
        v_new := v_new + 1;
      else
        -- A match is judged after the "update" action (fills only empty fields).
        v_merged := private.sales_customer_import_merge(v_m, v_cv, false);
        select count(*)::integer into v_nc from public.sales_customer_contacts where customer_id = v_match_id;
        if v_contact is not null and v_nc < 50 and not exists (
             select 1 from public.sales_customer_contacts k
              where k.customer_id = v_match_id and k.phone = v_contact->>'phone') then
          v_nc := v_nc + 1;
        end if;
        v_incomplete := cardinality(private.sales_customer_missing_of(v_merged, v_nc)) > 0;
        v_match := v_match + 1;
      end if;
    else
      v_err := v_err + 1; v_vals := '{}'::jsonb; v_contact := null;
      v_dropped := '[]'::jsonb; v_unknown := '[]'::jsonb;
    end if;

    v_out := v_out || jsonb_build_object('row', v_row, 'status', v_status, 'error', v_error,
      'match', case when v_match_id is not null then jsonb_build_object('id', v_m.id, 'name', v_m.name, 'name_en', v_m.name_en) end,
      'values', v_vals, 'contact', v_contact, 'dropped', v_dropped, 'unknown', v_unknown,
      'incomplete', v_incomplete);
  end loop;

  return jsonb_build_object('rows', v_out,
    'unknown', jsonb_build_object(
      'categories', coalesce((select jsonb_agg(j.x - 'first' order by (j.x->>'first')::integer)
                                from jsonb_each(v_ucat) as j(k, x)), '[]'::jsonb),
      'cities', coalesce((select jsonb_agg(j.x - 'first' order by (j.x->>'first')::integer)
                            from jsonb_each(v_ucity) as j(k, x)), '[]'::jsonb)),
    'counts', jsonb_build_object('new', v_new, 'match', v_match, 'error', v_err));
end $$;

-- ---------------------------------------------------------------- preview (no writes, no locks)
create function public.app_sales_customer_import_preview(p_rows jsonb) returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
declare v_company uuid := private.sales_company('sales_customers_import', 'edit');
begin
  return private.sales_customer_import_resolve(v_company, p_rows);
end $$;

-- ---------------------------------------------------------------- import
-- p: {file_name, rows, default_action: skip|update|overwrite, actions: {"<row>": action},
--     categories: {"<key>": {action: create|use|empty, id?}}, cities: {"<province>|<key>": same}}
create function public.app_sales_customer_import(p jsonb) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := private.sales_company('sales_customers_import', 'edit');
  v_default text; v_file text; v_first jsonb; v_res jsonb; v_maps jsonb;
  v_cats jsonb := '{}'::jsonb; v_cities jsonb := '{}'::jsonb;
  v_u jsonb; v_dec jsonb; v_act text; v_id uuid; v_fa text; v_en text; v_key text; v_pc text;
  v_batch uuid; v_r jsonb; v_action text; v_m public.sales_customers; v_cv public.sales_customers;
  v_merged public.sales_customers; v_vals jsonb; v_c jsonb; v_nc integer;
  v_created integer := 0; v_updated integer := 0; v_skipped integer := 0; v_dropped integer := 0;
  v_touched uuid[] := '{}'; v_changed boolean; v_contact_added boolean; v_incomplete integer;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  v_default := coalesce(nullif(p->>'default_action', ''), 'skip');
  if v_default not in ('skip', 'update', 'overwrite') then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_each(case when jsonb_typeof(p->'actions') = 'object' then p->'actions' else '{}'::jsonb end) j
              where j.value #>> '{}' is null or j.value #>> '{}' not in ('skip', 'update', 'overwrite')) then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  v_file := left(private.sales_clean(p->>'file_name'), 200);

  perform private.sales_customer_lock(v_company);
  begin
    -- 1. The lists the file needs: create or map the unknown categories / cities, then resolve again.
    v_first := private.sales_customer_import_resolve(v_company, p->'rows');
    for v_u in select x from jsonb_array_elements(v_first->'unknown'->'categories') as t(x) loop
      v_dec := case when jsonb_typeof(p->'categories'->(v_u->>'key')) = 'object' then p->'categories'->(v_u->>'key') else '{}'::jsonb end;
      v_act := v_dec->>'action'; v_id := null;
      if v_act = 'create' then
        v_fa := private.sales_clean(v_u->>'value');
        if v_fa is not null and char_length(v_fa) <= 80 then
          v_key := private.sales_name_key(v_fa);
          select id into v_id from public.sales_contractor_categories where company_id = v_company and name_key = v_key;
          if v_id is null then
            v_en := case when v_fa !~ '[؀-ۿ]' then v_fa end;
            insert into public.sales_contractor_categories (company_id, name_fa, name_key, name_en, position, created_by)
              values (v_company, v_fa, v_key, v_en,
                      (select coalesce(max(position), 0) + 1 from public.sales_contractor_categories where company_id = v_company),
                      auth.uid())
              returning id into v_id;
          end if;
        end if;
      elsif v_act = 'use' then
        v_id := private.sales_uuid(v_dec->>'id');
        if v_id is null or not exists (select 1 from public.sales_contractor_categories
                                        where id = v_id and company_id = v_company) then
          raise exception 'sales: invalid input' using errcode = '22023';
        end if;
      end if;
      if v_id is not null then v_cats := v_cats || jsonb_build_object(v_u->>'key', v_id); end if;
    end loop;
    for v_u in select x from jsonb_array_elements(v_first->'unknown'->'cities') as t(x) loop
      v_pc := v_u->>'province_code';
      v_dec := case when jsonb_typeof(p->'cities'->(v_pc || '|' || (v_u->>'key'))) = 'object'
                    then p->'cities'->(v_pc || '|' || (v_u->>'key')) else '{}'::jsonb end;
      v_act := v_dec->>'action'; v_id := null;
      if v_act = 'create' then
        v_fa := private.sales_clean(v_u->>'value');
        if v_fa is not null and char_length(v_fa) <= 80 then
          v_key := private.sales_name_key(v_fa);
          select id into v_id from public.sales_cities
           where company_id = v_company and province_code = v_pc and name_key = v_key;
          if v_id is null then
            v_en := case when v_fa !~ '[؀-ۿ]' then v_fa end;
            insert into public.sales_cities (company_id, province_code, name_fa, name_key, name_en, created_by)
              values (v_company, v_pc, v_fa, v_key, v_en, auth.uid()) returning id into v_id;
          end if;
        end if;
      elsif v_act = 'use' then
        v_id := private.sales_uuid(v_dec->>'id');
        if v_id is null or not exists (select 1 from public.sales_cities
                                        where id = v_id and company_id = v_company and province_code = v_pc) then
          raise exception 'sales: invalid input' using errcode = '22023';
        end if;
      end if;
      if v_id is not null then
        v_cities := v_cities || jsonb_build_object(v_pc || '|' || (v_u->>'key'), v_id);
      end if;
    end loop;
    v_maps := jsonb_build_object('categories', v_cats, 'cities', v_cities);
    v_res := private.sales_customer_import_resolve(v_company, p->'rows', v_maps);

    -- 2. The batch (counts filled in at the end).
    insert into public.sales_import_batches (company_id, file_name, created_by, kind)
      values (v_company, v_file, auth.uid(), 'customers') returning id into v_batch;

    -- 3. The rows.
    for v_r in select x from jsonb_array_elements(v_res->'rows') as t(x) loop
      if v_r->>'status' = 'error' then
        v_skipped := v_skipped + 1;
        continue;
      end if;
      v_c := case when jsonb_typeof(v_r->'contact') = 'object' then v_r->'contact' end;
      if v_r->>'status' = 'new' then
        v_cv := private.sales_customer_values(v_company, v_r->'values');
        insert into public.sales_customers (company_id, name, name_key, name_en, name_en_key, kind, ceo_name,
                                            province_code, city_id, address, rank, category_id, import_batch_id)
          values (v_company, v_cv.name, v_cv.name_key, v_cv.name_en, v_cv.name_en_key, v_cv.kind, v_cv.ceo_name,
                  v_cv.province_code, v_cv.city_id, v_cv.address, v_cv.rank, v_cv.category_id, v_batch)
          returning id into v_id;
        if v_c is not null then
          insert into public.sales_customer_contacts (company_id, customer_id, person, title, label, phone, email, position)
            values (v_company, v_id, v_c->>'person', v_c->>'title', v_c->>'label', v_c->>'phone', v_c->>'email', 1);
        end if;
        v_created := v_created + 1; v_touched := v_touched || v_id;
        v_dropped := v_dropped + jsonb_array_length(v_r->'dropped') + jsonb_array_length(v_r->'unknown');
      else
        v_action := coalesce(nullif(p->'actions'->>(v_r->>'row'), ''), v_default);
        if v_action = 'skip' then
          v_skipped := v_skipped + 1;
          continue;
        end if;
        v_id := (v_r->'match'->>'id')::uuid;
        select * into v_m from public.sales_customers where id = v_id and company_id = v_company for update;
        v_vals := (v_r->'values') || jsonb_build_object('kind', coalesce(v_r->'values'->>'kind', v_m.kind));
        v_cv := private.sales_customer_values(v_company, v_vals);
        v_merged := private.sales_customer_import_merge(v_m, v_cv, v_action = 'overwrite');
        -- Validate the merged row exactly like the form does.
        v_merged := private.sales_customer_values(v_company, jsonb_build_object(
          'name', v_m.name, 'name_en', v_merged.name_en, 'kind', v_merged.kind, 'ceo_name', v_merged.ceo_name,
          'province_code', v_merged.province_code, 'city_id', v_merged.city_id, 'address', v_merged.address,
          'rank', v_merged.rank, 'category_id', v_merged.category_id));
        v_changed := (v_merged.name_en, v_merged.name_en_key, v_merged.kind, v_merged.ceo_name, v_merged.province_code,
                      v_merged.city_id, v_merged.address, v_merged.rank, v_merged.category_id)
          is distinct from (v_m.name_en, v_m.name_en_key, v_m.kind, v_m.ceo_name, v_m.province_code,
                            v_m.city_id, v_m.address, v_m.rank, v_m.category_id);
        v_contact_added := false;
        if v_c is not null then
          select count(*)::integer into v_nc from public.sales_customer_contacts where customer_id = v_id;
          if v_nc < 50 and not exists (select 1 from public.sales_customer_contacts k
                                        where k.customer_id = v_id and k.phone = v_c->>'phone') then
            insert into public.sales_customer_contacts (company_id, customer_id, person, title, label, phone, email, position)
              values (v_company, v_id, v_c->>'person', v_c->>'title', v_c->>'label', v_c->>'phone', v_c->>'email',
                      (select coalesce(max(position), 0) + 1 from public.sales_customer_contacts where customer_id = v_id));
            v_contact_added := true;
          end if;
        end if;
        if v_changed then
          update public.sales_customers set name_en = v_merged.name_en, name_en_key = v_merged.name_en_key,
              kind = v_merged.kind, ceo_name = v_merged.ceo_name, province_code = v_merged.province_code,
              city_id = v_merged.city_id, address = v_merged.address, rank = v_merged.rank,
              category_id = v_merged.category_id, updated_at = now(), updated_by = auth.uid()
           where id = v_id;
        elsif v_contact_added then
          update public.sales_customers set updated_at = now(), updated_by = auth.uid() where id = v_id;
        end if;
        if v_changed or v_contact_added then
          v_updated := v_updated + 1; v_touched := v_touched || v_id;
          v_dropped := v_dropped + jsonb_array_length(v_r->'dropped') + jsonb_array_length(v_r->'unknown');
        else
          v_skipped := v_skipped + 1;
        end if;
      end if;
    end loop;

    update public.sales_import_batches set created_count = v_created, updated_count = v_updated,
        skipped_count = v_skipped where id = v_batch;
    select count(*)::integer into v_incomplete from public.sales_customers
     where id = any (v_touched) and cardinality(missing) > 0;
  exception
    when check_violation or not_null_violation or foreign_key_violation or unique_violation then
      raise exception 'sales: invalid input' using errcode = '22023';
  end;
  return jsonb_build_object('batch_id', v_batch, 'created', v_created, 'updated', v_updated,
    'skipped', v_skipped, 'incomplete', v_incomplete, 'dropped', v_dropped);
end $$;

-- ---------------------------------------------------------------- batches
create function public.app_sales_customer_batches() returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
declare v_company uuid := private.sales_company('sales_customers_import', 'edit');
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', b.id, 'file_name', b.file_name, 'created_at', b.created_at,
             'created_by_name', p.full_name, 'created_count', b.created_count, 'updated_count', b.updated_count,
             'skipped_count', b.skipped_count,
             'remaining', (select count(*) from public.sales_customers c where c.import_batch_id = b.id))
           order by b.created_at desc)
      from public.sales_import_batches b
      left join public.profiles p on p.id = b.created_by
     where b.company_id = v_company and b.kind = 'customers'), '[]'::jsonb);
end $$;

-- Remove what an import created and nothing uses now; customers touched since (updated_by set), used by
-- a record (deleted ones too) or named by an alias stay. The batch goes when none of its customers remain.
create function public.app_sales_remove_customer_batch(p_id uuid) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare v_company uuid := private.sales_company('sales_customers_import', 'edit'); v_removed integer; v_kept integer;
begin
  if not exists (select 1 from public.sales_import_batches
                  where id = p_id and company_id = v_company and kind = 'customers') then
    raise exception 'sales: not found' using errcode = 'P0002';
  end if;
  perform private.sales_customer_lock(v_company);
  with gone as (
    delete from public.sales_customers c
     where c.company_id = v_company and c.import_batch_id = p_id and c.updated_by is null
       and not exists (select 1 from public.sales_rfps r where r.buyer_id = c.id or r.client_id = c.id)
       and not exists (select 1 from public.sales_name_aliases a where a.kind = 'customer' and a.target_id = c.id)
     returning 1)
  select count(*)::integer into v_removed from gone;
  select count(*)::integer into v_kept from public.sales_customers where import_batch_id = p_id;
  if v_kept = 0 then
    delete from public.sales_import_batches where id = p_id;
  end if;
  return jsonb_build_object('removed', v_removed, 'kept', v_kept);
end $$;

-- ---------------------------------------------------------------- grants
revoke all on function private.sales_customer_import_merge(public.sales_customers, public.sales_customers, boolean) from public, anon, authenticated;
revoke all on function private.sales_customer_import_resolve(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.app_sales_customer_import_preview(jsonb) from public, anon;
grant execute on function public.app_sales_customer_import_preview(jsonb) to authenticated;
revoke all on function public.app_sales_customer_import(jsonb) from public, anon;
grant execute on function public.app_sales_customer_import(jsonb) to authenticated;
revoke all on function public.app_sales_customer_batches() from public, anon;
grant execute on function public.app_sales_customer_batches() to authenticated;
revoke all on function public.app_sales_remove_customer_batch(uuid) from public, anon;
grant execute on function public.app_sales_remove_customer_batch(uuid) to authenticated;
