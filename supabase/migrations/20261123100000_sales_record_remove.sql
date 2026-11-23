-- ERP > Sales: the admin can archive, soft-delete and restore a whole record
-- (spec docs/specs/2026-11-23-sales-record-delete-archive-design.md, plan 2026-11-23-...).
--   * sales_rfps.deleted_at / deleted_by; events kinds archived / deleted / restored;
--   * contract flow gets an Archived stage (private.sales_ensure; existing companies are re-seeded);
--   * private.sales_rfp refuses deleted rows unless p_include_deleted (blocks every per-record read
--     and write in one place); private.sales_is_admin(); caps.remove_records;
--   * app_sales_archive / app_sales_delete_record / app_sales_restore_record (admin only);
--   * every list / report / metric / customer / deadline / number / item / price reader skips deleted rows.
-- Readers changed (deleted_at is null): app_sales_list, app_sales_list_page (+ state 'deleted', admin only),
--   app_sales_report, app_sales_metrics, private.sales_customer_rows, app_sales_customer,
--   app_sales_deadlines, app_sales_record_numbers, app_sales_find_node, app_sales_price_history,
--   app_sales_people_to_match, app_sales_match_person, app_sales_file_get (admin may still read a deleted
--   record's files), app_sales_record (admin may open a deleted record).
-- Left unfiltered on purpose: app_sales_delete_currency / app_sales_delete_product / app_sales_products
--   used_count (in-use checks), app_sales_merge_customers (re-points deleted rows too),
--   app_sales_remove_batch (hard-removes untouched rows of its batch, deleted or not),
--   app_sales_bootstrap batches counts, app_sales_save_settings (record numbers stay taken).
-- Delete logs its event directly (not private.sales_touch): it must not bump updated_at, flip
--   edited_after_import (a deleted untouched import row stays removable with its batch) or resync deadlines.
-- Archive uses private.sales_touch: the stage change closes the auto deadlines through sales_sync_deadlines.

-- ---------------------------------------------------------------- columns, index, event kinds
alter table public.sales_rfps
  add column deleted_at timestamptz,
  add column deleted_by uuid references auth.users(id) on delete set null;
create index sales_rfps_live_idx on public.sales_rfps (company_id, record_no) where deleted_at is null;

alter table public.sales_events drop constraint sales_events_kind_check;
alter table public.sales_events add constraint sales_events_kind_check
  check (kind = any (array['created','edit','stage','decision','result','comment','import','items','finance','file',
                           'archived','deleted','restored']));

-- ---------------------------------------------------------------- core helpers
drop function private.sales_rfp(uuid, uuid, boolean);
create function private.sales_rfp(p_id uuid, p_company uuid, p_lock boolean default true,
                                  p_include_deleted boolean default false)
  returns public.sales_rfps language plpgsql security definer set search_path to '' as $$
declare r public.sales_rfps;
begin
  if p_lock then
    select * into r from public.sales_rfps where id = p_id and company_id = p_company for update;
  else
    select * into r from public.sales_rfps where id = p_id and company_id = p_company;
  end if;
  if not found or (r.deleted_at is not null and not p_include_deleted) then
    raise exception 'sales: not found' using errcode = 'P0002';
  end if;
  return r;
end $$;
revoke all on function private.sales_rfp(uuid, uuid, boolean, boolean) from public;

create function private.sales_is_admin() returns boolean
  language sql stable security definer set search_path to '' as $$
  select coalesce(private.has_role(auth.uid(), 'admin') and not private.is_test_account(auth.uid()), false);
$$;
revoke all on function private.sales_is_admin() from public;

CREATE OR REPLACE FUNCTION private.sales_rfp_json(r sales_rfps, p_prices boolean)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
         'deleted_by_name', (select full_name from public.profiles where id = r.deleted_by),
         'next_deadline', (select min(d.due_on) from public.sales_deadlines d
                            where d.rfp_id = r.id and d.done_at is null));
