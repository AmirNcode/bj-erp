-- FR-98 follow-up (CEO, 2026-11-26): a contractor customer can hold several rank + category pairs.
-- The first pair stays on sales_customers (rank, category_id): the completeness tags, the import and
-- every existing reader keep using it. Further pairs live in sales_customer_grades, always complete
-- (both values), distinct, and only while the customer is a contractor.

create table public.sales_customer_grades (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null references public.sales_customers(id) on delete cascade,
  rank        smallint not null check (rank between 1 and 5),
  category_id uuid not null references public.sales_contractor_categories(id) on delete restrict,
  position    integer not null default 0,
  unique (customer_id, rank, category_id)
);
create index sales_customer_grades_customer on public.sales_customer_grades (customer_id, position);
comment on table public.sales_customer_grades is
  'FR-98: a contractor customer''s further rank + category pairs (the first pair is on sales_customers). Functions only.';
alter table public.sales_customer_grades enable row level security;
revoke all on public.sales_customer_grades from public, anon, authenticated;

-- A customer that stops being a contractor loses its further pairs (the CHECK on sales_customers
-- already clears the first one); a further pair that became the first pair (overwrite import) goes.
create function private.sales_customer_grades_trg() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if new.kind is distinct from 'contractor' then
    delete from public.sales_customer_grades where customer_id = new.id;
  elsif new.rank is not null and new.category_id is not null then
    delete from public.sales_customer_grades
     where customer_id = new.id and rank = new.rank and category_id = new.category_id;
  end if;
  return null;
end $$;
create trigger sales_customers_grades_sync after update of kind, rank, category_id on public.sales_customers
  for each row
  when (old.kind is distinct from new.kind or old.rank is distinct from new.rank
        or old.category_id is distinct from new.category_id)
  execute function private.sales_customer_grades_trg();

-- Replace a customer's further pairs with p_grades (array of {rank, category_id}). Pairs equal to the
-- first pair or to an earlier one are dropped; a half-filled or unknown pair is invalid input.
create function private.sales_customer_set_grades(p_company uuid, p_customer uuid, p_grades jsonb) returns void
  language plpgsql security definer set search_path = '' as $$
declare v_c public.sales_customers; v_e jsonb; v_rank numeric; v_cat uuid; v_pos integer := 0;
begin
  if p_grades is null or jsonb_typeof(p_grades) <> 'array' or jsonb_array_length(p_grades) > 9
     or exists (select 1 from jsonb_array_elements(p_grades) e where jsonb_typeof(e) <> 'object') then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  select * into v_c from public.sales_customers where id = p_customer and company_id = p_company;
  delete from public.sales_customer_grades where customer_id = p_customer;
  if v_c.kind is distinct from 'contractor' then return; end if;
  for v_e in select e from jsonb_array_elements(p_grades) as t(e) loop
    v_rank := private.sales_num(translate(v_e->>'rank', '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'));
    v_cat := private.sales_uuid(v_e->>'category_id');
    if v_rank is null or v_rank not in (1, 2, 3, 4, 5) or v_cat is null
       or not exists (select 1 from public.sales_contractor_categories where id = v_cat and company_id = p_company) then
      raise exception 'sales: invalid input' using errcode = '22023';
    end if;
    if (v_rank, v_cat) is not distinct from (v_c.rank::numeric, v_c.category_id) then continue; end if;
    v_pos := v_pos + 1;
    insert into public.sales_customer_grades (company_id, customer_id, rank, category_id, position)
      values (p_company, p_customer, v_rank::smallint, v_cat, v_pos)
      on conflict (customer_id, rank, category_id) do nothing;
  end loop;
end $$;

-- ---------------------------------------------------------------- profile: + grades
create or replace function private.sales_customer_profile(p_id uuid, p_private boolean) returns jsonb
  language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'name', c.name, 'name_en', c.name_en, 'kind', c.kind,
      'rank', c.rank, 'category_id', c.category_id, 'category_fa', cat.name_fa, 'category_en', cat.name_en,
      'grades', (select coalesce(jsonb_agg(jsonb_build_object('rank', g.rank, 'category_id', g.category_id,
                     'category_fa', gc.name_fa, 'category_en', gc.name_en) order by g.position, g.id), '[]'::jsonb)
                   from public.sales_customer_grades g
                   join public.sales_contractor_categories gc on gc.id = g.category_id
                  where g.customer_id = c.id),
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

-- ---------------------------------------------------------------- save: + grades
-- Same as 20261126100200 plus key `grades` (further pairs). A payload without it keeps the stored
-- pairs (the old app during the deploy swap).
create or replace function public.app_sales_save_customer(p_id uuid, p jsonb) returns jsonb
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
    if p ? 'grades' or p_id is null then
      perform private.sales_customer_set_grades(v_company, v_id, coalesce(p->'grades', '[]'::jsonb));
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

-- ---------------------------------------------------------------- merge: + grades
-- Same as 20261126100200 plus: the source's pairs (its first pair and its further ones) are added to
-- the target's further pairs, skipping any pair the target already holds (at most 9 further pairs).
create or replace function public.app_sales_merge_customers(p_from uuid, p_into uuid) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare v_company uuid := private.sales_company('sales_settings', 'edit');
  v_from public.sales_customers; v_into public.sales_customers; v_ids uuid[]; v_n integer; v_kind text;
  v_pairs jsonb; v_after public.sales_customers;
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
  -- Every complete pair either side holds, in order (target first), before the source row goes.
  select coalesce(jsonb_agg(jsonb_build_object('rank', rank, 'category_id', category_id) order by side, pos), '[]'::jsonb)
    into v_pairs
    from (
      select 0 as side, 0 as pos, v_into.rank as rank, v_into.category_id as category_id
       where v_into.rank is not null and v_into.category_id is not null
      union all
      select 1, position, rank, category_id from public.sales_customer_grades where customer_id = p_into
      union all
      select 2, 0, v_from.rank, v_from.category_id
       where v_from.rank is not null and v_from.category_id is not null
      union all
      select 3, position, rank, category_id from public.sales_customer_grades where customer_id = p_from
    ) t;
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
  -- Further pairs: every distinct complete pair except the target's (new) first one, at most 9.
  select * into v_after from public.sales_customers where id = p_into;
  perform private.sales_customer_set_grades(v_company, p_into, coalesce((
    select jsonb_agg(e order by o) from (
      select e, min(o) as o from jsonb_array_elements(v_pairs) with ordinality as t(e, o)
       where (e->>'rank', e->>'category_id') is distinct from (v_after.rank::text, v_after.category_id::text)
       group by e order by min(o) limit 9) d), '[]'::jsonb));
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
