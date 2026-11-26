-- FR-98 ERP › Sales customer registry: functions (spec §4.1, §5, §6, §8, §10).
-- New: customer save / profile / lists / category + city pickers; changed: the customer text
-- path (no silent create outside imports), record save by id, merge / rename / batch removal,
-- readers return the English name, Records search matches word by word.
-- Lock order everywhere: private.sales_customer_lock(company) before any sales_rfps row lock.

-- ---------------------------------------------------------------- small helpers
create function private.sales_customer_lock(p_company uuid) returns void
  language sql volatile security definer set search_path = '' as $$
  select pg_advisory_xact_lock(hashtext('sales-customers:' || p_company::text));
$$;

-- Trimmed, single-spaced text or null.
create function private.sales_clean(p text) returns text
  language sql immutable set search_path = '' as $$
  select nullif(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'), '');
$$;

-- A phone number as stored: Persian / Arabic digits → ASCII, spaces, dashes, dots and brackets dropped.
create function private.sales_phone(p text) returns text
  language sql immutable set search_path = '' as $$
  select nullif(regexp_replace(translate(btrim(coalesce(p, '')), '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'),
                               '[\s().-]', '', 'g'), '');
$$;

-- The customer a typed name means, without creating one: alias, then Farsi key, then English key.
create function private.sales_customer_find(p_company uuid, p_name text) returns uuid
  language sql stable security definer set search_path = '' as $$
  with k as (select private.sales_name_key(p_name) as key)
  select coalesce(
    (select c.id from public.sales_name_aliases a
       join public.sales_customers c on c.id = a.target_id and c.company_id = p_company, k
      where a.company_id = p_company and a.kind = 'customer' and a.alias_key = k.key),
    (select c.id from public.sales_customers c, k where c.company_id = p_company and c.name_key = k.key),
    (select c.id from public.sales_customers c, k where c.company_id = p_company and c.name_en_key = k.key))
  from k where k.key <> '';
$$;

-- Another customer already answering to this key (Farsi key, English key, or a saved alias): one namespace.
create function private.sales_customer_name_clash(p_company uuid, p_key text, p_self uuid) returns uuid
  language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select id from public.sales_customers
      where company_id = p_company and id is distinct from p_self and (name_key = p_key or name_en_key = p_key)
      limit 1),
    (select a.target_id from public.sales_name_aliases a
       join public.sales_customers c on c.id = a.target_id
      where a.company_id = p_company and a.kind = 'customer' and a.alias_key = p_key
        and a.target_id is distinct from p_self limit 1))
  where coalesce(p_key, '') <> '';
$$;

-- A customer id sent by a form: null when empty, else it must be one of the company's customers.
create function private.sales_customer_ref(p_company uuid, p text) returns uuid
  language plpgsql stable security definer set search_path = '' as $$
declare v uuid;
begin
  if p is null or btrim(p) = '' then return null; end if;
  v := private.sales_uuid(p);
  if v is null or not exists (select 1 from public.sales_customers where id = v and company_id = p_company) then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  return v;
end $$;

-- The profile fields of a payload, validated (not saved). Raises sales: invalid input on a bad value.
-- Keys: name, name_en, kind, ceo_name, province_code, city_id, address, rank, category_id.
create function private.sales_customer_values(p_company uuid, p jsonb) returns public.sales_customers
  language plpgsql stable security definer set search_path = '' as $$
declare v public.sales_customers; v_rank numeric;
begin
  v.company_id := p_company;
  v.name := private.sales_clean(p->>'name');
  v.name_key := private.sales_name_key(v.name);
  v.name_en := private.sales_clean(p->>'name_en');
  v.name_en_key := nullif(private.sales_name_key(v.name_en), '');
  v.kind := nullif(p->>'kind', '');
  v.ceo_name := private.sales_clean(p->>'ceo_name');
  v.address := private.sales_clean(p->>'address');
  v.province_code := nullif(btrim(coalesce(p->>'province_code', '')), '');
  v.city_id := private.sales_uuid(p->>'city_id');
  v_rank := private.sales_num(translate(p->>'rank', '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'));
  v.category_id := private.sales_uuid(p->>'category_id');
  if v.name is null or v.name_key = ''
     or char_length(v.name) > 200 or char_length(coalesce(v.name_en, '')) > 200
     or char_length(coalesce(v.ceo_name, '')) > 120 or char_length(coalesce(v.address, '')) > 500
     or (v.kind is not null and v.kind not in ('government', 'contractor'))
     or (nullif(p->>'city_id', '') is not null and v.city_id is null)
     or (nullif(p->>'category_id', '') is not null and v.category_id is null)
     or (nullif(p->>'rank', '') is not null and (v_rank is null or v_rank not in (1, 2, 3, 4, 5)))
     or (v.province_code is not null and not exists (select 1 from public.iran_provinces where code = v.province_code))
     or (v.city_id is not null and not exists (select 1 from public.sales_cities
           where id = v.city_id and company_id = p_company and province_code = v.province_code))
     or (v.category_id is not null and not exists (select 1 from public.sales_contractor_categories
           where id = v.category_id and company_id = p_company)) then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  v.rank := v_rank::smallint;
  if v.kind is distinct from 'contractor' then v.rank := null; v.category_id := null; end if;
  return v;
end $$;

-- A customer as the form and the customer page read it. Private fields only when p_private.
create function private.sales_customer_profile(p_id uuid, p_private boolean) returns jsonb
  language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'name', c.name, 'name_en', c.name_en, 'kind', c.kind,
      'rank', c.rank, 'category_id', c.category_id, 'category_fa', cat.name_fa, 'category_en', cat.name_en,
      'province_code', c.province_code, 'province_fa', pr.name_fa, 'province_en', pr.name_en,
      'city_id', c.city_id, 'city_fa', ci.name_fa, 'city_en', ci.name_en,
      'missing', to_jsonb(c.missing), 'created_at', c.created_at, 'updated_at', c.updated_at)
    || case when p_private then jsonb_build_object('ceo_name', c.ceo_name, 'address', c.address,
         'contacts', (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'person', k.person, 'title', k.title,
                         'label', k.label, 'phone', k.phone, 'email', k.email) order by k.position, k.id), '[]'::jsonb)
                        from public.sales_customer_contacts k where k.customer_id = c.id))
       else '{}'::jsonb end
  from public.sales_customers c
  left join public.sales_contractor_categories cat on cat.id = c.category_id
  left join public.iran_provinces pr on pr.code = c.province_code
  left join public.sales_cities ci on ci.id = c.city_id
  where c.id = p_id;
$$;

-- Replace a customer's contact book with p_contacts (array of {person,title,label,phone,email}).
create function private.sales_customer_set_contacts(p_company uuid, p_customer uuid, p_contacts jsonb) returns void
  language plpgsql security definer set search_path = '' as $$
begin
  if p_contacts is null or jsonb_typeof(p_contacts) <> 'array' or jsonb_array_length(p_contacts) > 50
     or exists (select 1 from jsonb_array_elements(p_contacts) e where jsonb_typeof(e) <> 'object') then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  delete from public.sales_customer_contacts where customer_id = p_customer;
  insert into public.sales_customer_contacts (company_id, customer_id, person, title, label, phone, email, position)
    select p_company, p_customer, private.sales_clean(e->>'person'), private.sales_clean(e->>'title'),
           coalesce(nullif(e->>'label', ''), 'office'), private.sales_phone(e->>'phone'),
           lower(private.sales_clean(e->>'email')), o::integer
      from jsonb_array_elements(p_contacts) with ordinality as t(e, o);
end $$;

-- Raise the duplicate-name error naming the other customer (id + names only, never other fields).
create function private.sales_raise_duplicate(p_other uuid) returns void
  language plpgsql stable security definer set search_path = '' as $$
begin
  raise exception 'sales: duplicate name' using errcode = '23505',
    hint = (select jsonb_build_object('id', id, 'name', name, 'name_en', name_en)::text
              from public.sales_customers where id = p_other);
end $$;

-- ---------------------------------------------------------------- customer write / read
create function public.app_sales_save_customer(p_id uuid, p jsonb) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare v_company uuid := private.sales_company('sales_customers', 'edit');
  v_old public.sales_customers; v public.sales_customers; v_clash uuid; v_id uuid := p_id;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  perform private.sales_customer_lock(v_company);
  if p_id is not null then
    select * into v_old from public.sales_customers where id = p_id and company_id = v_company for update;
    if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
  end if;
  v := private.sales_customer_values(v_company, p);
  v_clash := private.sales_customer_name_clash(v_company, v.name_key, p_id);
  if v_clash is null and v.name_en_key is not null then
    v_clash := private.sales_customer_name_clash(v_company, v.name_en_key, p_id);
  end if;
  if v_clash is not null then perform private.sales_raise_duplicate(v_clash); end if;
  begin
    if p_id is null then
      insert into public.sales_customers (company_id, name, name_key, name_en, name_en_key, kind, ceo_name,
                                          province_code, city_id, address, rank, category_id, updated_at, updated_by)
        values (v_company, v.name, v.name_key, v.name_en, v.name_en_key, v.kind, v.ceo_name,
                v.province_code, v.city_id, v.address, v.rank, v.category_id, now(), auth.uid())
        returning id into v_id;
    else
      update public.sales_customers set name = v.name, name_key = v.name_key, name_en = v.name_en,
          name_en_key = v.name_en_key, kind = v.kind, ceo_name = v.ceo_name, province_code = v.province_code,
          city_id = v.city_id, address = v.address, rank = v.rank, category_id = v.category_id,
          updated_at = now(), updated_by = auth.uid()
       where id = p_id;
      if v_old.name_key <> v.name_key then
        -- Like a rename: the old spelling keeps finding this customer.
        delete from public.sales_name_aliases
         where company_id = v_company and kind = 'customer' and alias_key = v.name_key;
        insert into public.sales_name_aliases (company_id, kind, alias_key, alias, target_id, created_by)
          values (v_company, 'customer', v_old.name_key, v_old.name, p_id, auth.uid())
          on conflict (company_id, kind, alias_key) do update
            set target_id = excluded.target_id, alias = excluded.alias, created_by = excluded.created_by;
      end if;
    end if;
    if p ? 'contacts' or p_id is null then
      perform private.sales_customer_set_contacts(v_company, v_id, coalesce(p->'contacts', '[]'::jsonb));
    end if;
  exception
    when check_violation or not_null_violation or foreign_key_violation or invalid_text_representation
         or numeric_value_out_of_range or string_data_right_truncation then
      raise exception 'sales: invalid input' using errcode = '22023';
    when unique_violation then
      raise exception 'sales: duplicate name' using errcode = '23505';
  end;
  return private.sales_customer_profile(v_id, true);
end $$;

-- Kept for the old app during the deploy swap (FR-94 shape): find or create by name.
create or replace function public.app_sales_add_customer(p jsonb) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare v_company uuid := private.sales_company('sales_customers', 'edit'); v_name text; v_kind text; v_id uuid;
  v_found public.sales_customers;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  v_name := private.sales_clean(p->>'name');
  v_kind := nullif(p->>'kind', '');
  if v_name is null or char_length(v_name) > 200 or private.sales_name_key(v_name) = ''
     or (v_kind is not null and v_kind not in ('government', 'contractor')) then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  perform private.sales_customer_lock(v_company);
  v_id := private.sales_customer_find(v_company, v_name);
  if v_id is not null then
    select * into v_found from public.sales_customers where id = v_id;
    return jsonb_build_object('id', v_found.id, 'existed', true, 'name', v_found.name, 'kind', v_found.kind);
  end if;
  insert into public.sales_customers (company_id, name, name_key, kind, updated_at, updated_by)
    values (v_company, v_name, private.sales_name_key(v_name), v_kind, now(), auth.uid())
    returning id into v_id;
  return jsonb_build_object('id', v_id, 'existed', false, 'name', v_name, 'kind', v_kind);
end $$;

