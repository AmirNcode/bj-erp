-- Sales CEO feedback, task 4: a company-managed Products catalog; picking a product on an item row
-- pre-fills its empty columns (spec 2026-11-20 section 5). Function-only tables; values are COPIED
-- onto the row, so later product edits never touch existing rows.

create table public.sales_products (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code       text check (code is null or char_length(code) between 1 and 40),
  name_fa    text not null check (char_length(btrim(name_fa)) between 1 and 80),
  name_en    text not null check (char_length(btrim(name_en)) between 1 and 80),
  active     boolean not null default true,
  position   integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);
comment on table public.sales_products is
  'FR-94: product families that pre-fill item rows (name, columns, default values). Functions only.';
alter table public.sales_products enable row level security;
revoke all on public.sales_products from public, anon, authenticated;

create table public.sales_product_fields (
  product_id uuid not null references public.sales_products(id) on delete cascade,
  field      text not null check (field in ('size','rating','qty','unit') or field ~ '^x_[a-z0-9_]{1,38}$'),
  position   integer not null default 0,
  "default"  jsonb,
  primary key (product_id, field)
);
comment on table public.sales_product_fields is
  'FR-94: a product''s ordered item columns (built-in key or sales_field_defs.key) with an optional default. Functions only.';
alter table public.sales_product_fields enable row level security;
revoke all on public.sales_product_fields from public, anon, authenticated;

alter table public.project_nodes
  add column product_id uuid references public.sales_products(id) on delete set null;
create index project_nodes_product on public.project_nodes (product_id) where product_id is not null;

