-- =============================================================================
-- Migration: 20261117120000_sales_inquiry_import.sql
-- Purpose  : ERP > Sales, FR-94 sections 16.1-16.7 (spec 2026-11-16, plan 2026-11-17):
--   * stage kind 'archived' + a seeded bid-flow "Archived" stage (closed, no deadlines);
--   * sales_rfps.import_batches (every batch that wrote a row; drives batch removal);
--   * sales_import_batches.kind / closed (an inquiry batch stays open while chunks arrive);
--   * app_sales_import (ledger) appends its batch; app_sales_remove_batch new rules;
--   * the six fixed custom fields of the inquiry register;
--   * app_sales_import_inquiries, app_sales_record_numbers, app_sales_list_page (+ buyer filter);
--   * customer lookup: app_sales_add_customer, app_sales_similar_customers.
--   Custom field keys carry the mandatory x_ prefix (sales_field_defs_key_check): x_inq_no ...
--   Redefined whole from their latest definitions, with only the changes named above:
--   private.sales_ensure, private.sales_rfp_json, app_sales_save_stage, app_sales_bootstrap
--   (batch list gains kind/closed and counts rows by import_batches), app_sales_import,
--   app_sales_remove_batch.
-- =============================================================================

-- ---------------------------------------------------------------- schema
alter table public.sales_stages drop constraint sales_stages_kind_check;
alter table public.sales_stages add constraint sales_stages_kind_check
  check (kind in ('open', 'lost', 'no_bid', 'cancelled', 'done', 'archived'));

alter table public.sales_rfps add column import_batches uuid[] not null default '{}';
update public.sales_rfps set import_batches = array[import_batch_id] where import_batch_id is not null;
create index sales_rfps_batches on public.sales_rfps using gin (import_batches);
create index sales_rfps_company_no on public.sales_rfps (company_id, record_no desc);
create index sales_rfps_buyer on public.sales_rfps (buyer_id) where buyer_id is not null;

alter table public.sales_import_batches
  add column kind text not null default 'ledger' check (kind in ('ledger', 'inquiry')),
  add column closed boolean not null default true;

-- ---------------------------------------------------------------- helpers
create function private.sales_levenshtein(a text, b text) returns integer
    language plpgsql immutable set search_path to '' as $$
declare x text := left(coalesce(a, ''), 120); y text := left(coalesce(b, ''), 120);
  lx integer := char_length(x); ly integer := char_length(y);
  prev integer[]; cur integer[]; i integer; j integer; v_cost integer;
begin
  if lx = 0 then return ly; end if;
  if ly = 0 then return lx; end if;
  prev := array(select generate_series(0, ly));
  for i in 1 .. lx loop
    cur := array[i];
    for j in 1 .. ly loop
      v_cost := case when substr(x, i, 1) = substr(y, j, 1) then 0 else 1 end;
      cur := cur || least(prev[j + 1] + 1, cur[j] + 1, prev[j] + v_cost);
    end loop;
    prev := cur;
  end loop;
  return prev[ly + 1];
end $$;

-- The name key without spaces or punctuation: what "probably the same company" compares.
create function private.sales_name_compact(p text) returns text
    language sql immutable set search_path to '' as $$
  select regexp_replace(private.sales_name_key(p), '[^[:alnum:]]', '', 'g');
$$;

-- The fixed custom fields of the inquiry register, created on the first inquiry import.
create function private.sales_inquiry_fields(p_company uuid) returns void
    language plpgsql security definer set search_path to '' as $$
declare f record; v_pos integer;
begin
  select coalesce(max(position), 0) into v_pos from public.sales_field_defs
   where company_id = p_company and entity = 'rfp';
  for f in select * from (values
      ('x_inq_no', 'شماره استعلام', 'Inquiry No.', 'text', '{}'::text[]),
      ('x_inq_type', 'مناقصه / پروژه', 'Tender / Project', 'select',
         array['Tender', 'Project', 'Estelam', 'Budget price']),
      ('x_inq_status_note', 'یادداشت وضعیت', 'Status note', 'text', '{}'::text[]),
      ('x_inq_flag', 'مسئول (Y/N)', 'In charge (Y/N)', 'text', '{}'::text[]),
      ('x_inq_date_text', 'تاریخ استعلام (متن)', 'Inquiry date (text)', 'text', '{}'::text[]),
      ('x_inq_offer_text', 'تاریخ پیشنهاد (متن)', 'Offer date (text)', 'text', '{}'::text[])
    ) t(key, label_fa, label_en, type, options) loop
    if not exists (select 1 from public.sales_field_defs
                    where company_id = p_company and entity = 'rfp' and key = f.key) then
      v_pos := v_pos + 1;
      insert into public.sales_field_defs (company_id, entity, key, label_fa, label_en, type, options, position)
        values (p_company, 'rfp', f.key, f.label_fa, f.label_en, f.type, f.options, v_pos);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- seed: Archived stage