-- ---------------------------------------------------------------- lists (provinces, cities, categories)
create function public.app_sales_customer_lists() returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
declare v_company uuid := private.sales_company(); v_all boolean := private.sales_can('sales_settings');
begin
  return jsonb_build_object(
    'provinces', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'name_fa', name_fa, 'name_en', name_en)
                    order by position), '[]'::jsonb) from public.iran_provinces),
    'cities', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'province_code', province_code,
                 'name_fa', name_fa, 'name_en', name_en, 'active', active) order by province_code, name_fa), '[]'::jsonb)
                 from public.sales_cities where company_id = v_company and (active or v_all)),
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name_fa', name_fa, 'name_en', name_en,
                     'active', active, 'position', position) order by position, name_fa), '[]'::jsonb)
                     from public.sales_contractor_categories where company_id = v_company and (active or v_all)));
end $$;

-- Create (p.id empty: sales_customers or sales_settings) or edit (sales_settings) a contractor category.
-- p: {id?, name_fa, name_en?, active?, position?}. Returns the row.
create function public.app_sales_save_category(p jsonb) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare v_company uuid := private.sales_company(); v_id uuid; v_fa text; v_en text; v_key text; v_other uuid;
  v_row public.sales_contractor_categories;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'sales: invalid input' using errcode = '22023'; end if;
  v_id := private.sales_uuid(p->>'id');
  if nullif(p->>'id', '') is not null and v_id is null then raise exception 'sales: invalid input' using errcode = '22023'; end if;
  if v_id is null and not (private.sales_can('sales_customers') or private.sales_can('sales_settings')) then
    raise exception 'sales: not allowed' using errcode = '42501';
  end if;
  if v_id is not null and not private.sales_can('sales_settings') then
    raise exception 'sales: not allowed' using errcode = '42501';
  end if;
  v_fa := private.sales_clean(p->>'name_fa'); v_en := private.sales_clean(p->>'name_en');
  v_key := private.sales_name_key(v_fa);
  if v_fa is null or v_key = '' then raise exception 'sales: invalid input' using errcode = '22023'; end if;
  perform private.sales_customer_lock(v_company);
  select id into v_other from public.sales_contractor_categories
   where company_id = v_company and name_key = v_key and id is distinct from v_id;
  if v_other is not null then
    raise exception 'sales: duplicate name' using errcode = '23505',
      hint = (select jsonb_build_object('id', id, 'name', name_fa, 'name_en', name_en)::text
                from public.sales_contractor_categories where id = v_other);
  end if;
  begin
    if v_id is null then
      insert into public.sales_contractor_categories (company_id, name_fa, name_key, name_en, position, created_by)
        values (v_company, v_fa, v_key, v_en,
                coalesce(private.sales_num(p->>'position')::integer,
                         (select coalesce(max(position), 0) + 1 from public.sales_contractor_categories
                           where company_id = v_company)), auth.uid())
        returning * into v_row;
    else
      update public.sales_contractor_categories set name_fa = v_fa, name_key = v_key, name_en = v_en,
          active = coalesce((p->>'active')::boolean, active),
          position = coalesce(private.sales_num(p->>'position')::integer, position)
       where id = v_id and company_id = v_company returning * into v_row;
      if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
    end if;
  exception when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range then
    raise exception 'sales: invalid input' using errcode = '22023';
  end;
  return to_jsonb(v_row) - array['company_id', 'name_key', 'created_by'];
end $$;

-- Create (sales_customers or sales_settings) or edit (sales_settings) a city.
-- p: {id?, province_code (create only), name_fa, name_en?, active?}. Returns the row.
create function public.app_sales_save_city(p jsonb) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare v_company uuid := private.sales_company(); v_id uuid; v_fa text; v_en text; v_key text; v_prov text;
  v_other uuid; v_row public.sales_cities;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'sales: invalid input' using errcode = '22023'; end if;
  v_id := private.sales_uuid(p->>'id');
  if nullif(p->>'id', '') is not null and v_id is null then raise exception 'sales: invalid input' using errcode = '22023'; end if;
  if v_id is null and not (private.sales_can('sales_customers') or private.sales_can('sales_settings')) then
    raise exception 'sales: not allowed' using errcode = '42501';
  end if;
  if v_id is not null and not private.sales_can('sales_settings') then
    raise exception 'sales: not allowed' using errcode = '42501';
  end if;
  v_fa := private.sales_clean(p->>'name_fa'); v_en := private.sales_clean(p->>'name_en');
  v_key := private.sales_name_key(v_fa);
  if v_id is null then
    v_prov := nullif(p->>'province_code', '');
  else
    select province_code into v_prov from public.sales_cities where id = v_id and company_id = v_company;
    if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
  end if;
  if v_fa is null or v_key = '' or v_prov is null
     or not exists (select 1 from public.iran_provinces where code = v_prov) then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  perform private.sales_customer_lock(v_company);
  select id into v_other from public.sales_cities
   where company_id = v_company and province_code = v_prov and name_key = v_key and id is distinct from v_id;
  if v_other is not null then
    raise exception 'sales: duplicate name' using errcode = '23505',
      hint = (select jsonb_build_object('id', id, 'name', name_fa, 'name_en', name_en)::text
                from public.sales_cities where id = v_other);
  end if;
  begin
    if v_id is null then
      insert into public.sales_cities (company_id, province_code, name_fa, name_key, name_en, created_by)
        values (v_company, v_prov, v_fa, v_key, v_en, auth.uid()) returning * into v_row;
    else
      update public.sales_cities set name_fa = v_fa, name_key = v_key, name_en = v_en,
          active = coalesce((p->>'active')::boolean, active)
       where id = v_id returning * into v_row;
    end if;
  exception when check_violation or not_null_violation or invalid_text_representation then
    raise exception 'sales: invalid input' using errcode = '22023';
  end;
  return to_jsonb(v_row) - array['company_id', 'name_key', 'created_by'];
end $$;

-- ---------------------------------------------------------------- similar names (typo check)
create or replace function public.app_sales_similar_customers(p_name text) returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
declare v_company uuid := private.sales_company(); v_key text := private.sales_name_compact(p_name);
  v_len integer := char_length(private.sales_name_compact(p_name)); v_max integer;
begin
  if v_len = 0 then return '[]'::jsonb; end if;
  v_max := case when v_len >= 10 then 2 when v_len >= 5 then 1 else 0 end;
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'name_en', x.name_en,
                      'kind', x.kind, 'distance', x.d) order by x.d, x.name)
    from (select c.id, c.name, c.name_en, c.kind,
                 least(private.sales_levenshtein(private.sales_name_compact(c.name), v_key),
                       case when c.name_en is not null
                            then private.sales_levenshtein(private.sales_name_compact(c.name_en), v_key) end) as d
            from public.sales_customers c
           where c.company_id = v_company
             and (abs(char_length(private.sales_name_compact(c.name)) - v_len) <= v_max
                  or (c.name_en is not null and abs(char_length(private.sales_name_compact(c.name_en)) - v_len) <= v_max))
           order by 5, c.name limit 200) x
    where x.d <= v_max limit 5), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- merge keeps the profile
create or replace function public.app_sales_merge_customers(p_from uuid, p_into uuid) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare v_company uuid := private.sales_company('sales_settings', 'edit');
  v_from public.sales_customers; v_into public.sales_customers; v_ids uuid[]; v_n integer; v_kind text;
begin
  if p_from is null or p_into is null or p_from = p_into then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  -- Lock order: the customer lock, customers by id, then the affected records by id.
  perform private.sales_customer_lock(v_company);
  perform 1 from public.sales_customers where company_id = v_company and id in (p_from, p_into) order by id for update;
  select * into v_from from public.sales_customers where id = p_from and company_id = v_company;
  if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
  select * into v_into from public.sales_customers where id = p_into and company_id = v_company;
  if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
  select coalesce(array_agg(id order by id), '{}') into v_ids from (
    select id from public.sales_rfps
     where company_id = v_company and (buyer_id = p_from or client_id = p_from)
     order by id for update) t;
  v_n := cardinality(v_ids);
  update public.sales_rfps set
      buyer_id = case when buyer_id = p_from then p_into else buyer_id end,
      client_id = case when client_id = p_from then p_into else client_id end,
      updated_by = auth.uid(), updated_at = now()
   where id = any (v_ids);
  insert into public.sales_events (company_id, rfp_id, actor_id, kind, body)
    select v_company, id, auth.uid(), 'edit',
           jsonb_build_object('side', 'customer_merge', 'from', v_from.name, 'into', v_into.name)
      from unnest(v_ids) as u(id);
  -- FR-98: the source's contacts move (a phone the target has is skipped; at most 50 in all).
  update public.sales_customer_contacts k set customer_id = p_into,
         position = k.position + 1000
   where k.id in (
     select x.id from public.sales_customer_contacts x
      where x.customer_id = p_from
        and not exists (select 1 from public.sales_customer_contacts y where y.customer_id = p_into and y.phone = x.phone)
      order by x.position, x.id
      limit greatest(0, 50 - (select count(*) from public.sales_customer_contacts where customer_id = p_into)));
  delete from public.sales_customers where id = p_from;
  -- Empty fields of the target are filled from the source (names stay the target's own, except an empty English name).
  v_kind := coalesce(v_into.kind, v_from.kind);
  update public.sales_customers set
      kind = v_kind,
      name_en = coalesce(v_into.name_en, v_from.name_en),
      name_en_key = coalesce(v_into.name_en_key, v_from.name_en_key),
      ceo_name = coalesce(v_into.ceo_name, v_from.ceo_name),
      address = coalesce(v_into.address, v_from.address),
      province_code = case when v_into.province_code is null then v_from.province_code else v_into.province_code end,
      city_id = case when v_into.province_code is null then v_from.city_id
                     when v_into.city_id is null and v_from.province_code = v_into.province_code then v_from.city_id
                     else v_into.city_id end,
      rank = case when v_kind = 'contractor' then coalesce(v_into.rank, v_from.rank) end,
      category_id = case when v_kind = 'contractor' then coalesce(v_into.category_id, v_from.category_id) end,
      updated_at = now(), updated_by = auth.uid()
   where id = p_into;
  -- Aliases: the source's own aliases move to the target, and its names become ones.
  update public.sales_name_aliases set target_id = p_into
   where company_id = v_company and kind = 'customer' and target_id = p_from;
  insert into public.sales_name_aliases (company_id, kind, alias_key, alias, target_id, created_by)
    values (v_company, 'customer', v_from.name_key, v_from.name, p_into, auth.uid())
    on conflict (company_id, kind, alias_key) do update
      set target_id = excluded.target_id, alias = excluded.alias, created_by = excluded.created_by;
  if v_from.name_en_key is not null and v_into.name_en_key is not null and v_from.name_en_key <> v_into.name_en_key then
    insert into public.sales_name_aliases (company_id, kind, alias_key, alias, target_id, created_by)
      values (v_company, 'customer', v_from.name_en_key, v_from.name_en, p_into, auth.uid())
      on conflict (company_id, kind, alias_key) do update
        set target_id = excluded.target_id, alias = excluded.alias, created_by = excluded.created_by;
  end if;
  delete from public.sales_name_aliases
   where company_id = v_company and kind = 'customer'
     and alias_key in (v_into.name_key, coalesce(v_into.name_en_key, v_from.name_en_key, ''));
  return jsonb_build_object('moved', v_n);
end $$;

-- ---------------------------------------------------------------- rename: one namespace
create or replace function public.app_sales_rename_customer(p_id uuid, p_name text) returns void
  language plpgsql security definer set search_path = '' as $$
declare v_company uuid := private.sales_company('sales_settings', 'edit'); v_name text; v_key text;
  v_old public.sales_customers;
begin
  v_name := left(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), 200);
  v_key := private.sales_name_key(v_name);
  if v_key = '' then raise exception 'sales: invalid input' using errcode = '22023'; end if;
  perform private.sales_customer_lock(v_company);
  select * into v_old from public.sales_customers where id = p_id and company_id = v_company for update;
  if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.sales_customers
              where company_id = v_company and id <> p_id and (name_key = v_key or name_en_key = v_key)) then
    raise exception 'sales: customer exists' using errcode = '23505';
  end if;
  update public.sales_customers set name = v_name, name_key = v_key, updated_at = now(), updated_by = auth.uid()
   where id = p_id;
  if v_old.name_key <> v_key then
    -- The new name is now the real one: an alias with its key would only redirect it elsewhere.
    delete from public.sales_name_aliases where company_id = v_company and kind = 'customer' and alias_key = v_key;
    insert into public.sales_name_aliases (company_id, kind, alias_key, alias, target_id, created_by)
      values (v_company, 'customer', v_old.name_key, v_old.name, p_id, auth.uid())
      on conflict (company_id, kind, alias_key) do update
        set target_id = excluded.target_id, alias = excluded.alias, created_by = excluded.created_by;
  end if;
