-- =============================================================================
-- Migration: 20261117100000_sales_stage_pages.sql
-- Purpose  : ERP › Sales stage pages (docs/specs/2026-11-17-sales-stage-pages-design.md).
--   app_sales_save_record takes the stage page an edit was made on (p_stage, optional, so
--   old callers keep working) and its `edit` event now carries old -> new values
--   (`changes`), price fields as {field, hidden} only, plus side effects (`side`).
--   decision_reason / result_reason become editable by `sales_decide` holders.
--   Redefined whole from 20261116200100 with only those changes.
-- =============================================================================

drop function public.app_sales_save_record(uuid, jsonb);

create or replace function public.app_sales_save_record(p_id uuid, p jsonb, p_stage uuid default null) returns uuid
    language plpgsql security definer set search_path to '' as $$
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
    v_patch := jsonb_set(v_patch, '{custom}', coalesce((
      select jsonb_object_agg(key, value) from jsonb_each(v_patch->'custom')
       where key ~ '^x_[a-z0-9_]{1,38}$' and jsonb_typeof(value) <> 'null'
         and value <> '""'::jsonb), '{}'::jsonb));
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

  begin
    v_new := jsonb_populate_record(v_old, v_patch);
  exception when others then
    raise exception 'sales: invalid input' using errcode = '22023';
  end;
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
end $$;

revoke all on function public.app_sales_save_record(uuid, jsonb, uuid) from public, anon;
grant execute on function public.app_sales_save_record(uuid, jsonb, uuid) to authenticated;
