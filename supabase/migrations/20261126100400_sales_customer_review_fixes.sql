-- FR-98 review fixes (PR #35, Opus review 2026-11-26). The earlier FR-98 migrations are frozen
-- (applied on the :3501 DB), so fixes land here.
-- 1. Record save by customer id takes the customer lock too (deadlock vs merge, reproduced).
-- 2. Rename follows the one-namespace rule (aliases included).
-- 3. Customer import: an Update that cannot keep rank / category (existing non-contractor) counts them
--    as dropped; an import that created and updated nothing leaves no batch row.
-- 4. sales_word_key no longer depends on the database ctype ([:alnum:] is ASCII-only under C) and
--    drops tatweel (U+0640), like the TS nameKey.

create or replace function private.sales_word_key(p text) returns text
  language sql immutable set search_path = '' as $$
  select regexp_replace(
           translate(lower(coalesce(p, '')), '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يك', '01234567890123456789یک'),
           '[^0-9a-z\u00DF-\u00F6\u00F8-\u00FF\u0100-\u024F\u0621-\u063A\u0641-\u064A\u066E\u066F\u0671-\u06D3\u06D5\u06EE\u06EF\u06FA-\u06FC\u06FF]',
           '', 'g');
$$;

create or replace function public.app_sales_save_record(p_id uuid, p jsonb, p_stage uuid DEFAULT NULL::uuid) RETURNS uuid
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
  if p ?| array['buyer', 'client', 'buyer_id', 'client_id'] then perform private.sales_customer_lock(v_company); end if;
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
  if private.sales_customer_name_clash(v_company, v_key, p_id) is not null then
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

create or replace function public.app_sales_customer_import(p jsonb) returns jsonb
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
        -- Update keeps an existing non-contractor type: the file's rank / category cannot be kept.
        if v_merged.kind is distinct from 'contractor' then
          v_dropped := v_dropped + (v_cv.rank is not null)::integer + (v_cv.category_id is not null)::integer;
        end if;
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
    -- Nothing written: no batch to list or remove.
    if v_created + v_updated = 0 then
      delete from public.sales_import_batches where id = v_batch;
      v_batch := null;
    end if;
    select count(*)::integer into v_incomplete from public.sales_customers
     where id = any (v_touched) and cardinality(missing) > 0;
  exception
    when check_violation or not_null_violation or foreign_key_violation or unique_violation then
      raise exception 'sales: invalid input' using errcode = '22023';
  end;
  return jsonb_build_object('batch_id', v_batch, 'created', v_created, 'updated', v_updated,
    'skipped', v_skipped, 'incomplete', v_incomplete, 'dropped', v_dropped);
end $$;