end $$;

-- ---------------------------------------------------------------- the text path (imports, old app)
-- Find a customer by a typed name, or create a bare one (imports; the old app's record save).
create or replace function private.sales_customer(p_company uuid, p_name text, p_kind text default null) returns uuid
  language plpgsql security definer set search_path = '' as $$
declare v_key text := private.sales_name_key(p_name); v_id uuid;
  v_kind text := case when p_kind in ('government', 'contractor') then p_kind end;
begin
  if v_key = '' then return null; end if;
  perform private.sales_customer_lock(p_company);
  v_id := private.sales_customer_find(p_company, p_name);
  if v_id is not null then
    if v_kind is not null then
      update public.sales_customers set kind = v_kind where id = v_id and kind is null;
    end if;
    return v_id;
  end if;
  insert into public.sales_customers (company_id, name, name_key, kind)
    values (p_company, left(regexp_replace(btrim(p_name), '\s+', ' ', 'g'), 200), v_key, v_kind)
    returning id into v_id;
  return v_id;
end $$;

CREATE OR REPLACE FUNCTION public.app_sales_save_record(p_id uuid, p jsonb, p_stage uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_company uuid := private.sales_company('sales', 'edit');
  v_old public.sales_rfps; v_new public.sales_rfps;
  v_keys text[] := array['revision','customer_ref','project_site','source','title','description',
    'received_on','owner_id','in_charge_text','needs_quote','needs_bond','proposal_due','quote_due',
    'bond_due','submitted_on','delivery_method','received_by','validity_days','currency','order_date',
    'contract_start','delivery_amount','delivery_unit','delivery_text','delivery_date','prepayment',
    'prepayment_date','addendum','custom'];
  v_patch jsonb; v_created boolean := p_id is null; v_no integer; v_flow uuid; v_stage uuid;
  v_set public.sales_settings; v_changed text[]; v_flow_kind text;
  v_after public.sales_rfps; v_changes jsonb; v_side text[];
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  -- FR-98 lock order: the customer lock before the record row lock (only the text path may create).
  if p ? 'buyer' or p ? 'client' then perform private.sales_customer_lock(v_company); end if;
  if private.sales_can('sales_prices', 'edit') then
    v_keys := v_keys || array['winning_bid','winner_name','total_value'];
    -- Typed only while no item row carries a price; afterwards it is their sum.
    if p_id is null or not exists (select 1 from public.sales_item_prices ip
         join public.project_nodes n on n.id = ip.node_id where n.rfp_id = p_id) then
      v_keys := v_keys || array['our_price'];
    end if;
  end if;
  -- The reasons may be corrected later on their stage page; the decision and the
  -- result themselves change only through app_sales_decide / app_sales_result.
  if private.sales_can('sales_decide') then
    v_keys := v_keys || array['decision_reason','result_reason'];
  end if;
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_patch
    from jsonb_each(p) where key = any (v_keys);
  if v_patch ? 'custom' then
    if jsonb_typeof(v_patch->'custom') <> 'object' then
      raise exception 'sales: invalid input' using errcode = '22023';
    end if;
    -- Only the keys the caller changed; null or "" removes a key (merged below).
    v_patch := jsonb_set(v_patch, '{custom}', coalesce((
      select jsonb_object_agg(key, value) from jsonb_each(v_patch->'custom')
       where key ~ '^x_[a-z0-9_]{1,38}$'), '{}'::jsonb));
  end if;

  if v_created then
    if coalesce(btrim(p->>'title'), '') = '' then
      raise exception 'sales: title required' using errcode = '22023';
    end if;
    v_flow_kind := case when p->>'flow_kind' = 'contract' then 'contract' else 'bid' end;
    select * into v_set from public.sales_settings where company_id = v_company for update;
    if not found then
      perform private.sales_ensure(v_company);
      select * into v_set from public.sales_settings where company_id = v_company for update;
    end if;
    if char_length(btrim(p->>'title')) > 300 then
      raise exception 'sales: invalid input' using errcode = '22023';
    end if;
    v_no := coalesce(private.sales_num(p->>'record_no')::integer, greatest(v_set.next_record_no,
      (select coalesce(max(record_no), 0) + 1 from public.sales_rfps where company_id = v_company)));
    if v_no is null or v_no < 1 then raise exception 'sales: invalid input' using errcode = '22023'; end if;
    if exists (select 1 from public.sales_rfps where company_id = v_company and record_no = v_no) then
      raise exception 'sales: record number taken' using errcode = '23505';
    end if;
    select id into v_flow from public.sales_flows where company_id = v_company and kind = v_flow_kind;
    select id into v_stage from public.sales_stages
     where flow_id = v_flow and active and kind = 'open' order by position limit 1;
    if v_stage is null then raise exception 'sales: stage not available' using errcode = '22023'; end if;
    insert into public.sales_rfps (company_id, record_no, title, flow_id, stage_id, owner_id, created_by,
                                   updated_by, bid_result)
      values (v_company, v_no, btrim(p->>'title'), v_flow, v_stage, auth.uid(), auth.uid(), auth.uid(),
              case when v_flow_kind = 'contract' then 'won' end)
      returning * into v_old;
    update public.sales_settings set next_record_no = greatest(next_record_no, v_no + 1)
     where company_id = v_company;
    if v_flow_kind = 'bid' then
      insert into public.sales_documents (company_id, rfp_id, position, name)
        select v_company, v_old.id, t.ord, left(t.name, 200)
          from unnest(v_set.doc_template) with ordinality as t(name, ord) where btrim(t.name) <> '';
    end if;
  else
    v_old := private.sales_rfp(p_id, v_company);
    if (select kind from public.sales_stages where id = v_old.stage_id) <> 'open'
       and not private.sales_can('sales_decide') then
      raise exception 'sales: not allowed' using errcode = '42501';
    end if;
  end if;

  -- The stage page the edit was made on: any stage of the record's flow.
  if p_stage is not null and not exists (
       select 1 from public.sales_stages where id = p_stage and flow_id = v_old.flow_id) then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;

  -- Custom values merge per key, so a colleague's edit to another key survives.
  if v_patch ? 'custom' then
    v_patch := jsonb_set(v_patch, '{custom}', coalesce((
      select jsonb_object_agg(key, value) from jsonb_each(coalesce(v_old.custom, '{}'::jsonb) || (v_patch->'custom'))
       where jsonb_typeof(value) <> 'null' and value <> '""'::jsonb), '{}'::jsonb));
  end if;

  begin
    v_new := jsonb_populate_record(v_old, v_patch);
  exception when others then
    raise exception 'sales: invalid input' using errcode = '22023';
  end;
  if not private.sales_currency_ok(v_company, v_new.currency, v_old.currency) then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  if coalesce(btrim(v_new.title), '') = '' then
    raise exception 'sales: title required' using errcode = '22023';
  end if;
  if not private.sales_in_company(v_new.owner_id, v_company) then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  -- FR-98: the app sends customer ids; the typed-name keys are the old app's (deploy swap).
  if p ? 'buyer_id' then
    v_new.buyer_id := private.sales_customer_ref(v_company, p->>'buyer_id');
  elsif p ? 'buyer' then
    v_new.buyer_id := private.sales_customer_find(v_company, p->>'buyer');
    if v_new.buyer_id is null and private.sales_name_key(p->>'buyer') <> '' then
      if not private.sales_can('sales_customers') then
        raise exception 'sales: unknown customer' using errcode = '22023';
      end if;
      v_new.buyer_id := private.sales_customer(v_company, p->>'buyer', p->>'buyer_kind');
    end if;
  end if;
  if p ? 'client_id' then
    v_new.client_id := private.sales_customer_ref(v_company, p->>'client_id');
  elsif p ? 'client' then
    v_new.client_id := private.sales_customer_find(v_company, p->>'client');
    if v_new.client_id is null and private.sales_name_key(p->>'client') <> '' then
      if not private.sales_can('sales_customers') then
        raise exception 'sales: unknown customer' using errcode = '22023';
      end if;
      v_new.client_id := private.sales_customer(v_company, p->>'client', null);
    end if;
  end if;

  begin
    update public.sales_rfps set
      revision = v_new.revision, buyer_id = v_new.buyer_id, client_id = v_new.client_id,
      customer_ref = v_new.customer_ref, project_site = v_new.project_site, source = v_new.source,
      title = btrim(v_new.title), description = v_new.description, received_on = v_new.received_on,
      owner_id = v_new.owner_id, in_charge_text = v_new.in_charge_text,
      needs_quote = coalesce(v_new.needs_quote, false), needs_bond = coalesce(v_new.needs_bond, false),
      proposal_due = v_new.proposal_due, quote_due = v_new.quote_due, bond_due = v_new.bond_due,
      submitted_on = v_new.submitted_on, delivery_method = v_new.delivery_method,
      received_by = v_new.received_by, validity_days = v_new.validity_days, currency = v_new.currency,
      our_price = v_new.our_price, winning_bid = v_new.winning_bid, winner_name = v_new.winner_name,
      total_value = v_new.total_value, order_date = v_new.order_date,
      contract_start = v_new.contract_start, delivery_amount = v_new.delivery_amount,
      delivery_unit = v_new.delivery_unit, delivery_text = v_new.delivery_text,
      delivery_date = v_new.delivery_date, prepayment = v_new.prepayment,
      prepayment_date = v_new.prepayment_date, addendum = v_new.addendum,
      decision_reason = v_new.decision_reason, result_reason = v_new.result_reason,
      custom = coalesce(v_new.custom, '{}'::jsonb)
    where id = v_old.id;
  exception when check_violation or string_data_right_truncation or not_null_violation
              or numeric_value_out_of_range then
    raise exception 'sales: invalid input' using errcode = '22023';
  end;

  -- "Needs bond" opens the bid bond for finance (§6): one row, status needed.
  if coalesce(v_new.needs_bond, false) and not exists (
       select 1 from public.sales_bonds where rfp_id = v_old.id and kind = 'bid') then
    insert into public.sales_bonds (company_id, rfp_id, kind, seq, status, currency)
      values (v_company, v_old.id, 'bid', 1, 'needed', v_new.currency);
    v_side := array['bid_bond_opened'];
  end if;

  -- Old -> new per field, read back from the stored row. Price values never enter the
  -- log (every Sales reader sees it); customers are logged by name; custom per key.
  select * into v_after from public.sales_rfps where id = v_old.id;
  select array_agg(key order by key) into v_changed from jsonb_each(to_jsonb(v_after))
   where value is distinct from (to_jsonb(v_old)->key)
     and key not in ('updated_at','updated_by','edited_after_import');
  select coalesce(jsonb_agg(c order by c->>'field'), '[]'::jsonb) into v_changes from (
    select case
             when d.key in ('our_price','winning_bid','winner_name','total_value')
               then jsonb_build_object('field', d.key, 'hidden', true)
             when d.key in ('buyer_id','client_id')
               then jsonb_build_object('field', replace(d.key, '_id', ''),
                      'from', (select name from public.sales_customers where id = (to_jsonb(v_old)->>d.key)::uuid),
                      'to', (select name from public.sales_customers where id = (d.value #>> '{}')::uuid))
             else jsonb_build_object('field', d.key, 'from', to_jsonb(v_old)->d.key, 'to', d.value)
           end as c
      from jsonb_each(to_jsonb(v_after)) d
     where d.value is distinct from (to_jsonb(v_old)->d.key)
       and d.key not in ('updated_at','updated_by','edited_after_import','custom')
    union all
    select jsonb_build_object('field', 'custom.' || k.k, 'from', v_old.custom->k.k, 'to', v_after.custom->k.k)
      from (select jsonb_object_keys(v_old.custom) as k union select jsonb_object_keys(v_after.custom)) k
     where v_old.custom->k.k is distinct from v_after.custom->k.k
  ) x;
  if v_created then
    perform private.sales_touch(v_old.id, 'created', jsonb_build_object('record_no', v_old.record_no));
    update public.sales_rfps set edited_after_import = false where id = v_old.id;
  elsif v_changed is not null or v_side is not null then
    perform private.sales_touch(v_old.id, 'edit', jsonb_build_object(
      'stage', p_stage, 'fields', coalesce(to_jsonb(v_changed), '[]'::jsonb), 'changes', v_changes)
      || case when v_side is null then '{}'::jsonb else jsonb_build_object('side', to_jsonb(v_side)) end);
  end if;
  return v_old.id;
end $_$;

CREATE OR REPLACE FUNCTION public.app_sales_import(p_file text, p_rows jsonb, p_fields jsonb DEFAULT '[]'::jsonb, p_people jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_company uuid := private.sales_company('sales_settings', 'edit');
  v_flow uuid; v_batch uuid; v_row jsonb; v_num numeric; v_rec integer; v_created integer := 0;
  v_updated integer := 0; v_skipped integer := 0; v_deleted integer := 0; r public.sales_rfps; v_buyer uuid; v_client uuid;
  v_stage uuid; v_status text; v_owner uuid; v_name text; v_custom jsonb; v_map jsonb := '{}';
  v_header text; v_key text; v_try integer; v_b jsonb; v_id uuid; v_title text; v_form text;
  v_kind text; v_seq integer; v_bstatus text; v_reasons jsonb := '[]';
  -- Values a caller may not edit by hand are not written by their import either.
  v_prices boolean := private.sales_can('sales_prices'); v_bonds boolean := private.sales_can('sales_bonds');
begin
  perform private.sales_customer_lock(v_company);  -- FR-98 lock order
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000
     or jsonb_typeof(coalesce(p_fields, '[]')) <> 'array' or jsonb_typeof(coalesce(p_people, '{}')) <> 'object' then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  select id into v_flow from public.sales_flows where company_id = v_company and kind = 'contract';
  insert into public.sales_import_batches (company_id, file_name, created_by)
    values (v_company, nullif(left(btrim(coalesce(p_file, '')), 200), ''), auth.uid()) returning id into v_batch;

  -- Extra columns the importer asked to keep: one text field per header.
  for v_header in select btrim(h) from jsonb_array_elements_text(coalesce(p_fields, '[]')) h loop
    continue when v_header = '' or v_map ? v_header;
    select key into v_key from public.sales_field_defs
     where company_id = v_company and entity = 'rfp' and private.sales_name_key(label_en) = private.sales_name_key(v_header);
    if v_key is null then
      v_key := left(btrim(regexp_replace(lower(v_header), '[^a-z0-9]+', '_', 'g'), '_'), 30);
      if v_key = '' then v_key := substr(md5(v_header), 1, 8); end if;
      v_name := 'x_' || v_key; v_try := 0;
      while exists (select 1 from public.sales_field_defs
                     where company_id = v_company and entity = 'rfp' and key = v_name) loop
        v_try := v_try + 1; v_name := 'x_' || left(v_key, 26) || '_' || v_try;
      end loop;
      insert into public.sales_field_defs (company_id, entity, key, label_fa, label_en, type, position)
        values (v_company, 'rfp', v_name, left(v_header, 80), left(v_header, 80), 'text',
                (select coalesce(max(position), 0) + 1 from public.sales_field_defs
                  where company_id = v_company and entity = 'rfp'));
      v_key := v_name;
    end if;
    v_map := v_map || jsonb_build_object(v_header, v_key);
  end loop;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    begin
      v_num := private.sales_num(v_row->>'rec');
      if jsonb_typeof(v_row) <> 'object' or v_num is null or v_num < 1 or v_num <> trunc(v_num)
         or v_num > 2147483647 then
        v_skipped := v_skipped + 1;
        v_reasons := v_reasons || jsonb_build_object('rec', v_row->>'rec', 'reason', 'bad_rec');
        continue;
      end if;
      v_rec := v_num::integer;
      -- A deleted record is never revived or duplicated by an import: the row is skipped.
      perform 1 from public.sales_rfps
        where company_id = v_company and record_no = v_rec and deleted_at is not null for update;
      if found then
        v_skipped := v_skipped + 1; v_deleted := v_deleted + 1;
        v_reasons := v_reasons || jsonb_build_object('rec', v_rec, 'reason', 'deleted');
        continue;
      end if;
      -- A record made in the app is never overwritten by a ledger row with its number.
      if exists (select 1 from public.sales_rfps
                  where company_id = v_company and record_no = v_rec and import_batch_id is null) then
        v_skipped := v_skipped + 1;
        v_reasons := v_reasons || jsonb_build_object('rec', v_rec, 'reason', 'exists_in_app');
        continue;
      end if;
      v_buyer := private.sales_customer(v_company, v_row->>'buyer', v_row->>'kind');
      v_client := private.sales_customer(v_company, v_row->>'client', null);

      -- Status → stage: by the stage's English name, else by what the word means.
      v_status := lower(btrim(coalesce(v_row->>'status', '')));
      select id into v_stage from public.sales_stages
       where flow_id = v_flow and active and (code = v_status or lower(name_en) = v_status)
       order by (code = v_status) desc nulls last, position limit 1;
      if v_stage is null then
        select id into v_stage from public.sales_stages
         where flow_id = v_flow and active
           and kind = case when v_status like 'finish%' then 'done'
                           when v_status like 'cancel%' then 'cancelled' else 'open' end
         order by position limit 1;
      end if;
      if v_stage is null then
        select id into v_stage from public.sales_stages where flow_id = v_flow and active order by position limit 1;
      end if;

      -- In-charge person: the preview's choice, else an exact name match, else kept as text.
      v_name := nullif(regexp_replace(btrim(coalesce(v_row->>'in_charge', '')), '\s+', ' ', 'g'), '');
      v_owner := private.sales_uuid(p_people->>coalesce(v_row->>'in_charge', ''));
      if v_owner is not null and not exists (
           select 1 from public.profiles where id = v_owner and company_id = v_company) then
        v_owner := null;
      end if;
      if v_owner is null and v_name is not null then
        select p.id into v_owner from public.sales_name_aliases a
          join public.profiles p on p.id = a.target_id and p.company_id = v_company
         where a.company_id = v_company and a.kind = 'person' and a.alias_key = private.sales_name_key(v_name);
      end if;
      if v_owner is null and v_name is not null then
        select id into v_owner from public.profiles
         where company_id = v_company and private.sales_name_key(full_name) = private.sales_name_key(v_name)
         order by active desc limit 1;
      end if;

      select coalesce(jsonb_object_agg(v_map->>e.key, e.value), '{}'::jsonb) into v_custom
        from jsonb_each(case when jsonb_typeof(v_row->'custom') = 'object' then v_row->'custom' else '{}'::jsonb end) e
       where v_map ? e.key and jsonb_typeof(e.value) = 'string' and btrim(e.value #>> '{}') <> '';
      v_title := nullif(left(btrim(coalesce(v_row->>'description', '')), 300), '');

      select * into r from public.sales_rfps where company_id = v_company and record_no = v_rec for update;
      if not found then
        insert into public.sales_rfps (company_id, record_no, title, flow_id, stage_id, bid_result,
                                       import_batch_id, import_batches, created_by, updated_by)
          values (v_company, v_rec, coalesce(v_title, 'Record ' || v_rec), v_flow, v_stage, 'won',
                  v_batch, array[v_batch], auth.uid(), auth.uid())
          returning * into r;
        v_created := v_created + 1;
      else
        v_updated := v_updated + 1;
      end if;

      update public.sales_rfps set
        buyer_id = coalesce(v_buyer, buyer_id), client_id = coalesce(v_client, client_id),
        customer_ref = coalesce(nullif(left(btrim(coalesce(v_row->>'customer_ref', '')), 200), ''), customer_ref),
        project_site = coalesce(nullif(left(btrim(coalesce(v_row->>'project_site', '')), 200), ''), project_site),
        title = coalesce(v_title, title),
        description = coalesce(v_title, description),
        owner_id = coalesce(v_owner, owner_id),
        in_charge_text = coalesce(left(v_name, 200), in_charge_text),
        currency = coalesce(case when private.sales_currency_ok(v_company, nullif(v_row->>'currency', ''), currency)
                                 then nullif(v_row->>'currency', '') end, currency),
        total_value = coalesce(case when v_prices and private.sales_num(v_row->>'total_value') >= 0
                                    then round(private.sales_num(v_row->>'total_value'), 2) end, total_value),
        order_date = coalesce(private.sales_date(v_row->>'order_date'), order_date),
        contract_start = coalesce(private.sales_date(v_row->>'contract_start'), contract_start),
        delivery_amount = coalesce(case when private.sales_num(v_row->>'delivery_amount') >= 0
                                        then private.sales_num(v_row->>'delivery_amount') end, delivery_amount),
        delivery_unit = coalesce(case when v_row->>'delivery_unit' in ('day','week','month')
                                      then v_row->>'delivery_unit' end, delivery_unit),
        delivery_text = coalesce(nullif(left(btrim(coalesce(v_row->>'delivery_text', '')), 100), ''), delivery_text),
        delivery_date = coalesce(private.sales_date(v_row->>'delivery_date'), delivery_date),
        prepayment = coalesce(case v_row->>'prepayment' when 'true' then true when 'false' then false end, prepayment),
        prepayment_date = coalesce(private.sales_date(v_row->>'prepayment_date'), prepayment_date),
        addendum = coalesce(case v_row->>'addendum' when 'true' then true when 'false' then false end, addendum),
        custom = custom || v_custom,
        -- A ledger row is a contract. The stage follows the ledger until someone works on
        -- the record here.
        flow_id = v_flow,
        stage_id = case when flow_id <> v_flow or not edited_after_import then v_stage else stage_id end,
        bid_result = coalesce(bid_result, 'won'),
        import_batches = case when v_batch = any(import_batches) then import_batches
                              else array_append(import_batches, v_batch) end,
        updated_by = auth.uid(), updated_at = now()
      where id = r.id;

      -- Guarantees and payments this import wrote before are updated in place (by kind and
      -- position); what finance typed here (status, expiry, bank) is kept.
      for v_b in select * from jsonb_array_elements(
          case when v_bonds and jsonb_typeof(v_row->'bonds') = 'array' then v_row->'bonds' else '[]'::jsonb end) loop
        v_kind := v_b->>'kind'; v_seq := private.sales_num(v_b->>'seq')::integer;
        continue when v_kind is null or v_kind not in ('performance', 'advance_payment')
                   or v_seq is null or v_seq not between 1 and 20;
        v_form := case when v_b->>'form' in ('bank', 'safteh', 'cheque') then v_b->>'form' end;
        v_bstatus := case when v_b->>'status' = 'void' then 'void' when v_form is not null then 'issued' else 'needed' end;
        update public.sales_bonds set
          percent = coalesce(case when private.sales_num(v_b->>'percent') between 0 and 1
                                  then private.sales_num(v_b->>'percent') end, percent),
          form = coalesce(v_form, form),
          amount = coalesce(case when private.sales_num(v_b->>'amount') >= 0
                                 then round(private.sales_num(v_b->>'amount'), 2) end, amount),
          issued_on = coalesce(private.sales_date(v_b->>'issued_on'), issued_on),
          status = case when status = 'needed' or v_bstatus = 'void' then v_bstatus else status end,
          note = coalesce(nullif(left(btrim(coalesce(v_b->>'note', '')), 2000), ''), note)
        where rfp_id = r.id and kind = v_kind and seq = v_seq and imported;
        if not found then
          insert into public.sales_bonds (company_id, rfp_id, kind, seq, percent, form, amount, currency,
                                          issued_on, status, note, imported)
          values (v_company, r.id, v_kind, v_seq,
                  case when private.sales_num(v_b->>'percent') between 0 and 1 then private.sales_num(v_b->>'percent') end,
                  v_form,
                  case when private.sales_num(v_b->>'amount') >= 0 then round(private.sales_num(v_b->>'amount'), 2) end,
                  case when private.sales_currency_ok(v_company, nullif(v_row->>'currency', ''),
                         (select x.currency from public.sales_rfps x where x.id = r.id))
                       then nullif(v_row->>'currency', '') end,
                  private.sales_date(v_b->>'issued_on'), v_bstatus,
                  nullif(left(btrim(coalesce(v_b->>'note', '')), 2000), ''), true);
        end if;
      end loop;
      for v_b in select * from jsonb_array_elements(
          case when v_bonds and jsonb_typeof(v_row->'payments') = 'array' then v_row->'payments' else '[]'::jsonb end) loop
        v_seq := private.sales_num(v_b->>'seq')::integer;
        continue when v_seq is null or v_seq not between 1 and 50;
        update public.sales_payments set
          amount = coalesce(case when private.sales_num(v_b->>'amount') >= 0
                                 then round(private.sales_num(v_b->>'amount'), 2) end, amount),
          paid_on = coalesce(private.sales_date(v_b->>'paid_on'), paid_on)
        where rfp_id = r.id and seq = v_seq and imported;
        if not found then
          insert into public.sales_payments (company_id, rfp_id, seq, amount, paid_on, imported)
          values (v_company, r.id, v_seq,
                  case when private.sales_num(v_b->>'amount') >= 0 then round(private.sales_num(v_b->>'amount'), 2) end,
                  private.sales_date(v_b->>'paid_on'), true);
        end if;
      end loop;

      insert into public.sales_events (company_id, rfp_id, actor_id, kind, body)
        values (v_company, r.id, auth.uid(), 'import', jsonb_build_object('batch', v_batch));
      perform private.sales_sync_deadlines(r.id, true);
    exception when others then
      -- One unreadable row must not lose the rest of the file.
      v_skipped := v_skipped + 1;
      v_reasons := v_reasons || jsonb_build_object('rec', v_row->>'rec', 'reason', 'unreadable');
    end;
  end loop;

  update public.sales_import_batches
     set created_count = v_created, updated_count = v_updated, skipped_count = v_skipped where id = v_batch;
  update public.sales_settings set next_record_no = greatest(next_record_no,
      (select coalesce(max(record_no), 0) + 1 from public.sales_rfps where company_id = v_company))
   where company_id = v_company;
  return jsonb_build_object('batch_id', v_batch, 'created', v_created, 'updated', v_updated,
    'skipped', v_skipped, 'skipped_rows', v_reasons, 'deleted', v_deleted);
end $$;

CREATE OR REPLACE FUNCTION public.app_sales_import_inquiries(p_batch uuid, p_file text, p_rows jsonb, p_people jsonb DEFAULT '{}'::jsonb, p_cutoff date DEFAULT NULL::date, p_last boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_company uuid := private.sales_company('sales_settings', 'edit');
  v_prices boolean := private.sales_can('sales_prices');
  v_cutoff date := coalesce(p_cutoff, (private.sales_today() - interval '6 months')::date);
  v_batch uuid; b public.sales_import_batches; v_bid uuid; v_contract uuid;
  v_row jsonb; v_num numeric; v_rec integer; r public.sales_rfps; v_existed boolean;
  v_created integer := 0; v_updated integer := 0; v_skipped integer := 0; v_deleted integer := 0; v_reasons jsonb := '[]';
  v_by jsonb := '{"won":0,"lost":0,"no_bid":0,"cancelled":0,"open":0,"archived":0}';
  v_origin text; v_fill boolean; v_edited boolean; v_classify boolean;
  v_phrase text; v_wp numeric; v_lp numeric; v_recv date; v_sub date; v_class text;
  v_tflow uuid; v_tkind text; v_tcode text; v_stage uuid; v_result text; v_decision text;
  v_buyer uuid; v_owner uuid; v_name text; v_title text; v_desc text; v_ref text; v_price numeric;
  v_cur text; v_custom jsonb; v_type text; v_new_stage uuid; v_new_kind text;
begin
  perform private.sales_customer_lock(v_company);  -- FR-98 lock order
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000
     or jsonb_typeof(coalesce(p_people, '{}')) <> 'object' then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  if p_batch is null then
    insert into public.sales_import_batches (company_id, file_name, created_by, kind, closed)
      values (v_company, nullif(left(btrim(coalesce(p_file, '')), 200), ''), auth.uid(), 'inquiry', false)
      returning id into v_batch;
  else
    select * into b from public.sales_import_batches where id = p_batch and company_id = v_company;
    if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
    if b.kind <> 'inquiry' or b.closed then
      raise exception 'sales: batch closed' using errcode = '22023';
    end if;
    v_batch := p_batch;
  end if;
  select id into v_bid from public.sales_flows where company_id = v_company and kind = 'bid';
  select id into v_contract from public.sales_flows where company_id = v_company and kind = 'contract';
  perform private.sales_inquiry_fields(v_company);

  for v_row in select * from jsonb_array_elements(p_rows) loop
    begin
      v_num := case when jsonb_typeof(v_row) = 'object' then private.sales_num(v_row->>'rec') end;
      if v_num is null or v_num < 1 or v_num <> trunc(v_num) or v_num > 2147483647 then
        v_skipped := v_skipped + 1;
        v_reasons := v_reasons || jsonb_build_object('rec', v_row->>'rec', 'reason', 'bad_rec');
        continue;
      end if;
      v_rec := v_num::integer;

      -- The record row is locked first.
      select * into r from public.sales_rfps where company_id = v_company and record_no = v_rec for update;
      v_existed := found; v_fill := false; v_edited := false;
      if v_existed then
        -- A deleted record is never revived or duplicated by an import: the row is skipped.
        if r.deleted_at is not null then
          v_skipped := v_skipped + 1; v_deleted := v_deleted + 1;
          v_reasons := v_reasons || jsonb_build_object('rec', v_rec, 'reason', 'deleted');
          continue;
        end if;
        if v_batch = any (r.import_batches) then
          -- Same number twice in one file: the first row won.
          v_skipped := v_skipped + 1;
          v_reasons := v_reasons || jsonb_build_object('rec', v_rec, 'reason', 'duplicate');
          continue;
        end if;
        if r.import_batch_id is null and cardinality(r.import_batches) = 0 then
          v_skipped := v_skipped + 1;
          v_reasons := v_reasons || jsonb_build_object('rec', v_rec, 'reason', 'exists_in_app');
          continue;
        end if;
        select kind into v_origin from public.sales_import_batches where id = r.import_batch_id;
        -- Contract-flow records and ledger-made records only get their empty fields filled.
        v_fill := coalesce(v_origin, 'ledger') = 'ledger'
                  or (select kind from public.sales_flows where id = r.flow_id) = 'contract';
        v_edited := r.edited_after_import;
      end if;
      v_classify := not v_fill and not v_edited;

      v_buyer := private.sales_customer(v_company, v_row->>'buyer', null);
      v_recv := private.sales_date(v_row->>'received_on');
      v_sub := private.sales_date(v_row->>'submitted_on');
      v_desc := nullif(left(btrim(coalesce(v_row->>'description', '')), 4000), '');
      v_title := nullif(left(regexp_replace(btrim(coalesce(v_row->>'description', '')), '\s+', ' ', 'g'), 300), '');
      v_ref := nullif(left(btrim(coalesce(v_row->>'customer_ref', '')), 200), '');
      v_wp := private.sales_num(v_row->>'won_price'); v_lp := private.sales_num(v_row->>'lost_price');
      v_price := case when not v_prices then null
                      when coalesce(v_wp, 0) > 0 and v_wp < 1e16 then round(v_wp, 2)
                      when coalesce(v_lp, 0) > 0 and v_lp < 1e16 then round(v_lp, 2) end;
      v_cur := case when v_prices and v_row->>'currency' in ('IRR', 'EUR') then v_row->>'currency' end;
      v_phrase := case when v_row->>'phrase' in ('won', 'lost', 'no_bid', 'cancelled') then v_row->>'phrase' end;

      -- In-charge person: the preview's choice, else an exact name match, else kept as text.
      v_name := nullif(regexp_replace(btrim(coalesce(v_row->>'in_charge', '')), '\s+', ' ', 'g'), '');
      v_owner := private.sales_uuid(p_people->>coalesce(v_row->>'in_charge', ''));
      if v_owner is not null and not exists (
           select 1 from public.profiles where id = v_owner and company_id = v_company) then
        v_owner := null;
      end if;
      if v_owner is null and v_name is not null then
        select p.id into v_owner from public.sales_name_aliases a
          join public.profiles p on p.id = a.target_id and p.company_id = v_company
         where a.company_id = v_company and a.kind = 'person' and a.alias_key = private.sales_name_key(v_name);
      end if;
      if v_owner is null and v_name is not null then
        select id into v_owner from public.profiles
         where company_id = v_company and private.sales_name_key(full_name) = private.sales_name_key(v_name)
         order by active desc limit 1;
      end if;

      v_type := nullif(left(btrim(coalesce(v_row->>'inquiry_type', '')), 200), '');
      v_type := case lower(coalesce(v_type, '')) when 'tender' then 'Tender' when 'project' then 'Project'
                  when 'estelam' then 'Estelam' when 'budget price' then 'Budget price' else v_type end;
      v_custom := jsonb_strip_nulls(jsonb_build_object(
        'x_inq_no', nullif(left(btrim(coalesce(v_row->>'inquiry_no', '')), 200), ''),
        'x_inq_type', v_type,
        'x_inq_status_note', nullif(left(btrim(coalesce(v_row->>'status_note', '')), 2000), ''),
        'x_inq_flag', case when v_row->>'in_charge_flag' in ('Y', 'N') then v_row->>'in_charge_flag' end,
        'x_inq_date_text', case when v_recv is null
                                then nullif(left(btrim(coalesce(v_row->>'received_text', '')), 200), '') end,
        'x_inq_offer_text', case when v_sub is null
                                 then nullif(left(btrim(coalesce(v_row->>'offer_text', '')), 200), '') end));

      -- Result and stage (16.2), first rule that matches.
      if v_classify then
        if v_phrase = 'won' or coalesce(v_wp, 0) > 0 then
          v_class := 'won'; v_tflow := v_contract;
          if v_recv >= v_cutoff then v_tkind := 'open'; v_tcode := 'new'; else v_tkind := 'done'; v_tcode := 'finish'; end if;
          v_result := 'won'; v_decision := 'bid';
        elsif v_phrase = 'lost' or coalesce(v_lp, 0) > 0 then
          v_class := 'lost'; v_tflow := v_bid; v_tkind := 'lost'; v_tcode := 'lost';
          v_result := 'lost'; v_decision := 'bid';
        elsif v_phrase = 'no_bid' then
          v_class := 'no_bid'; v_tflow := v_bid; v_tkind := 'no_bid'; v_tcode := 'no_bid';
          v_result := null; v_decision := 'no_bid';
        elsif v_phrase = 'cancelled' then
          v_class := 'cancelled'; v_tflow := v_bid; v_tkind := 'cancelled'; v_tcode := 'cancelled';
          v_result := 'cancelled'; v_decision := 'pending';
        elsif v_recv >= v_cutoff then
          v_class := 'open'; v_tflow := v_bid; v_tkind := 'open'; v_tcode := null;
          v_result := null; v_decision := 'pending';
        else
          v_class := 'archived'; v_tflow := v_bid; v_tkind := 'archived'; v_tcode := 'archived';
          v_result := null; v_decision := 'pending';
        end if;
        select id into v_stage from public.sales_stages
         where flow_id = v_tflow and active and kind = v_tkind
         order by (code = v_tcode) desc nulls last, position limit 1;
        if v_stage is null then
          raise exception 'sales: stage not available' using errcode = '22023';
        end if;
      end if;

      if not v_existed then
        insert into public.sales_rfps (company_id, record_no, title, flow_id, stage_id, import_batch_id,
                                       import_batches, created_by, updated_by)
          values (v_company, v_rec, coalesce(v_title, 'Record ' || v_rec), v_tflow, v_stage, v_batch,
                  array[v_batch], auth.uid(), auth.uid())
          returning * into r;
      end if;

      if v_fill then
        update public.sales_rfps set
          buyer_id = coalesce(buyer_id, v_buyer), received_on = coalesce(received_on, v_recv),
          customer_ref = coalesce(customer_ref, v_ref), description = coalesce(description, v_desc),
          submitted_on = coalesce(submitted_on, v_sub), owner_id = coalesce(owner_id, v_owner),
          in_charge_text = coalesce(in_charge_text, left(v_name, 200)),
          currency = coalesce(currency, v_cur), our_price = coalesce(our_price, v_price),
          custom = v_custom || custom,
          import_batches = array_append(import_batches, v_batch),
          updated_by = auth.uid(), updated_at = now()
        where id = r.id;
      else
        update public.sales_rfps set
          buyer_id = coalesce(v_buyer, buyer_id), received_on = coalesce(v_recv, received_on),
          customer_ref = coalesce(v_ref, customer_ref), title = coalesce(v_title, title),
          description = coalesce(v_desc, description), submitted_on = coalesce(v_sub, submitted_on),
          owner_id = coalesce(v_owner, owner_id),
          in_charge_text = coalesce(left(v_name, 200), in_charge_text),
          currency = coalesce(v_cur, currency), our_price = coalesce(v_price, our_price),
          custom = custom || v_custom,
          -- Result and stage follow the file until someone works on the record here.
          flow_id = case when v_classify then v_tflow else flow_id end,
          stage_id = case when v_classify then v_stage else stage_id end,
          bid_result = case when v_classify then v_result else bid_result end,
          bid_decision = case when v_classify then v_decision else bid_decision end,
          -- An imported result is dated by the file (offer, else arrival), never by the import run.
          result_at = case when not v_classify then result_at
                           when v_result is null then null
                           else coalesce(v_sub, v_recv, r.submitted_on, r.received_on)::timestamptz end,
          import_batches = case when v_batch = any (import_batches) then import_batches
                                else array_append(import_batches, v_batch) end,
          updated_by = auth.uid(), updated_at = now()
        where id = r.id;
      end if;

      insert into public.sales_events (company_id, rfp_id, actor_id, kind, body)
        values (v_company, r.id, auth.uid(), 'import', jsonb_build_object('batch', v_batch, 'source', 'inquiry'));
      -- Deadlines only for open records; archived and closed ones create none.
      select s.id, s.kind into v_new_stage, v_new_kind
        from public.sales_rfps x join public.sales_stages s on s.id = x.stage_id where x.id = r.id;
      if v_new_kind = 'open' or (v_existed and v_new_stage <> r.stage_id) then
        perform private.sales_sync_deadlines(r.id, true);
      end if;

      if v_existed then v_updated := v_updated + 1; else v_created := v_created + 1; end if;
      if v_classify then
        v_by := jsonb_set(v_by, array[v_class], to_jsonb((v_by->>v_class)::integer + 1));
      end if;
    exception when others then
      -- One unreadable row must not lose the rest of the file.
      v_skipped := v_skipped + 1;
      v_reasons := v_reasons || jsonb_build_object('rec', v_row->>'rec', 'reason', 'unreadable');
    end;
  end loop;

  update public.sales_import_batches set
    created_count = created_count + v_created, updated_count = updated_count + v_updated,
    skipped_count = skipped_count + v_skipped, closed = closed or coalesce(p_last, false)
   where id = v_batch;
  update public.sales_settings set next_record_no = greatest(next_record_no,
      (select coalesce(max(record_no), 0) + 1 from public.sales_rfps where company_id = v_company))
   where company_id = v_company;
  return jsonb_build_object('batch_id', v_batch, 'created', v_created, 'updated', v_updated,
    'skipped', v_skipped, 'skipped_rows', v_reasons, 'by_result', v_by, 'deleted', v_deleted);
end $$;

CREATE OR REPLACE FUNCTION public.app_sales_remove_batch(p_batch uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_company uuid := private.sales_company('sales_settings', 'edit'); v_deleted integer; v_kept integer;
  v_created timestamptz;
begin
  select created_at into v_created from public.sales_import_batches
   where id = p_batch and company_id = v_company and kind <> 'customers';
  if not found then
    raise exception 'sales: not found' using errcode = 'P0002';
  end if;
  perform private.sales_customer_lock(v_company);
  with gone as (
    delete from public.sales_rfps
     where company_id = v_company and import_batches = array[p_batch] and not edited_after_import returning 1)
  select count(*) into v_deleted from gone;
  -- Written by other batches too: this one steps out; the "first" batch moves to the last that remains.
  with stepped as (
    update public.sales_rfps set
      import_batches = array_remove(import_batches, p_batch),
      import_batch_id = case when import_batch_id = p_batch
        then (array_remove(import_batches, p_batch))[cardinality(array_remove(import_batches, p_batch))]
        else import_batch_id end
     where company_id = v_company and p_batch = any (import_batches) and cardinality(import_batches) > 1
     returning 1)
  select count(*) into v_kept from stepped;
  -- Edited rows that only this batch wrote stay on it, so the batch stays listed.
  select v_kept + count(*) into v_kept from public.sales_rfps
   where company_id = v_company and p_batch = any (import_batches);
  -- Customers the import made and nothing uses now (not ones added by hand since).
  delete from public.sales_customers c
   where c.company_id = v_company and c.created_at >= v_created
     -- FR-98: never a registered customer (hand-made, edited, or from a customer import).
     and c.import_batch_id is null and c.updated_by is null and c.ceo_name is null
     and not exists (select 1 from public.sales_customer_contacts k where k.customer_id = c.id)
     and not exists (select 1 from public.sales_rfps r where r.buyer_id = c.id or r.client_id = c.id)
     and not exists (select 1 from public.sales_name_aliases a where a.kind = 'customer' and a.target_id = c.id);
  if not exists (select 1 from public.sales_rfps where company_id = v_company
                  and (p_batch = any (import_batches) or import_batch_id = p_batch)) then
    delete from public.sales_import_batches where id = p_batch;
  end if;
  return jsonb_build_object('deleted', v_deleted, 'kept', v_kept);
end $$;

CREATE OR REPLACE FUNCTION private.sales_ensure(p_company uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare v_bid uuid; v_contract uuid; v_pos integer;
begin
  insert into public.sales_settings (company_id, doc_template)
    values (p_company, array['Technical offer','Financial offer','Catalogs','Drawings','Certificates'])
    on conflict do nothing;

  insert into public.sales_flows (company_id, kind, name_fa, name_en)
    values (p_company, 'bid', 'استعلام و پیشنهاد', 'RFP'), (p_company, 'contract', 'قرارداد', 'Contract')
    on conflict do nothing;
  select id into v_bid from public.sales_flows where company_id = p_company and kind = 'bid';
  select id into v_contract from public.sales_flows where company_id = p_company and kind = 'contract';

  if not exists (select 1 from public.sales_stages where flow_id = v_bid) then
    insert into public.sales_stages (company_id, flow_id, position, name_fa, name_en, kind, action, code) values
      (p_company, v_bid, 1, 'دریافت‌شده', 'Received', 'open', null, 'received'),
      (p_company, v_bid, 2, 'تصمیم شرکت در مناقصه', 'Bid decision', 'open', 'decide', 'decision'),
      (p_company, v_bid, 3, 'پیشنهاد فنی', 'Technical proposal', 'open', null, 'technical'),
      (p_company, v_bid, 4, 'قیمت‌گذاری', 'Pricing', 'open', 'quote', 'pricing'),
      (p_company, v_bid, 5, 'آماده ارسال', 'Ready to send', 'open', null, 'ready'),
      (p_company, v_bid, 6, 'ارسال‌شده', 'Submitted', 'open', 'submit', 'submitted'),
      (p_company, v_bid, 7, 'بازنده', 'Lost', 'lost', null, 'lost'),
      (p_company, v_bid, 8, 'عدم شرکت', 'No bid', 'no_bid', null, 'no_bid'),
      (p_company, v_bid, 9, 'بایگانی (بدون نتیجه)', 'Archived (no result)', 'archived', null, 'archived'),
      (p_company, v_bid, 10, 'لغوشده', 'Cancelled', 'cancelled', null, 'cancelled');
  end if;
  -- Companies seeded before FR-94 section 16 get the Archived stage right after No bid.
  if not exists (select 1 from public.sales_stages where flow_id = v_bid and (code = 'archived' or kind = 'archived')) then
    select position + 1 into v_pos from public.sales_stages where flow_id = v_bid and code = 'no_bid';
    v_pos := coalesce(v_pos, (select coalesce(max(position), 0) + 1 from public.sales_stages where flow_id = v_bid));
    update public.sales_stages set position = position + 1 where flow_id = v_bid and position >= v_pos;
    insert into public.sales_stages (company_id, flow_id, position, name_fa, name_en, kind, action, code)
      values (p_company, v_bid, v_pos, 'بایگانی (بدون نتیجه)', 'Archived (no result)', 'archived', null, 'archived');
  end if;
  if not exists (select 1 from public.sales_stages where flow_id = v_contract) then
    insert into public.sales_stages (company_id, flow_id, position, name_fa, name_en, kind, code) values
      (p_company, v_contract, 1, 'جدید', 'New', 'open', 'new'),
      (p_company, v_contract, 2, 'جاری', 'Current', 'open', 'current'),
      (p_company, v_contract, 3, 'متوقف', 'Hold', 'open', 'hold'),
      (p_company, v_contract, 4, 'پایان‌یافته', 'Finish', 'done', 'finish'),
      (p_company, v_contract, 5, 'لغوشده', 'Cancel', 'cancelled', 'cancel');
  end if;
  -- The contract flow also gets an Archived stage (admin archive, 2026-11-23): last, closed.
  if not exists (select 1 from public.sales_stages where flow_id = v_contract and (code = 'archived' or kind = 'archived')) then
    insert into public.sales_stages (company_id, flow_id, position, name_fa, name_en, kind, action, code)
      select p_company, v_contract, coalesce(max(position), 0) + 1, 'بایگانی', 'Archived', 'archived', null, 'archived'
        from public.sales_stages where flow_id = v_contract;
  end if;
  -- The company's currency list (FR-94 CEO feedback): today's five, managed in Settings afterwards.
  insert into public.sales_currencies (company_id, code, name_fa, name_en, symbol, decimals, position) values
    (p_company, 'IRR', 'ریال', 'Rial', null, 0, 1),
    (p_company, 'EUR', 'یورو', 'Euro', '€', 2, 2),
    (p_company, 'USD', 'دلار', 'US dollar', '$', 2, 3),
    (p_company, 'AED', 'درهم', 'UAE dirham', null, 2, 4),
    (p_company, 'CNY', 'یوان', 'Chinese yuan', null, 2, 5)
    on conflict do nothing;
  -- FR-98: contractor categories + county-seat cities, only while the company has neither.
  if not exists (select 1 from public.sales_contractor_categories where company_id = p_company)
     and not exists (select 1 from public.sales_cities where company_id = p_company) then
    perform private.sales_seed_customer_lists(p_company);
  end if;
end $_$;

CREATE OR REPLACE FUNCTION private.sales_filter_check(p jsonb) RETURNS void
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $_$
declare v text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  foreach v in array array['from', 'to'] loop
    if nullif(p->>v, '') is not null then
      if jsonb_typeof(p->v) <> 'string' or p->>v !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'sales: invalid input' using errcode = '22023';
      end if;
      perform (p->>v)::date;
    end if;
  end loop;
  if nullif(p->>'result', '') is not null
     and p->>'result' not in ('won', 'lost', 'no_bid', 'cancelled', 'open', 'archived') then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  if nullif(p->>'owner', '') is not null
     and p->>'owner' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  if nullif(p->>'kind', '') is not null and p->>'kind' not in ('government', 'contractor') then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  if nullif(p->>'incomplete', '') is not null and p->>'incomplete' not in ('1', 'true') then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
exception when invalid_datetime_format or datetime_field_overflow then
  raise exception 'sales: invalid input' using errcode = '22023';
end $_$;

CREATE OR REPLACE FUNCTION private.sales_customer_rows(p_company uuid, p_prices boolean, p_id uuid DEFAULT NULL::uuid, p_f jsonb DEFAULT '{}'::jsonb) RETURNS SETOF jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  with rf as (
    select r.id, r.buyer_id, r.client_id, r.received_on, r.bid_result, r.bid_decision, r.in_charge_text,
           r.owner_id, r.currency, r.our_price, r.total_value, s.kind as skind, f.kind as fkind,
           (r.bid_result = 'won' or (f.kind = 'contract' and s.kind <> 'cancelled')) as is_won
      from public.sales_rfps r
      join public.sales_stages s on s.id = r.stage_id
      join public.sales_flows f on f.id = r.flow_id
     where r.company_id = p_company and r.deleted_at is null
       and (r.buyer_id is not null or r.client_id is not null)
       and (p_id is null or r.buyer_id = p_id or r.client_id = p_id)
       and private.sales_rec_ok(p_f, r.received_on, r.bid_result, r.bid_decision, s.kind, r.owner_id)),
  agg as (
    select buyer_id,
           count(*) as records,
           count(*) filter (where skind = 'open') as open,
           count(*) filter (where bid_result = 'won') as won,
           count(*) filter (where bid_result = 'lost') as lost,
           count(*) filter (where bid_decision = 'no_bid') as no_bid,
           count(*) filter (where skind = 'archived') as archived,
           count(*) filter (where skind = 'cancelled') as cancelled,
           min(received_on) as first_inquiry, max(received_on) as last_inquiry
      from rf where buyer_id is not null group by buyer_id),
  cli as (select client_id, count(*) as n from rf where client_id is not null group by client_id),
  dl as (
    select rf.buyer_id, min(d.due_on) as next_deadline
      from rf join public.sales_deadlines d on d.rfp_id = rf.id
     where rf.buyer_id is not null and rf.skind = 'open' and d.done_at is null
     group by rf.buyer_id),
  own as (
    select distinct on (buyer_id) buyer_id, nm
      from (select rf.buyer_id, coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(rf.in_charge_text), '')) as nm, count(*) as n
              from rf left join public.profiles p on p.id = rf.owner_id
             where rf.buyer_id is not null group by 1, 2) t
     where nm is not null
     order by buyer_id, n desc, nm),
  cv as (
    select buyer_id, jsonb_object_agg(currency, amt) as j
      from (select buyer_id, currency, sum(total_value) as amt from rf
             where fkind = 'contract' and total_value is not null and currency is not null and buyer_id is not null
             group by buyer_id, currency) t group by buyer_id),
  qv as (
    select buyer_id, jsonb_object_agg(currency, amt) as j
      from (select buyer_id, currency, sum(our_price) as amt from rf
             where our_price is not null and currency is not null and buyer_id is not null
             group by buyer_id, currency) t group by buyer_id),
  sv as (
    select buyer_id, jsonb_object_agg(currency, amt) as j
      from (select buyer_id, currency, sum(coalesce(total_value, our_price)) as amt from rf
             where is_won and coalesce(total_value, our_price) is not null and currency is not null
               and buyer_id is not null
             group by buyer_id, currency) t group by buyer_id)
  select jsonb_build_object(
      'id', c.id, 'name', c.name, 'name_en', c.name_en, 'kind', c.kind, 'missing', to_jsonb(c.missing),
      'records', coalesce(a.records, 0), 'as_client', coalesce(cli.n, 0),
      'open', coalesce(a.open, 0), 'won', coalesce(a.won, 0), 'lost', coalesce(a.lost, 0),
      'no_bid', coalesce(a.no_bid, 0), 'archived', coalesce(a.archived, 0), 'cancelled', coalesce(a.cancelled, 0),
      'decided', coalesce(a.won, 0) + coalesce(a.lost, 0),
      'win_rate', case when coalesce(a.won, 0) + coalesce(a.lost, 0) > 0
                       then round(a.won::numeric / (a.won + a.lost), 4) end,
      'first_inquiry', a.first_inquiry, 'last_inquiry', a.last_inquiry,
      'next_deadline', dl.next_deadline, 'main_owner_name', own.nm)
    || case when p_prices then jsonb_build_object(
         'contract_value', coalesce(cv.j, '{}'::jsonb), 'quoted', coalesce(qv.j, '{}'::jsonb),
         'sales', coalesce(sv.j, '{}'::jsonb))
       else '{}'::jsonb end
  from public.sales_customers c
  left join agg a on a.buyer_id = c.id
  left join cli on cli.client_id = c.id
  left join dl on dl.buyer_id = c.id
  left join own on own.buyer_id = c.id
  left join cv on cv.buyer_id = c.id
  left join qv on qv.buyer_id = c.id
  left join sv on sv.buyer_id = c.id
  where c.company_id = p_company and (p_id is null or c.id = p_id)
    and (nullif(p_f->>'kind', '') is null or c.kind = p_f->>'kind')
    and (nullif(p_f->>'incomplete', '') is null or cardinality(c.missing) > 0)
    and (not private.sales_filtered(p_f) or coalesce(a.records, 0) > 0)
  order by c.name;
$$;

CREATE OR REPLACE FUNCTION public.app_sales_customer(p_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_company uuid := private.sales_company('sales', 'read'); v_row jsonb;
begin
  select x into v_row from private.sales_customer_rows(v_company, private.sales_can('sales_prices', 'read'), p_id) x;
  if v_row is null then raise exception 'sales: not found' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'customer', v_row,
    'profile', private.sales_customer_profile(p_id, private.sales_can('sales_customers')),
    'per_year', (select coalesce(jsonb_agg(jsonb_build_object('year', y, 'total', total, 'won', won, 'lost', lost)
                                           order by y desc), '[]'::jsonb)
                   from (select extract(year from received_on)::integer as y, count(*) as total,
                                count(*) filter (where bid_result = 'won') as won,
                                count(*) filter (where bid_result = 'lost') as lost
                           from public.sales_rfps
                          where company_id = v_company and deleted_at is null and buyer_id = p_id and received_on is not null
                          group by 1 order by 1 desc limit 12) t),
    'client_of', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'name_en', name_en, 'count', n)
                                            order by n desc, name), '[]'::jsonb)
                    from (select b.id, b.name, b.name_en, count(*) as n
                            from public.sales_rfps r join public.sales_customers b on b.id = r.buyer_id
                           where r.company_id = v_company and r.deleted_at is null and r.client_id = p_id
                           group by b.id, b.name, b.name_en) t),
    'top_words', (select coalesce(jsonb_agg(jsonb_build_object('word', word, 'count', n) order by n desc, word), '[]'::jsonb)
                    from (select w.word, count(*) as n
                            from public.sales_rfps r,
                                 lateral regexp_split_to_table(lower(r.title), '[^[:alnum:]]+') as w(word)
                           where r.company_id = v_company and r.deleted_at is null and r.buyer_id = p_id
                             and char_length(w.word) >= 3
                             and w.word <> all (array['and', 'of', 'for', 'the', 'with', 'و', 'برای'])
                           group by w.word order by count(*) desc, w.word limit 10) t),
    'owners', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'count', n)
                                         order by n desc, name), '[]'::jsonb)
                 from (select o.id, o.full_name as name, count(*) as n
                         from public.sales_rfps r join public.profiles o on o.id = r.owner_id
                        where r.company_id = v_company and r.deleted_at is null and r.buyer_id = p_id
                        group by o.id, o.full_name) t));