$function$;
CREATE OR REPLACE FUNCTION private.sales_ensure(p_company uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;
do $$
declare c uuid;
begin
  for c in select id from public.companies loop perform private.sales_ensure(c); end loop;
end $$;

CREATE OR REPLACE FUNCTION public.app_sales_bootstrap()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      'remove_records', private.sales_is_admin()),
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
end $function$;
CREATE OR REPLACE FUNCTION public.app_sales_record(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_company uuid := private.sales_company();
  r public.sales_rfps := private.sales_rfp(p_id, v_company, false, private.sales_is_admin());
  v_prices boolean := private.sales_can('sales_prices', 'read');
  v_bonds boolean := private.sales_can('sales_bonds', 'read');
  v_items boolean := private.sales_can('project_items', 'read');
begin
  return jsonb_build_object(
    'record', private.sales_rfp_json(r, v_prices),
    'nodes', (select coalesce(jsonb_agg(
                (to_jsonb(n) - array['company_id','child_seq','rfp_id'])
                || case when v_prices then jsonb_build_object('unit_price',
                     (select ip.unit_price from public.sales_item_prices ip where ip.node_id = n.id))
                   else '{}'::jsonb end
                order by n.depth, n.seq), '[]'::jsonb)
                from public.project_nodes n where n.rfp_id = p_id and v_items),
    'bonds', (select coalesce(jsonb_agg(
                case when v_bonds then to_jsonb(b) - array['company_id','rfp_id']
                     else jsonb_build_object('id', b.id, 'kind', b.kind, 'seq', b.seq, 'status', b.status) end
                order by b.kind, b.seq), '[]'::jsonb)
                from public.sales_bonds b where b.rfp_id = p_id),
    'deadlines', (select coalesce(jsonb_agg((to_jsonb(d) - array['company_id','rfp_id'])
                    || jsonb_build_object('responsible_name',
                         (select full_name from public.profiles where id = d.responsible_id))
                    order by d.due_on, d.created_at), '[]'::jsonb)
                    from public.sales_deadlines d where d.rfp_id = p_id),
    'documents', (select coalesce(jsonb_agg((to_jsonb(dc) - array['company_id','rfp_id'])
                    || jsonb_build_object('assignee_name',
                         (select full_name from public.profiles where id = dc.assignee_id))
                    order by dc.position, dc.name), '[]'::jsonb)
                    from public.sales_documents dc where dc.rfp_id = p_id),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'at', e.at, 'kind', e.kind,
                 'body', e.body, 'actor_name', (select full_name from public.profiles where id = e.actor_id))
                 order by e.at desc), '[]'::jsonb)
                 from public.sales_events e where e.rfp_id = p_id),
    'files', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', f.id, 'stage_id', f.stage_id, 'name', f.name, 'size_bytes', f.size_bytes,
                 'uploaded_by', f.uploaded_by,
                 'uploader_name', (select full_name from public.profiles where id = f.uploaded_by),
                 'uploaded_at', f.uploaded_at,
                 'can_delete', (f.uploaded_by = auth.uid() or private.sales_can('sales_settings'))
                               and private.sales_can('sales', 'edit')
                               and ((select s.kind from public.sales_stages s where s.id = r.stage_id) = 'open'
                                    or private.sales_can('sales_decide')))
                 order by f.uploaded_at, f.name), '[]'::jsonb)
                 from public.sales_files f where f.rfp_id = p_id and f.status = 'ready'))
    || case when v_bonds then jsonb_build_object('payments',
         (select coalesce(jsonb_agg(to_jsonb(pm) - array['company_id','rfp_id'] order by pm.seq), '[]'::jsonb)
            from public.sales_payments pm where pm.rfp_id = p_id)) else '{}'::jsonb end
    || case when v_prices then jsonb_build_object('quote_revisions',
         (select coalesce(jsonb_agg(distinct q.revision), '[]'::jsonb)
            from public.sales_quote_lines q where q.rfp_id = p_id)) else '{}'::jsonb end;
end $function$;
CREATE OR REPLACE FUNCTION public.app_sales_list()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_company uuid := private.sales_company(); v_prices boolean := private.sales_can('sales_prices', 'read');
begin
  return (select coalesce(jsonb_agg(private.sales_rfp_json(r, v_prices) order by r.record_no desc), '[]'::jsonb)
            from public.sales_rfps r where r.company_id = v_company and r.deleted_at is null);