create or replace function private.sales_ensure(p_company uuid) returns void
    language plpgsql security definer set search_path to '' as $$
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
end $$;

do $$
declare c uuid;
begin
  for c in select company_id from public.sales_flows where kind = 'bid' loop
    perform private.sales_ensure(c);
  end loop;
end $$;


-- ---------------------------------------------------------------- redefined whole, one change each
create or replace function private.sales_rfp_json(r public.sales_rfps, p_prices boolean) RETURNS jsonb
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
         'owner_name', (select full_name from public.profiles where id = r.owner_id),
         'flow_kind', (select kind from public.sales_flows where id = r.flow_id),
         'stage_kind', (select kind from public.sales_stages where id = r.stage_id),
         'imported', r.import_batch_id is not null,
         'next_deadline', (select min(d.due_on) from public.sales_deadlines d
                            where d.rfp_id = r.id and d.done_at is null));
$$;

create or replace function public.app_sales_save_stage(p_id uuid, p_flow uuid, p jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare v_company uuid := private.sales_company('sales_settings', 'edit');
  s public.sales_stages; v_id uuid := p_id; v_role uuid;
begin
  if p_id is null then
    if not exists (select 1 from public.sales_flows where id = p_flow and company_id = v_company) then
      raise exception 'sales: not found' using errcode = 'P0002';
    end if;
    s.flow_id := p_flow; s.kind := 'open'; s.required := '{}'; s.active := true;
    select coalesce(max(position), 0) + 1 into s.position from public.sales_stages where flow_id = p_flow;
  else
    select * into s from public.sales_stages where id = p_id and company_id = v_company for update;
    if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
  end if;
  if p ? 'name_fa' then s.name_fa := left(btrim(coalesce(p->>'name_fa', '')), 80); end if;
  if p ? 'name_en' then s.name_en := left(btrim(coalesce(p->>'name_en', '')), 80); end if;
  if p ? 'kind' then s.kind := p->>'kind'; end if;
  if p ? 'action' then s.action := nullif(p->>'action', ''); end if;
  if p ? 'active' then s.active := coalesce((p->>'active')::boolean, true); end if;
  if p ? 'owner_role_id' then
    v_role := private.sales_uuid(p->>'owner_role_id');
    if v_role is not null and not exists (select 1 from public.roles where id = v_role and company_id = v_company) then
      raise exception 'sales: invalid input' using errcode = '22023';
    end if;
    s.owner_role_id := v_role;
  end if;
  if p ? 'required' and jsonb_typeof(p->'required') = 'array' then
    s.required := coalesce((select array_agg(k) from jsonb_array_elements_text(p->'required') k
                             where k ~ '^[a-z][a-z0-9_]{0,40}$'), '{}');
  end if;
  s.name_fa := coalesce(nullif(s.name_fa, ''), nullif(s.name_en, ''));
  s.name_en := coalesce(nullif(s.name_en, ''), s.name_fa);
  if s.name_fa is null or s.kind is null
     or s.kind not in ('open', 'lost', 'no_bid', 'cancelled', 'done', 'archived')
     or (s.action is not null and s.action not in ('decide', 'quote', 'submit'))
     or (s.action is not null and s.kind <> 'open') then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.sales_stages (company_id, flow_id, position, name_fa, name_en, kind, action,
                                     owner_role_id, required, active)
      values (v_company, s.flow_id, s.position, s.name_fa, s.name_en, s.kind, s.action, s.owner_role_id,
              s.required, s.active) returning id into v_id;
  else
    update public.sales_stages set name_fa = s.name_fa, name_en = s.name_en, kind = s.kind,
      action = s.action, owner_role_id = s.owner_role_id, required = s.required, active = s.active
    where id = p_id;
  end if;
  -- New records start in the first open stage: a flow must keep one.
  if not exists (select 1 from public.sales_stages where flow_id = s.flow_id and active and kind = 'open') then
    raise exception 'sales: flow needs an open stage' using errcode = '22023';
  end if;
  return v_id;
exception when invalid_text_representation then
  raise exception 'sales: invalid input' using errcode = '22023';
end $_$;

create or replace function public.app_sales_bootstrap() RETURNS jsonb
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
      'items_edit', private.sales_can('project_items', 'edit')),
    'me', auth.uid(),
    'flows', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'kind', f.kind,
                'name_fa', f.name_fa, 'name_en', f.name_en) order by f.kind), '[]'::jsonb)
                from public.sales_flows f where f.company_id = v_company),
    'stages', (select coalesce(jsonb_agg((to_jsonb(s) - 'company_id') order by s.flow_id, s.position), '[]'::jsonb)
                 from public.sales_stages s where s.company_id = v_company),
    'fields', (select coalesce(jsonb_agg((to_jsonb(d) - 'company_id') order by d.entity, d.position, d.label_en), '[]'::jsonb)
                 from public.sales_field_defs d where d.company_id = v_company),
    'customers', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'kind', c.kind)
                    order by c.name), '[]'::jsonb) from public.sales_customers c where c.company_id = v_company),
    'people', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name,
                 'personnel_no', p.personnel_no,
                 'role_ids', (select coalesce(jsonb_agg(ur.role_id), '[]'::jsonb)
                                from public.user_roles ur where ur.user_id = p.id))
                 order by p.full_name), '[]'::jsonb)
                 from public.profiles p where p.company_id = v_company and p.active),
    'roles', (select coalesce(jsonb_agg(jsonb_build_object('id', ro.id, 'name', ro.name) order by ro.name), '[]'::jsonb)
                from public.roles ro where ro.company_id = v_company),
    'settings', (select to_jsonb(st) - 'company_id' from public.sales_settings st where st.company_id = v_company),
    'batches', case when private.sales_can('sales_settings') then
      (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'file_name', b.file_name,
                'created_at', b.created_at, 'created_count', b.created_count, 'updated_count', b.updated_count,
                'skipped_count', b.skipped_count, 'kind', b.kind, 'closed', b.closed,
                'records', (select count(*) from public.sales_rfps r where b.id = any (r.import_batches)),
                'untouched', (select count(*) from public.sales_rfps r
                               where b.id = any (r.import_batches) and not r.edited_after_import))
              order by b.created_at desc), '[]'::jsonb)
         from public.sales_import_batches b where b.company_id = v_company)
      else '[]'::jsonb end);
