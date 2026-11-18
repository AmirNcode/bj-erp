-- FR-94 §16.8: an imported result was stamped with the import time (now()), so every old
-- win counted as a sale of this year. The inquiry import now dates a result by the file
-- (offer date, else received date); results the import set earlier are re-dated the same way.
-- Results recorded by a person (result_by set) are left alone.

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
    'skipped', v_skipped, 'skipped_rows', v_reasons, 'by_result', v_by);
end $$;

update public.sales_rfps r
   set result_at = coalesce(r.submitted_on, r.received_on)::timestamptz
 where r.bid_result is not null
   and r.result_by is null
   and exists (select 1 from public.sales_import_batches b
                where b.id = any (r.import_batches) and b.kind = 'inquiry');