end $$;

CREATE OR REPLACE FUNCTION public.app_sales_bootstrap() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_company uuid := private.sales_company();
begin
  return jsonb_build_object(
    'caps', jsonb_build_object(
      'edit', private.sales_can('sales', 'edit'),
      'prices', private.sales_can('sales_prices', 'read'),
      'prices_edit', private.sales_can('sales_prices', 'edit'),
      'bonds', private.sales_can('sales_bonds', 'read'),
      'bonds_edit', private.sales_can('sales_bonds', 'edit'),
      'decide', private.sales_can('sales_decide', 'edit'),
      'reports', private.sales_can('sales_reports', 'read'),
      'settings', private.sales_can('sales_settings', 'edit'),
      'items', private.sales_can('project_items', 'read'),
      'items_edit', private.sales_can('project_items', 'edit'),
      'remove_records', private.sales_is_admin(),
      'customers', private.sales_can('sales_customers', 'edit'),
      'customers_import', private.sales_can('sales_customers_import', 'edit')),
    'me', auth.uid(),
    'flows', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'kind', f.kind,
                'name_fa', f.name_fa, 'name_en', f.name_en) order by f.kind), '[]'::jsonb)
                from public.sales_flows f where f.company_id = v_company),
    'stages', (select coalesce(jsonb_agg((to_jsonb(s) - 'company_id') order by s.flow_id, s.position), '[]'::jsonb)
                 from public.sales_stages s where s.company_id = v_company),
    'fields', (select coalesce(jsonb_agg((to_jsonb(d) - 'company_id') order by d.entity, d.position, d.label_en), '[]'::jsonb)
                 from public.sales_field_defs d where d.company_id = v_company),
    'customers', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'name_en', c.name_en, 'kind', c.kind,
                    'incomplete', cardinality(c.missing) > 0)
                    order by c.name), '[]'::jsonb) from public.sales_customers c where c.company_id = v_company),
    'people', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name,
                 'personnel_no', p.personnel_no,
                 'role_ids', (select coalesce(jsonb_agg(ur.role_id), '[]'::jsonb)
                                from public.user_roles ur where ur.user_id = p.id))
                 order by p.full_name), '[]'::jsonb)
                 from public.profiles p where p.company_id = v_company and p.active),
    'roles', (select coalesce(jsonb_agg(jsonb_build_object('id', ro.id, 'name', ro.name) order by ro.name), '[]'::jsonb)
                from public.roles ro where ro.company_id = v_company),
    'currencies', (select coalesce(jsonb_agg((to_jsonb(c) - 'company_id') order by c.position, c.code), '[]'::jsonb)
                     from public.sales_currencies c where c.company_id = v_company),
    'settings', (select to_jsonb(st) - 'company_id' from public.sales_settings st where st.company_id = v_company),
    'batches', case when private.sales_can('sales_settings') then
      (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'file_name', b.file_name,
                'created_at', b.created_at, 'created_count', b.created_count, 'updated_count', b.updated_count,
                'skipped_count', b.skipped_count, 'kind', b.kind, 'closed', b.closed,
                'records', (select count(*) from public.sales_rfps r where b.id = any (r.import_batches)),
                'untouched', (select count(*) from public.sales_rfps r
                               where b.id = any (r.import_batches) and not r.edited_after_import))
              order by b.created_at desc), '[]'::jsonb)
         from public.sales_import_batches b where b.company_id = v_company and b.kind <> 'customers')
      else '[]'::jsonb end);