end $function$;
CREATE OR REPLACE FUNCTION public.app_sales_list_page(p jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_company uuid := private.sales_company(); v_prices boolean := private.sales_can('sales_prices', 'read');
  v_state text := coalesce(nullif(p->>'state', ''), 'open'); v_flow text := nullif(p->>'flow', '');
  v_stage uuid := private.sales_uuid(p->>'stage'); v_owner uuid := private.sales_uuid(p->>'owner');
  v_buyer uuid := private.sales_uuid(p->>'buyer'); v_q text := nullif(btrim(coalesce(p->>'q', '')), '');
  v_sort text := coalesce(nullif(p->>'sort', ''), 'record_no'); v_dir text := nullif(p->>'dir', '');
  v_limit integer; v_pat text; v_no integer; v_total integer; v_rows jsonb;
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
    v_pat := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
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
            or r.title ilike v_pat or r.customer_ref ilike v_pat or r.description ilike v_pat
            or r.in_charge_text ilike v_pat or b.name ilike v_pat or c.name ilike v_pat
            or o.full_name ilike v_pat)
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
end $function$;
CREATE OR REPLACE FUNCTION public.app_sales_report()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
          'buyer_name', b.name, 'result_at', r.result_at, 'bid_result', r.bid_result)), '[]'::jsonb)
      from public.sales_rfps r left join public.sales_customers b on b.id = r.buyer_id
     where r.company_id = v_company and r.deleted_at is null and r.bid_decision = 'bid' and r.bid_result is not null
       and r.import_batch_id is null and cardinality(r.import_batches) = 0));
end $function$;
CREATE OR REPLACE FUNCTION public.app_sales_metrics(p_customer uuid, p_year_start date, p_prev_year_start date, p jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_company uuid := private.sales_company('sales', 'read');
  v_prices boolean := private.sales_can('sales_prices', 'read');
  v_kind text; v_out jsonb;
begin
  p := coalesce(p, '{}'::jsonb);
  perform private.sales_filter_check(p);
  v_kind := nullif(p->>'kind', '');
  if p_year_start is null or p_prev_year_start is null or p_prev_year_start >= p_year_start then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  if p_customer is not null and not exists (
       select 1 from public.sales_customers where id = p_customer and company_id = v_company) then
    raise exception 'sales: not found' using errcode = 'P0002';
  end if;

  with rf as (
    select r.buyer_id, r.received_on, r.bid_result, r.currency, r.our_price,
           s.kind as skind, fl.kind as fkind,
           (r.bid_result = 'won' or (fl.kind = 'contract' and s.kind <> 'cancelled')) as is_won,
           coalesce(r.total_value, r.our_price) as val,
           coalesce(r.order_date, r.result_at::date, r.submitted_on, r.received_on) as sale_date
      from public.sales_rfps r
      join public.sales_stages s on s.id = r.stage_id
      join public.sales_flows fl on fl.id = r.flow_id
      left join public.sales_customers b on b.id = r.buyer_id
     where r.company_id = v_company and r.deleted_at is null
       and (v_kind is null or b.kind = v_kind)
       and private.sales_rec_ok(p, r.received_on, r.bid_result, r.bid_decision, s.kind, r.owner_id)),
  mine as (select * from rf where p_customer is null or buyer_id = p_customer),
  b as (
    select count(*) as projects, count(*) filter (where skind = 'open') as active,
           count(*) filter (where bid_result = 'won') as won, count(*) filter (where bid_result = 'lost') as lost,
           count(distinct buyer_id) as customers, max(sale_date) filter (where is_won) as last_sale
      from mine),
  m as (
    select currency,
           sum(val) filter (where is_won) as a,
           sum(val) filter (where is_won and sale_date >= p_year_start) as y,
           sum(val) filter (where is_won and sale_date >= p_prev_year_start and sale_date < p_year_start) as py,
           sum(our_price) filter (where fkind = 'bid' and skind = 'open') as pl
      from mine where currency is not null group by currency),
  al as (select currency, sum(val) as a from rf where is_won and currency is not null group by currency),
  nc as (
    select count(*) as n from (
      select x.buyer_id from public.sales_rfps x
       where x.company_id = v_company and x.deleted_at is null and x.buyer_id in (select buyer_id from mine where buyer_id is not null)
       group by x.buyer_id having min(x.received_on) >= p_year_start) t)
  select jsonb_build_object('projects', b.projects, 'active', b.active, 'won', b.won, 'lost', b.lost,
           'decided', b.won + b.lost,
           'win_rate', case when b.won + b.lost > 0 then round(b.won::numeric / (b.won + b.lost), 4) end)
      || case when p_customer is null
              then jsonb_build_object('customers', b.customers, 'new_customers', (select n from nc))
              else jsonb_build_object('last_sale_on', b.last_sale) end
      || case when v_prices then
           jsonb_build_object(
             'sales_all', coalesce((select jsonb_object_agg(currency, a) from m where a is not null), '{}'::jsonb),
             'sales_ytd', coalesce((select jsonb_object_agg(currency, y) from m where y is not null), '{}'::jsonb),
             'sales_prev_year', coalesce((select jsonb_object_agg(currency, py) from m where py is not null), '{}'::jsonb),
             'pipeline', coalesce((select jsonb_object_agg(currency, pl) from m where pl is not null), '{}'::jsonb))
           || case when p_customer is not null then jsonb_build_object('share',
                coalesce((select jsonb_object_agg(m.currency, round(m.a / al.a, 4))
                            from m join al on al.currency = m.currency where m.a is not null and al.a > 0), '{}'::jsonb))
              else '{}'::jsonb end
         else '{}'::jsonb end
    into v_out from b;
  return v_out;
end $function$;
CREATE OR REPLACE FUNCTION private.sales_customer_rows(p_company uuid, p_prices boolean, p_id uuid DEFAULT NULL::uuid, p_f jsonb DEFAULT '{}'::jsonb)
 RETURNS SETOF jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      'id', c.id, 'name', c.name, 'kind', c.kind,
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
    and (not private.sales_filtered(p_f) or coalesce(a.records, 0) > 0)
  order by c.name;
$function$;
CREATE OR REPLACE FUNCTION public.app_sales_customer(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_company uuid := private.sales_company('sales', 'read'); v_row jsonb;
begin
  select x into v_row from private.sales_customer_rows(v_company, private.sales_can('sales_prices', 'read'), p_id) x;
  if v_row is null then raise exception 'sales: not found' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'customer', v_row,
    'per_year', (select coalesce(jsonb_agg(jsonb_build_object('year', y, 'total', total, 'won', won, 'lost', lost)
                                           order by y desc), '[]'::jsonb)
                   from (select extract(year from received_on)::integer as y, count(*) as total,
                                count(*) filter (where bid_result = 'won') as won,
                                count(*) filter (where bid_result = 'lost') as lost
                           from public.sales_rfps
                          where company_id = v_company and deleted_at is null and buyer_id = p_id and received_on is not null
                          group by 1 order by 1 desc limit 12) t),
    'client_of', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'count', n)
                                            order by n desc, name), '[]'::jsonb)
                    from (select b.id, b.name, count(*) as n
                            from public.sales_rfps r join public.sales_customers b on b.id = r.buyer_id
                           where r.company_id = v_company and r.deleted_at is null and r.client_id = p_id
                           group by b.id, b.name) t),
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
end $function$;
CREATE OR REPLACE FUNCTION public.app_sales_deadlines(p_include_done boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_company uuid := private.sales_company();
begin
  return (select coalesce(jsonb_agg(
            (to_jsonb(d) - array['company_id'])
            || jsonb_build_object('record_no', r.record_no, 'title', r.title, 'stage_id', r.stage_id,
                 'buyer_name', (select name from public.sales_customers where id = r.buyer_id),
                 'responsible_name', (select full_name from public.profiles where id = d.responsible_id))
            order by d.due_on, r.record_no), '[]'::jsonb)
            from public.sales_deadlines d join public.sales_rfps r on r.id = d.rfp_id
           where d.company_id = v_company and r.deleted_at is null and (p_include_done or d.done_at is null));
end $function$;
CREATE OR REPLACE FUNCTION public.app_sales_record_numbers()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
           where x.company_id = v_company and x.deleted_at is null) r);