end $$;

-- Ledger import: appends its batch to import_batches on every row it writes (nothing else changed).
create or replace function public.app_sales_import(p_file text, p_rows jsonb, p_fields jsonb DEFAULT '[]'::jsonb, p_people jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_company uuid := private.sales_company('sales_settings', 'edit');
  v_flow uuid; v_batch uuid; v_row jsonb; v_num numeric; v_rec integer; v_created integer := 0;
  v_updated integer := 0; v_skipped integer := 0; r public.sales_rfps; v_buyer uuid; v_client uuid;
  v_stage uuid; v_status text; v_owner uuid; v_name text; v_custom jsonb; v_map jsonb := '{}';
  v_header text; v_key text; v_try integer; v_b jsonb; v_id uuid; v_title text; v_form text;
  v_kind text; v_seq integer; v_bstatus text; v_reasons jsonb := '[]';
  -- Values a caller may not edit by hand are not written by their import either.
  v_prices boolean := private.sales_can('sales_prices'); v_bonds boolean := private.sales_can('sales_bonds');
begin
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
        in_charge_text = case when v_owner is not null then null else coalesce(left(v_name, 200), in_charge_text) end,
        currency = coalesce(case when v_row->>'currency' ~ '^[A-Z]{3}$' then v_row->>'currency' end, currency),
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
                  case when v_row->>'currency' ~ '^[A-Z]{3}$' then v_row->>'currency' end,
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
    'skipped', v_skipped, 'skipped_rows', v_reasons);
end $_$;

-- ---------------------------------------------------------------- batch removal
-- A row goes only when this batch is the only one that wrote it and nobody edited it here.
-- Rows written by other batches too stay (this batch steps out of their import_batches); kept counts
-- them and the edited rows that only this batch wrote.
create or replace function public.app_sales_remove_batch(p_batch uuid) returns jsonb
    language plpgsql security definer set search_path to '' as $$
declare v_company uuid := private.sales_company('sales_settings', 'edit'); v_deleted integer; v_kept integer;
  v_created timestamptz;
begin
  select created_at into v_created from public.sales_import_batches where id = p_batch and company_id = v_company;
  if not found then
    raise exception 'sales: not found' using errcode = 'P0002';
  end if;
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
     and not exists (select 1 from public.sales_rfps r where r.buyer_id = c.id or r.client_id = c.id);
  if not exists (select 1 from public.sales_rfps where company_id = v_company
                  and (p_batch = any (import_batches) or import_batch_id = p_batch)) then
    delete from public.sales_import_batches where id = p_batch;
  end if;
  return jsonb_build_object('deleted', v_deleted, 'kept', v_kept);