end $$;

CREATE OR REPLACE FUNCTION private.sales_rfp_json(r public.sales_rfps, p_prices boolean) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select (to_jsonb(r) - array['company_id','node_seq','import_batch_id','import_batches','edited_after_import',
                              'our_price','winning_bid','winner_name','total_value'])
    || case when p_prices then jsonb_build_object('our_price', r.our_price, 'winning_bid', r.winning_bid,
              'winner_name', r.winner_name, 'total_value', r.total_value) else '{}'::jsonb end
    || jsonb_build_object(
         'buyer_name', (select name from public.sales_customers where id = r.buyer_id),
         'buyer_kind', (select kind from public.sales_customers where id = r.buyer_id),
         'client_name', (select name from public.sales_customers where id = r.client_id),
         'buyer_name_en', (select name_en from public.sales_customers where id = r.buyer_id),
         'client_name_en', (select name_en from public.sales_customers where id = r.client_id),
         'owner_name', (select full_name from public.profiles where id = r.owner_id),
         'flow_kind', (select kind from public.sales_flows where id = r.flow_id),
         'stage_kind', (select kind from public.sales_stages where id = r.stage_id),
         'imported', r.import_batch_id is not null,
         'deleted_by_name', (select full_name from public.profiles where id = r.deleted_by),
         'next_deadline', (select min(d.due_on) from public.sales_deadlines d
                            where d.rfp_id = r.id and d.done_at is null));