end $function$;
CREATE OR REPLACE FUNCTION public.app_sales_find_node(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_company uuid := private.sales_company(); v_code text; v_out jsonb;
begin
  v_code := regexp_replace(upper(coalesce(p_code, '')), '^\s*BJ', '');
  v_code := regexp_replace(v_code, '[^0-9-]', '', 'g');
  if v_code !~ '^\d{1,9}(-\d{1,9})*$' then return null; end if;
  select string_agg((seg::bigint)::text, '-' order by ord) into v_code
    from unnest(string_to_array(v_code, '-')) with ordinality as t(seg, ord);
  select jsonb_build_object('rfp_id', n.rfp_id, 'node_id', n.id) into v_out
    from public.project_nodes n
   where n.company_id = v_company and n.code = v_code and private.sales_can('project_items', 'read')
     and not exists (select 1 from public.sales_rfps x where x.id = n.rfp_id and x.deleted_at is not null);
  if v_out is null and v_code ~ '^\d+$' then
    select jsonb_build_object('rfp_id', r.id, 'node_id', null) into v_out
      from public.sales_rfps r where r.company_id = v_company and r.record_no = v_code::bigint and r.deleted_at is null;
  end if;
  return v_out;
end $function$;
CREATE OR REPLACE FUNCTION public.app_sales_price_history(p_q text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_company uuid := private.sales_company('sales_prices', 'read');
begin
  if not private.sales_can('sales_reports', 'read') then
    raise exception 'sales: not allowed' using errcode = '42501';
  end if;
  return (select coalesce(jsonb_agg(to_jsonb(x) order by x.quoted_on desc, x.record_no desc, x.code), '[]'::jsonb)
    from (
      select q.code, q.revision, q.product_type, q.size, q.rating, q.description, q.qty, q.unit,
             q.unit_price, q.quoted_on, r.id as rfp_id, r.record_no, r.currency, r.bid_result, r.winning_bid,
             (select name from public.sales_customers where id = r.buyer_id) as buyer_name
        from public.sales_quote_lines q join public.sales_rfps r on r.id = q.rfp_id
       where q.company_id = v_company and r.deleted_at is null
         and not exists (
           select 1 from unnest(regexp_split_to_array(btrim(coalesce(p_q, '')), '\s+')) as t(term)
            where term <> ''
              and concat_ws(' ', q.code, q.product_type, q.size, q.rating, q.description)
                  not ilike '%' || replace(replace(replace(term, '\', '\\'), '%', '\%'), '_', '\_') || '%')
       order by q.quoted_on desc, r.record_no desc
       limit 500) x);
end $function$;
CREATE OR REPLACE FUNCTION public.app_sales_people_to_match(p_batch uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_company uuid := private.sales_company('sales_settings', 'edit');
begin
  return coalesce((
    with t as (
      select private.sales_name_key(r.in_charge_text) as k, btrim(r.in_charge_text) as nm
        from public.sales_rfps r
       where r.company_id = v_company and r.deleted_at is null and nullif(btrim(r.in_charge_text), '') is not null
         and btrim(r.in_charge_text) not in ('Y', 'N')
         and (p_batch is null or p_batch = any (r.import_batches))),
    g as (select k, count(*) as n from t group by k),
    sp as (select distinct on (k) k, nm from (select k, nm, count(*) as c from t group by k, nm) x
            order by k, c desc, nm)
    select jsonb_agg(jsonb_build_object('name', sp.nm, 'count', g.n, 'matched_id', pr.id,
                                        'matched_name', pr.full_name) order by g.n desc, sp.nm)
      from g join sp on sp.k = g.k
      left join public.sales_name_aliases a
             on a.company_id = v_company and a.kind = 'person' and a.alias_key = g.k
      left join public.profiles pr on pr.id = a.target_id and pr.company_id = v_company), '[]'::jsonb);
end $function$;
CREATE OR REPLACE FUNCTION public.app_sales_match_person(p_name text, p_profile uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_company uuid := private.sales_company('sales_settings', 'edit'); v_name text; v_key text;
  v_old uuid; v_ids uuid[]; v_n integer; v_from text; v_to text;
begin
  v_name := left(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), 200);
  v_key := private.sales_name_key(v_name);
  if v_key = '' or (p_profile is not null and not exists (
       select 1 from public.profiles where id = p_profile and company_id = v_company)) then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  select target_id into v_old from public.sales_name_aliases
   where company_id = v_company and kind = 'person' and alias_key = v_key;
  -- The affected records are locked first, by id.
  select coalesce(array_agg(id order by id), '{}') into v_ids from (
    select id from public.sales_rfps
     where company_id = v_company and deleted_at is null and in_charge_text is not null
       and private.sales_name_key(in_charge_text) = v_key
       and owner_id is distinct from p_profile
       and case when p_profile is null then v_old is not null and owner_id = v_old
                else owner_id is null or owner_id = v_old end
     order by id for update) t;
  v_n := cardinality(v_ids);
  select full_name into v_from from public.profiles where id = v_old;
  select full_name into v_to from public.profiles where id = p_profile;
  update public.sales_rfps set owner_id = p_profile, updated_by = auth.uid(), updated_at = now()
   where id = any (v_ids);
  insert into public.sales_events (company_id, rfp_id, actor_id, kind, body)
    select v_company, id, auth.uid(), 'edit',
           jsonb_build_object('side', 'person_match', 'name', v_name, 'from', v_from, 'to', v_to)
      from unnest(v_ids) as u(id);
  if p_profile is null then
    delete from public.sales_name_aliases where company_id = v_company and kind = 'person' and alias_key = v_key;
  else
    insert into public.sales_name_aliases (company_id, kind, alias_key, alias, target_id, created_by)
      values (v_company, 'person', v_key, v_name, p_profile, auth.uid())
      on conflict (company_id, kind, alias_key) do update
        set target_id = excluded.target_id, alias = excluded.alias, created_by = excluded.created_by;
  end if;
  return jsonb_build_object('updated', v_n);
end $function$;
CREATE OR REPLACE FUNCTION public.app_sales_file_get(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_company uuid := private.sales_company(); f public.sales_files;
begin
  select * into f from public.sales_files where id = p_id and company_id = v_company and status = 'ready'
     and (private.sales_is_admin() or not exists (
           select 1 from public.sales_rfps x where x.id = rfp_id and x.deleted_at is not null));
  if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('id', f.id, 'company_id', f.company_id, 'rfp_id', f.rfp_id,
                            'name', f.name, 'size_bytes', f.size_bytes);
end $function$;
CREATE OR REPLACE FUNCTION public.app_sales_import(p_file text, p_rows jsonb, p_fields jsonb DEFAULT '[]'::jsonb, p_people jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;
CREATE OR REPLACE FUNCTION public.app_sales_import_inquiries(p_batch uuid, p_file text, p_rows jsonb, p_people jsonb DEFAULT '{}'::jsonb, p_cutoff date DEFAULT NULL::date, p_last boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

-- ---------------------------------------------------------------- admin write functions
create function public.app_sales_archive(p_id uuid) returns void
  language plpgsql security definer set search_path to '' as $$
declare v_company uuid; r public.sales_rfps; v_kind text; v_target uuid;
begin
  if not private.sales_is_admin() then raise exception 'sales: not allowed' using errcode = '42501'; end if;
  v_company := private.sales_company('sales', 'read');
  r := private.sales_rfp(p_id, v_company);
  select kind into v_kind from public.sales_stages where id = r.stage_id;
  if v_kind = 'archived' then raise exception 'sales: stage not available' using errcode = '22023'; end if;
  select id into v_target from public.sales_stages
   where flow_id = r.flow_id and active and kind = 'archived' order by position limit 1;
  if v_target is null then raise exception 'sales: stage not available' using errcode = '22023'; end if;
  update public.sales_rfps set stage_id = v_target, result_at = coalesce(result_at, now()) where id = r.id;
  -- sales_touch logs the event and resyncs the deadlines: the closed stage marks the auto ones done.
  perform private.sales_touch(r.id, 'archived', jsonb_build_object('from_stage', r.stage_id));
end $$;

create function public.app_sales_delete_record(p_id uuid) returns void
  language plpgsql security definer set search_path to '' as $$
declare v_company uuid; r public.sales_rfps;
begin
  if not private.sales_is_admin() then raise exception 'sales: not allowed' using errcode = '42501'; end if;
  v_company := private.sales_company('sales', 'read');
  r := private.sales_rfp(p_id, v_company);
  update public.sales_rfps set deleted_at = now(), deleted_by = auth.uid() where id = r.id;
  insert into public.sales_events (company_id, rfp_id, actor_id, kind, body)
    values (v_company, r.id, auth.uid(), 'deleted', '{}'::jsonb);
end $$;

create function public.app_sales_restore_record(p_id uuid) returns void
  language plpgsql security definer set search_path to '' as $$
declare v_company uuid; r public.sales_rfps;
begin
  if not private.sales_is_admin() then raise exception 'sales: not allowed' using errcode = '42501'; end if;
  v_company := private.sales_company('sales', 'read');
  r := private.sales_rfp(p_id, v_company, true, true);
  if r.deleted_at is null then raise exception 'sales: not found' using errcode = 'P0002'; end if;
  update public.sales_rfps set deleted_at = null, deleted_by = null where id = r.id;
  insert into public.sales_events (company_id, rfp_id, actor_id, kind, body)
    values (v_company, r.id, auth.uid(), 'restored', '{}'::jsonb);
end $$;

revoke all on function public.app_sales_archive(uuid), public.app_sales_delete_record(uuid),
                       public.app_sales_restore_record(uuid) from public, anon;
grant execute on function public.app_sales_archive(uuid), public.app_sales_delete_record(uuid),
                          public.app_sales_restore_record(uuid) to authenticated;