end $$;

-- ---------------------------------------------------------------- the inquiry import (16.2, 16.3)
create function public.app_sales_import_inquiries(p_batch uuid, p_file text, p_rows jsonb,
    p_people jsonb default '{}'::jsonb, p_cutoff date default null, p_last boolean default false)
    returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_company uuid := private.sales_company('sales_settings', 'edit');
  v_prices boolean := private.sales_can('sales_prices');
  v_cutoff date := coalesce(p_cutoff, (private.sales_today() - interval '6 months')::date);
  v_batch uuid; b public.sales_import_batches; v_bid uuid; v_contract uuid;
  v_row jsonb; v_num numeric; v_rec integer; r public.sales_rfps; v_existed boolean;
  v_created integer := 0; v_updated integer := 0; v_skipped integer := 0; v_reasons jsonb := '[]';
  v_by jsonb := '{"won":0,"lost":0,"no_bid":0,"cancelled":0,"open":0,"archived":0}';
  v_origin text; v_fill boolean; v_edited boolean; v_classify boolean;
  v_phrase text; v_wp numeric; v_lp numeric; v_recv date; v_sub date; v_class text;
  v_tflow uuid; v_tkind text; v_tcode text; v_stage uuid; v_result text; v_decision text;
  v_buyer uuid; v_owner uuid; v_name text; v_title text; v_desc text; v_ref text; v_price numeric;
  v_cur text; v_custom jsonb; v_type text; v_new_stage uuid; v_new_kind text;
begin
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
          in_charge_text = coalesce(in_charge_text,
            case when coalesce(owner_id, v_owner) is null then left(v_name, 200) end),
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
          in_charge_text = case when coalesce(v_owner, owner_id) is not null then null
                                else coalesce(left(v_name, 200), in_charge_text) end,
          currency = coalesce(v_cur, currency), our_price = coalesce(v_price, our_price),
          custom = custom || v_custom,
          -- Result and stage follow the file until someone works on the record here.
          flow_id = case when v_classify then v_tflow else flow_id end,
          stage_id = case when v_classify then v_stage else stage_id end,
          bid_result = case when v_classify then v_result else bid_result end,
          bid_decision = case when v_classify then v_decision else bid_decision end,
          result_at = case when not v_classify then result_at
                           when v_result is null then null else coalesce(result_at, now()) end,
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
    'skipped', v_skipped, 'skipped_rows', v_reasons, 'by_result', v_by);
end $$;

-- Record numbers by origin, for the import preview: app (made here), ledger (contract-flow or
-- ledger-made: only empty fields get filled), inquiry (made by an inquiry import, still a bid).
create function public.app_sales_record_numbers() returns jsonb
    language plpgsql stable security definer set search_path to '' as $$
declare v_company uuid := private.sales_company('sales_settings', 'edit');
begin
  return (select jsonb_build_object(
      'app', coalesce(jsonb_agg(r.record_no order by r.record_no) filter (where o = 'app'), '[]'::jsonb),
      'ledger', coalesce(jsonb_agg(r.record_no order by r.record_no) filter (where o = 'ledger'), '[]'::jsonb),
      'inquiry', coalesce(jsonb_agg(r.record_no order by r.record_no) filter (where o = 'inquiry'), '[]'::jsonb))
    from (select x.record_no,
                 case when x.import_batch_id is null and cardinality(x.import_batches) = 0 then 'app'
                      when coalesce(b.kind, 'ledger') = 'inquiry' and f.kind = 'bid' then 'inquiry'
                      else 'ledger' end as o
            from public.sales_rfps x
            join public.sales_flows f on f.id = x.flow_id
            left join public.sales_import_batches b on b.id = x.import_batch_id
           where x.company_id = v_company) r);
end $$;

-- ---------------------------------------------------------------- records list, paged (16.4)
create function public.app_sales_list_page(p jsonb default '{}'::jsonb) returns jsonb
    language plpgsql stable security definer set search_path to '' as $$
declare v_company uuid := private.sales_company(); v_prices boolean := private.sales_can('sales_prices', 'read');
  v_state text := coalesce(nullif(p->>'state', ''), 'open'); v_flow text := nullif(p->>'flow', '');
  v_stage uuid := private.sales_uuid(p->>'stage'); v_owner uuid := private.sales_uuid(p->>'owner');
  v_buyer uuid := private.sales_uuid(p->>'buyer'); v_q text := nullif(btrim(coalesce(p->>'q', '')), '');
  v_limit integer; v_pat text; v_no integer; v_total integer; v_rows jsonb;
