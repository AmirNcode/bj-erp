-- Sales CEO feedback, task 3: currencies are managed per company in Settings (spec 2026-11-20 section 4).
-- sales_currencies is function-only. The records keep their codes; the old ^[A-Z]{3}$ checks become a
-- length/charset check and the write functions validate against the company's active list instead.

create table public.sales_currencies (
  company_id uuid not null references public.companies(id) on delete cascade,
  code       text not null check (code ~ '^[A-Za-z0-9]{1,10}$'),
  name_fa    text not null check (char_length(name_fa) between 1 and 40),
  name_en    text not null check (char_length(name_en) between 1 and 40),
  symbol     text check (symbol is null or char_length(symbol) between 1 and 6),
  decimals   integer not null default 0 check (decimals between 0 and 2),
  active     boolean not null default true,
  position   integer not null default 0,
  primary key (company_id, code)
);
comment on table public.sales_currencies is
  'FR-94: company-managed currency list (display names, symbol, decimals). Functions only.';
alter table public.sales_currencies enable row level security;
revoke all on public.sales_currencies from public, anon, authenticated;

alter table public.sales_rfps drop constraint sales_rfps_currency_check;
alter table public.sales_rfps add constraint sales_rfps_currency_check check (currency ~ '^[A-Za-z0-9]{1,10}$');
alter table public.sales_bonds drop constraint sales_bonds_currency_check;
alter table public.sales_bonds add constraint sales_bonds_currency_check check (currency ~ '^[A-Za-z0-9]{1,10}$');

-- True when the code is null, unchanged (p_old), or an active code of the company.
create function private.sales_currency_ok(p_company uuid, p_code text, p_old text default null) returns boolean
  language sql stable security definer set search_path = '' as $$
  select p_code is null or p_code is not distinct from p_old
      or exists (select 1 from public.sales_currencies c
                  where c.company_id = p_company and c.code = p_code and c.active);
$$;
revoke all on function private.sales_currency_ok(uuid, text, text) from public, anon, authenticated;

create or replace function private.sales_ensure(p_company uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
  -- The company's currency list (FR-94 CEO feedback): today's five, managed in Settings afterwards.
  insert into public.sales_currencies (company_id, code, name_fa, name_en, symbol, decimals, position) values
    (p_company, 'IRR', 'ریال', 'Rial', null, 0, 1),
    (p_company, 'EUR', 'یورو', 'Euro', '€', 2, 2),
    (p_company, 'USD', 'دلار', 'US dollar', '$', 2, 3),
    (p_company, 'AED', 'درهم', 'UAE dirham', null, 2, 4),
    (p_company, 'CNY', 'یوان', 'Chinese yuan', null, 2, 5)
    on conflict do nothing;
end $$;

-- Companies that already exist get the five currencies too (idempotent).
select private.sales_ensure(id) from public.companies;

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
  if p ? 'buyer' then
    v_new.buyer_id := private.sales_customer(v_company, p->>'buyer', p->>'buyer_kind');
  end if;
  if p ? 'client' then
    v_new.client_id := private.sales_customer(v_company, p->>'client', null);
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

create or replace function public.app_sales_save_bond(p_rfp uuid, p_id uuid, p jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_company uuid := private.sales_company('sales_bonds', 'edit');
  r public.sales_rfps := private.sales_rfp(p_rfp, v_company);
  b public.sales_bonds; n public.sales_bonds; v_patch jsonb;
begin
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_patch from jsonb_each(coalesce(p, '{}'))
   where key = any (array['kind','seq','percent','form','amount','currency','bank','number',
                          'issued_on','expires_on','status','note']);
  if p_id is null then
    b.id := gen_random_uuid(); b.company_id := v_company; b.rfp_id := r.id;
    b.kind := 'bid'; b.seq := 1; b.status := 'needed'; b.imported := false; b.currency := r.currency;
  else
    select * into b from public.sales_bonds where id = p_id and rfp_id = r.id for update;
    if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
  end if;
  begin
    n := jsonb_populate_record(b, v_patch);
    if not private.sales_currency_ok(v_company, n.currency, b.currency) then
      raise exception 'sales: invalid input' using errcode = '22023';
    end if;
    if p_id is null then
      insert into public.sales_bonds select n.*;
    else
      update public.sales_bonds set kind = n.kind, seq = n.seq, percent = n.percent, form = n.form,
        amount = n.amount, currency = n.currency, bank = n.bank, number = n.number,
        issued_on = n.issued_on, expires_on = n.expires_on, status = n.status, note = n.note
      where id = p_id;
    end if;
  exception when others then
    raise exception 'sales: invalid input' using errcode = '22023';
  end;
  perform private.sales_touch(r.id, 'finance', jsonb_build_object('what', 'guarantee', 'kind', n.kind,
    'action', case when p_id is null then 'added' else 'changed' end));
  return n.id;
end $$;

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
    'skipped', v_skipped, 'skipped_rows', v_reasons);
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
         from public.sales_import_batches b where b.company_id = v_company)
      else '[]'::jsonb end);
end $$;

create function public.app_sales_save_currency(p_code text, p jsonb) returns void
  language plpgsql security definer set search_path = '' as $$
declare v_company uuid := private.sales_company('sales_settings', 'edit');
  c public.sales_currencies; v_new boolean;
begin
  if p_code is null or p_code !~ '^[A-Za-z0-9]{1,10}$' or p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  select * into c from public.sales_currencies where company_id = v_company and code = p_code for update;
  v_new := not found;
  if v_new then
    c.company_id := v_company; c.code := p_code; c.active := true; c.decimals := 0;
    c.position := (select coalesce(max(position), 0) + 1 from public.sales_currencies where company_id = v_company);
  end if;
  begin
    if p ? 'name_fa' then c.name_fa := btrim(p->>'name_fa'); end if;
    if p ? 'name_en' then c.name_en := btrim(p->>'name_en'); end if;
    if p ? 'symbol' then c.symbol := nullif(btrim(coalesce(p->>'symbol', '')), ''); end if;
    if p ? 'decimals' then c.decimals := (p->>'decimals')::integer; end if;
    if p ? 'active' then c.active := (p->>'active')::boolean; end if;
    if p ? 'position' then c.position := (p->>'position')::integer; end if;
    if v_new then
      insert into public.sales_currencies select c.*;
    else
      update public.sales_currencies set name_fa = c.name_fa, name_en = c.name_en, symbol = c.symbol,
        decimals = c.decimals, active = c.active, position = c.position
       where company_id = v_company and code = p_code;
    end if;
  exception when others then
    raise exception 'sales: invalid input' using errcode = '22023';
  end;
end $$;

create function public.app_sales_delete_currency(p_code text) returns void
  language plpgsql security definer set search_path = '' as $$
declare v_company uuid := private.sales_company('sales_settings', 'edit');
begin
  perform 1 from public.sales_currencies where company_id = v_company and code = p_code for update;
  if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.sales_rfps where company_id = v_company and currency = p_code)
     or exists (select 1 from public.sales_bonds where company_id = v_company and currency = p_code) then
    raise exception 'sales: in use' using errcode = '22023';
  end if;
  delete from public.sales_currencies where company_id = v_company and code = p_code;
end $$;

revoke all on function public.app_sales_save_currency(text, jsonb) from public, anon;
grant execute on function public.app_sales_save_currency(text, jsonb) to authenticated;
revoke all on function public.app_sales_delete_currency(text) from public, anon;
grant execute on function public.app_sales_delete_currency(text) to authenticated;