$$;

CREATE OR REPLACE FUNCTION public.app_sales_deadlines(p_include_done boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_company uuid := private.sales_company();
begin
  return (select coalesce(jsonb_agg(
            (to_jsonb(d) - array['company_id'])
            || jsonb_build_object('record_no', r.record_no, 'title', r.title, 'stage_id', r.stage_id,
                 'buyer_name', (select name from public.sales_customers where id = r.buyer_id),
                 'buyer_name_en', (select name_en from public.sales_customers where id = r.buyer_id),
                 'responsible_name', (select full_name from public.profiles where id = d.responsible_id))
            order by d.due_on, r.record_no), '[]'::jsonb)
            from public.sales_deadlines d join public.sales_rfps r on r.id = d.rfp_id
           where d.company_id = v_company and r.deleted_at is null and (p_include_done or d.done_at is null));
end $$;

CREATE OR REPLACE FUNCTION public.app_sales_price_history(p_q text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_company uuid := private.sales_company('sales_prices', 'read');
begin
  if not private.sales_can('sales_reports', 'read') then
    raise exception 'sales: not allowed' using errcode = '42501';
  end if;
  return (select coalesce(jsonb_agg(to_jsonb(x) order by x.quoted_on desc, x.record_no desc, x.code), '[]'::jsonb)
    from (
      select q.code, q.revision, q.product_type, q.size, q.rating, q.description, q.qty, q.unit,
             q.unit_price, q.quoted_on, r.id as rfp_id, r.record_no, r.currency, r.bid_result, r.winning_bid,
             (select name from public.sales_customers where id = r.buyer_id) as buyer_name,
             (select name_en from public.sales_customers where id = r.buyer_id) as buyer_name_en
        from public.sales_quote_lines q join public.sales_rfps r on r.id = q.rfp_id
       where q.company_id = v_company and r.deleted_at is null
         and not exists (
           select 1 from unnest(regexp_split_to_array(btrim(coalesce(p_q, '')), '\s+')) as t(term)
            where term <> ''
              and concat_ws(' ', q.code, q.product_type, q.size, q.rating, q.description)
                  not ilike '%' || replace(replace(replace(term, '\', '\\'), '%', '\%'), '_', '\_') || '%')
       order by q.quoted_on desc, r.record_no desc
       limit 500) x);
end $$;

CREATE OR REPLACE FUNCTION public.app_sales_report() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_company uuid := private.sales_company('sales_reports', 'read');
  v_prices boolean := private.sales_can('sales_prices', 'read');
begin
  return jsonb_build_object(
    'pipeline', (select coalesce(jsonb_agg(
        jsonb_build_object('stage_id', t.stage_id, 'count', t.n)
          || case when v_prices then jsonb_build_object('value', coalesce(v.j, '{}'::jsonb)) else '{}'::jsonb end
        order by t.position), '[]'::jsonb)
      from (select r.stage_id, s.position, count(*) as n
              from public.sales_rfps r join public.sales_stages s on s.id = r.stage_id
             where r.company_id = v_company and r.deleted_at is null group by r.stage_id, s.position) t
      left join (select stage_id, jsonb_object_agg(currency, amt) as j
                   from (select stage_id, currency, sum(coalesce(total_value, our_price)) as amt
                           from public.sales_rfps
                          where company_id = v_company and deleted_at is null and currency is not null
                            and coalesce(total_value, our_price) is not null
                          group by stage_id, currency) q group by stage_id) v on v.stage_id = t.stage_id),
    'decided', (select coalesce(jsonb_agg(jsonb_build_object(
          'buyer_id', r.buyer_id, 'buyer_name', b.name, 'buyer_name_en', b.name_en,
          'result_at', r.result_at, 'bid_result', r.bid_result)), '[]'::jsonb)
      from public.sales_rfps r left join public.sales_customers b on b.id = r.buyer_id
     where r.company_id = v_company and r.deleted_at is null and r.bid_decision = 'bid' and r.bid_result is not null
       and r.import_batch_id is null and cardinality(r.import_batches) = 0));
end $$;

CREATE OR REPLACE FUNCTION public.app_sales_list_page(p jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare v_company uuid := private.sales_company(); v_prices boolean := private.sales_can('sales_prices', 'read');
  v_state text := coalesce(nullif(p->>'state', ''), 'open'); v_flow text := nullif(p->>'flow', '');
  v_stage uuid := private.sales_uuid(p->>'stage'); v_owner uuid := private.sales_uuid(p->>'owner');
  v_buyer uuid := private.sales_uuid(p->>'buyer'); v_q text := nullif(btrim(coalesce(p->>'q', '')), '');
  v_sort text := coalesce(nullif(p->>'sort', ''), 'record_no'); v_dir text := nullif(p->>'dir', '');
  v_limit integer; v_words text[]; v_no integer; v_total integer; v_rows jsonb;
begin
  if jsonb_typeof(coalesce(p, '{}'::jsonb)) <> 'object' or v_state not in ('open', 'closed', 'all', 'deleted')
     or (v_state = 'deleted' and not private.sales_is_admin())
     or (v_flow is not null and v_flow not in ('bid', 'contract'))
     or v_sort not in ('record_no', 'received_on', 'buyer', 'title', 'stage', 'owner', 'deadline', 'value')
     or (v_dir is not null and v_dir not in ('asc', 'desc')) then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  perform private.sales_filter_check(p);
  -- Without prices a value sort would leak the order of prices: fall back to the number.
  if v_sort = 'value' and not v_prices then v_sort := 'record_no'; end if;
  v_dir := coalesce(v_dir, case when v_sort in ('record_no', 'received_on', 'value') then 'desc' else 'asc' end);
  v_limit := least(500, greatest(1, coalesce(private.sales_num(p->>'limit')::integer, 500)));
  if v_q is not null then
    v_words := private.sales_words(v_q);
    if v_q ~ '^\d{1,9}$' then v_no := v_q::integer; end if;
  end if;

  with f as (
    select r.id, r.record_no,
           case v_sort when 'record_no' then r.record_no::numeric
                       when 'stage' then (s.position * 10 + case fl.kind when 'bid' then 0 else 1 end)::numeric
                       when 'value' then coalesce(r.total_value, r.our_price) end as k_num,
           case v_sort when 'received_on' then r.received_on
                       when 'deadline' then (select min(d.due_on) from public.sales_deadlines d
                                              where d.rfp_id = r.id and d.done_at is null) end as k_date,
           case v_sort when 'buyer' then b.name when 'title' then r.title
                       when 'owner' then coalesce(o.full_name, r.in_charge_text) end as k_text
      from public.sales_rfps r
      join public.sales_stages s on s.id = r.stage_id
      join public.sales_flows fl on fl.id = r.flow_id
      left join public.sales_customers b on b.id = r.buyer_id
      left join public.sales_customers c on c.id = r.client_id
      left join public.profiles o on o.id = r.owner_id
     where r.company_id = v_company
       and case when v_state = 'deleted' then r.deleted_at is not null
                else r.deleted_at is null and (v_state = 'all' or (v_state = 'open') = (s.kind = 'open')) end
       and (v_flow is null or fl.kind = v_flow)
       and (v_stage is null or r.stage_id = v_stage)
       and (v_owner is null or r.owner_id = v_owner)
       and (v_buyer is null or r.buyer_id = v_buyer)
       and private.sales_rec_ok(p, r.received_on, r.bid_result, r.bid_decision, s.kind, r.owner_id)
       and (v_q is null or r.record_no = v_no
            or (cardinality(v_words) > 0 and not exists (
                  select 1 from unnest(v_words) as w(k)
                   where strpos(concat_ws('|', private.sales_word_key(r.title), private.sales_word_key(r.customer_ref),
                                  private.sales_word_key(r.description), private.sales_word_key(r.in_charge_text),
                                  private.sales_word_key(b.name), private.sales_word_key(b.name_en),
                                  private.sales_word_key(c.name), private.sales_word_key(c.name_en),
                                  private.sales_word_key(o.full_name)), w.k) = 0)))
  ), ranked as (
    select id, row_number() over (order by
        (case when v_dir = 'asc' then k_num end) asc nulls last, (case when v_dir = 'desc' then k_num end) desc nulls last,
        (case when v_dir = 'asc' then k_date end) asc nulls last, (case when v_dir = 'desc' then k_date end) desc nulls last,
        (case when v_dir = 'asc' then k_text end) asc nulls last, (case when v_dir = 'desc' then k_text end) desc nulls last,
        (case when v_dir = 'asc' then record_no end) asc, (case when v_dir = 'desc' then record_no end) desc) as rn
      from f
  ), page as (select id, rn from ranked order by rn limit v_limit)
  select (select count(*) from f),
         coalesce((select jsonb_agg(private.sales_rfp_json(r, v_prices) order by page.rn)
                     from public.sales_rfps r join page on page.id = r.id), '[]'::jsonb)
    into v_total, v_rows;
  return jsonb_build_object('rows', v_rows, 'total', v_total, 'truncated', v_total > v_limit);
end $_$;


-- ---------------------------------------------------------------- grants
revoke all on function private.sales_customer_lock(uuid) from public, anon, authenticated;
revoke all on function private.sales_clean(text) from public, anon, authenticated;
revoke all on function private.sales_phone(text) from public, anon, authenticated;
revoke all on function private.sales_customer_find(uuid, text) from public, anon, authenticated;
revoke all on function private.sales_customer_name_clash(uuid, text, uuid) from public, anon, authenticated;
revoke all on function private.sales_customer_ref(uuid, text) from public, anon, authenticated;
revoke all on function private.sales_customer_values(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.sales_customer_profile(uuid, boolean) from public, anon, authenticated;
revoke all on function private.sales_customer_set_contacts(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function private.sales_raise_duplicate(uuid) from public, anon, authenticated;
revoke all on function public.app_sales_save_customer(uuid, jsonb) from public, anon;
grant execute on function public.app_sales_save_customer(uuid, jsonb) to authenticated;
revoke all on function public.app_sales_customer_lists() from public, anon;
grant execute on function public.app_sales_customer_lists() to authenticated;
revoke all on function public.app_sales_save_category(jsonb) from public, anon;
grant execute on function public.app_sales_save_category(jsonb) to authenticated;
revoke all on function public.app_sales_save_city(jsonb) from public, anon;
grant execute on function public.app_sales_save_city(jsonb) to authenticated;