begin
  if jsonb_typeof(coalesce(p, '{}'::jsonb)) <> 'object' or v_state not in ('open', 'closed', 'all')
     or (v_flow is not null and v_flow not in ('bid', 'contract')) then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  v_limit := least(500, greatest(1, coalesce(private.sales_num(p->>'limit')::integer, 500)));
  if v_q is not null then
    v_pat := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    if v_q ~ '^\d{1,9}$' then v_no := v_q::integer; end if;
  end if;

  with f as (
    select r.id, r.record_no
      from public.sales_rfps r
      join public.sales_stages s on s.id = r.stage_id
      join public.sales_flows fl on fl.id = r.flow_id
      left join public.sales_customers b on b.id = r.buyer_id
      left join public.sales_customers c on c.id = r.client_id
      left join public.profiles o on o.id = r.owner_id
     where r.company_id = v_company
       and (v_state = 'all' or (v_state = 'open') = (s.kind = 'open'))
       and (v_flow is null or fl.kind = v_flow)
       and (v_stage is null or r.stage_id = v_stage)
       and (v_owner is null or r.owner_id = v_owner)
       and (v_buyer is null or r.buyer_id = v_buyer)
       and (v_q is null or r.record_no = v_no
            or r.title ilike v_pat or r.customer_ref ilike v_pat or r.description ilike v_pat
            or r.in_charge_text ilike v_pat or b.name ilike v_pat or c.name ilike v_pat
            or o.full_name ilike v_pat)
  ), page as (select id from f order by record_no desc limit v_limit)
  select (select count(*) from f),
         coalesce((select jsonb_agg(private.sales_rfp_json(r, v_prices) order by r.record_no desc)
                     from public.sales_rfps r join page on page.id = r.id), '[]'::jsonb)
    into v_total, v_rows;
  return jsonb_build_object('rows', v_rows, 'total', v_total, 'truncated', v_total > v_limit);
end $$;

-- ---------------------------------------------------------------- customer lookup (16.7)
create function public.app_sales_add_customer(p jsonb) returns jsonb
    language plpgsql security definer set search_path to '' as $$
declare v_company uuid := private.sales_company('sales', 'edit'); v_name text; v_kind text; v_key text; v_id uuid;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  v_name := left(regexp_replace(btrim(coalesce(p->>'name', '')), '\s+', ' ', 'g'), 200);
  v_kind := nullif(p->>'kind', '');
  v_key := private.sales_name_key(v_name);
  if v_key = '' or (v_kind is not null and v_kind not in ('government', 'contractor')) then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  insert into public.sales_customers (company_id, name, name_key, kind)
    values (v_company, v_name, v_key, v_kind)
    on conflict (company_id, name_key) do nothing returning id into v_id;
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'existed', false, 'name', v_name, 'kind', v_kind);
  end if;
  select id, name, kind into v_id, v_name, v_kind from public.sales_customers
   where company_id = v_company and name_key = v_key;
  return jsonb_build_object('id', v_id, 'existed', true, 'name', v_name, 'kind', v_kind);
end $$;

-- Existing customers that are probably the same company: same key, or 1-2 letters apart on the
-- name without spaces or punctuation (<= 1 for 5-9 letters, <= 2 from 10; shorter: equal only).
create function public.app_sales_similar_customers(p_name text) returns jsonb
    language plpgsql stable security definer set search_path to '' as $$
declare v_company uuid := private.sales_company(); v_key text := private.sales_name_compact(p_name);
  v_len integer := char_length(private.sales_name_compact(p_name)); v_max integer;
begin
  if v_len = 0 then return '[]'::jsonb; end if;
  v_max := case when v_len >= 10 then 2 when v_len >= 5 then 1 else 0 end;
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'kind', x.kind,
                      'distance', x.d) order by x.d, x.name)
    from (select c.id, c.name, c.kind, private.sales_levenshtein(private.sales_name_compact(c.name), v_key) as d
            from public.sales_customers c
           where c.company_id = v_company
             and abs(char_length(private.sales_name_compact(c.name)) - v_len) <= v_max
           order by 4, c.name limit 200) x
    where x.d <= v_max limit 5), '[]'::jsonb);
end $$;

-- ================================================================ grants
revoke all on function private.sales_levenshtein(text, text) from public, anon, authenticated;
revoke all on function private.sales_name_compact(text) from public, anon, authenticated;
revoke all on function private.sales_inquiry_fields(uuid) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'app_sales_import_inquiries(uuid, text, jsonb, jsonb, date, boolean)', 'app_sales_record_numbers()',
    'app_sales_list_page(jsonb)', 'app_sales_add_customer(jsonb)', 'app_sales_similar_customers(text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