-- Validates one default against its column; returns the value to store (null = no default).
create function private.sales_product_default(p_company uuid, p_field text, p_value jsonb) returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
declare d public.sales_field_defs;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' or p_value = '""'::jsonb then return null; end if;
  if p_field in ('size', 'rating', 'unit') then
    if jsonb_typeof(p_value) <> 'string' or char_length(p_value #>> '{}') > (case when p_field = 'unit' then 40 else 200 end) then
      raise exception 'sales: invalid input' using errcode = '22023';
    end if;
    return to_jsonb(btrim(p_value #>> '{}'));
  elsif p_field = 'qty' then
    if jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}')::numeric < 0 then
      raise exception 'sales: invalid input' using errcode = '22023';
    end if;
    return p_value;
  end if;
  select * into d from public.sales_field_defs
   where company_id = p_company and entity = 'item' and key = p_field and active;
  if not found then raise exception 'sales: invalid input' using errcode = '22023'; end if;
  if d.type = 'number' then
    if jsonb_typeof(p_value) <> 'number' then raise exception 'sales: invalid input' using errcode = '22023'; end if;
    return p_value;
  elsif d.type = 'yes_no' then
    if jsonb_typeof(p_value) <> 'boolean' then raise exception 'sales: invalid input' using errcode = '22023'; end if;
    return p_value;
  end if;
  if jsonb_typeof(p_value) <> 'string' then raise exception 'sales: invalid input' using errcode = '22023'; end if;
  if d.type = 'select' then
    if not ((p_value #>> '{}') = any (d.options)) then
      raise exception 'sales: invalid input' using errcode = '22023';
    end if;
  elsif d.type = 'date' then
    if (p_value #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'sales: invalid input' using errcode = '22023'; end if;
  elsif char_length(p_value #>> '{}') > 200 then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  return to_jsonb(btrim(p_value #>> '{}'));
end $$;
revoke all on function private.sales_product_default(uuid, text, jsonb) from public, anon, authenticated;

create function public.app_sales_products() returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
declare v_company uuid := private.sales_company();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'code', p.code, 'name_fa', p.name_fa, 'name_en', p.name_en,
      'active', p.active, 'position', p.position,
      'used_count', (select count(*) from public.project_nodes n where n.product_id = p.id),
      'fields', coalesce((select jsonb_agg(jsonb_build_object('field', f.field, 'default', f."default")
                                           order by f.position, f.field)
                            from public.sales_product_fields f where f.product_id = p.id), '[]'::jsonb))
      order by p.position, p.name_en)
    from public.sales_products p where p.company_id = v_company), '[]'::jsonb);
end $$;

create function public.app_sales_save_product(p_id uuid, p jsonb) returns uuid
  language plpgsql security definer set search_path = '' as $$
declare v_company uuid := private.sales_company('sales_settings', 'edit');
  pr public.sales_products; e jsonb; v_pos integer := 0; v_field text;
begin
  if p is null or jsonb_typeof(p) <> 'object'
     or (p ? 'fields' and jsonb_typeof(p->'fields') <> 'array') then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  if p_id is null then
    pr.id := gen_random_uuid(); pr.company_id := v_company; pr.active := true;
    pr.created_by := auth.uid(); pr.created_at := now();
    pr.position := (select coalesce(max(position), 0) + 1 from public.sales_products where company_id = v_company);
  else
    select * into pr from public.sales_products where id = p_id and company_id = v_company for update;
    if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
  end if;
  begin
    if p ? 'code' then pr.code := nullif(btrim(coalesce(p->>'code', '')), ''); end if;
    if p ? 'name_fa' then pr.name_fa := btrim(coalesce(p->>'name_fa', '')); end if;
    if p ? 'name_en' then pr.name_en := btrim(coalesce(p->>'name_en', '')); end if;
    pr.name_fa := coalesce(nullif(pr.name_fa, ''), nullif(pr.name_en, ''));
    pr.name_en := coalesce(nullif(pr.name_en, ''), pr.name_fa);
    if p ? 'active' then pr.active := (p->>'active')::boolean; end if;
    if p ? 'position' then pr.position := (p->>'position')::integer; end if;
    pr.updated_by := auth.uid(); pr.updated_at := now();
    if p_id is null then
      insert into public.sales_products select pr.*;
    else
      update public.sales_products set code = pr.code, name_fa = pr.name_fa, name_en = pr.name_en,
        active = pr.active, position = pr.position, updated_by = pr.updated_by, updated_at = pr.updated_at
       where id = pr.id;
    end if;
    if p ? 'fields' then
      if jsonb_array_length(p->'fields') > 40 then
        raise exception 'sales: invalid input' using errcode = '22023';
      end if;
      delete from public.sales_product_fields where product_id = pr.id;
      for e in select * from jsonb_array_elements(p->'fields') loop
        if jsonb_typeof(e) <> 'object' or jsonb_typeof(e->'field') is distinct from 'string' then
          raise exception 'sales: invalid input' using errcode = '22023';
        end if;
        v_field := e->>'field'; v_pos := v_pos + 1;
        insert into public.sales_product_fields (product_id, field, position, "default")
          values (pr.id, v_field, v_pos, private.sales_product_default(v_company, v_field, e->'default'));
      end loop;
    end if;
  exception when others then
    raise exception 'sales: invalid input' using errcode = '22023';
  end;
  return pr.id;
end $$;

create function public.app_sales_delete_product(p_id uuid) returns void
  language plpgsql security definer set search_path = '' as $$
declare v_company uuid := private.sales_company('sales_settings', 'edit');
begin
  perform 1 from public.sales_products where id = p_id and company_id = v_company for update;
  if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.project_nodes where product_id = p_id) then
    raise exception 'sales: in use' using errcode = '22023';
  end if;
  delete from public.sales_products where id = p_id;
end $$;

-- app_project_save_node: from its current body, plus the product branch.
create or replace function public.app_project_save_node(p_rfp uuid, p_id uuid, p_parent uuid, p jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare v_company uuid := private.sales_company('project_items', 'edit');
  r public.sales_rfps; n public.project_nodes; v_patch jsonb; v_seq integer; v_code text; v_depth integer;
  pr public.sales_products; v_pick boolean := false; f record; v_cols jsonb; v_missing jsonb; v_key text; d integer;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_patch from jsonb_each(p)
   where key = any (array['description','product_type','size','rating','qty','unit','custom','product_id']);
  if v_patch ? 'custom' then
    if jsonb_typeof(v_patch->'custom') <> 'object' then
      raise exception 'sales: invalid input' using errcode = '22023';
    end if;
    v_patch := jsonb_set(v_patch, '{custom}', coalesce((
      select jsonb_object_agg(key, value) from jsonb_each(v_patch->'custom')
       where key ~ '^x_[a-z0-9_]{1,38}$' and jsonb_typeof(value) <> 'null'
         and value <> '""'::jsonb), '{}'::jsonb));
  end if;
  if v_patch ? 'product_id' and jsonb_typeof(v_patch->'product_id') not in ('null', 'string') then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;

  -- Every write locks the record row first (one lock order, no deadlocks). Under that
  -- lock the counters are safe: two people adding at once get different numbers, and a
  -- number is never handed out twice.
  r := private.sales_rfp(p_rfp, v_company);
  if p_id is null then
    if p_parent is null then
      update public.sales_rfps set node_seq = node_seq + 1
       where id = p_rfp and company_id = v_company
       returning node_seq, record_no::text into v_seq, v_code;
      if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
      v_depth := 1;
    else
      update public.project_nodes set child_seq = child_seq + 1
       where id = p_parent and rfp_id = p_rfp and company_id = v_company
       returning child_seq, code, depth + 1 into v_seq, v_code, v_depth;
      if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
    end if;
    n.id := gen_random_uuid(); n.company_id := v_company; n.rfp_id := p_rfp; n.parent_id := p_parent;
    n.seq := v_seq; n.code := v_code || '-' || v_seq; n.depth := v_depth; n.child_seq := 0;
    n.custom := '{}'::jsonb; n.created_by := auth.uid(); n.created_at := now();
  else
    select * into n from public.project_nodes
     where id = p_id and rfp_id = p_rfp and company_id = v_company for update;
    if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
  end if;

  -- A product that differs from the stored one: it must be an active product of this company.
  if v_patch ? 'product_id' and jsonb_typeof(v_patch->'product_id') = 'string' then
    if private.sales_uuid(v_patch->>'product_id') is distinct from n.product_id then
      select * into pr from public.sales_products
       where id = private.sales_uuid(v_patch->>'product_id') and company_id = v_company and active;
      if not found then raise exception 'sales: invalid input' using errcode = '22023'; end if;
      v_pick := true;
    end if;
  end if;

  n.updated_by := auth.uid(); n.updated_at := now();
  begin
    n := jsonb_populate_record(n, v_patch);
    n.custom := coalesce(n.custom, '{}'::jsonb);
    if v_pick then
      -- Typed values stay; only empty cells get the product's defaults.
      n.product_type := left(coalesce(nullif(pr.name_en, ''), pr.name_fa), 200);
      for f in select field, "default" from public.sales_product_fields
                where product_id = pr.id and "default" is not null order by position loop
        if f.field = 'size' then
          if coalesce(n.size, '') = '' then n.size := f."default" #>> '{}'; end if;
        elsif f.field = 'rating' then
          if coalesce(n.rating, '') = '' then n.rating := f."default" #>> '{}'; end if;
        elsif f.field = 'unit' then
          if coalesce(n.unit, '') = '' then n.unit := f."default" #>> '{}'; end if;
        elsif f.field = 'qty' then
          if n.qty is null then n.qty := (f."default" #>> '{}')::numeric; end if;
        elsif (n.custom -> f.field) is null or n.custom -> f.field in ('null'::jsonb, '""'::jsonb) then
          n.custom := n.custom || jsonb_build_object(f.field, f."default");
        end if;
      end loop;
    end if;
    if p_id is null then
      insert into public.project_nodes select n.*;
    else
      update public.project_nodes set description = n.description, product_type = n.product_type,
        size = n.size, rating = n.rating, qty = n.qty, unit = n.unit, custom = n.custom,
        product_id = n.product_id,
        updated_by = n.updated_by, updated_at = n.updated_at
      where id = p_id;
    end if;
  exception when others then
    raise exception 'sales: invalid input' using errcode = '22023';
  end;

  if v_pick then
    -- Show the product's columns on this level: start from the list the UI shows now.
    v_key := n.depth::text;
    v_cols := r.item_columns -> v_key;
    if v_cols is null then
      if n.depth <= 1 then
        v_cols := '["product_type","size","rating","qty","unit"]'::jsonb;
      else
        for d in reverse n.depth - 1 .. 2 loop
          v_cols := r.item_columns -> d::text;
          exit when v_cols is not null;
        end loop;
        v_cols := coalesce(v_cols, '["qty","unit"]'::jsonb);
      end if;
    end if;
    select coalesce(jsonb_agg(to_jsonb(pf.field) order by pf.position), '[]'::jsonb) into v_missing
      from public.sales_product_fields pf where pf.product_id = pr.id and not (v_cols ? pf.field);
    if jsonb_array_length(v_missing) > 0 then
      v_cols := v_cols || v_missing;
      if jsonb_array_length(v_cols) > 40 then
        raise exception 'sales: invalid input' using errcode = '22023';
      end if;
      update public.sales_rfps
         set item_columns = coalesce(item_columns, '{}'::jsonb) || jsonb_build_object(v_key, v_cols)
       where id = p_rfp;
    end if;
  end if;

  perform private.sales_recalc_price(p_rfp);
  perform private.sales_touch(p_rfp, 'items',
    case when v_pick then jsonb_build_object('code', n.code, 'action', 'product', 'product', n.product_type)
         else jsonb_build_object('code', n.code, 'action', case when p_id is null then 'added' else 'changed' end) end);
  return jsonb_build_object('id', n.id, 'code', n.code);
end $_$;

revoke all on function public.app_sales_products() from public, anon;
grant execute on function public.app_sales_products() to authenticated;
revoke all on function public.app_sales_save_product(uuid, jsonb) from public, anon;
grant execute on function public.app_sales_save_product(uuid, jsonb) to authenticated;
revoke all on function public.app_sales_delete_product(uuid) from public, anon;
grant execute on function public.app_sales_delete_product(uuid) to authenticated;
