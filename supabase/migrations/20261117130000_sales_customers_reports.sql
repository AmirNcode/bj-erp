-- =============================================================================
-- Migration: 20261117130000_sales_customers_reports.sql
-- Purpose  : ERP > Sales, FR-94 section 16.7 (Customers tab) + the Reports aggregate
--            (plan 2026-11-17, A8 and A5):
--   * app_sales_customers()            one row per customer with the section 16.7 figures;
--   * app_sales_customer(p_id)         the customer page: row + per-year + client-of + top words;
--   * app_sales_rename_customer / app_sales_merge_customers   (sales_settings edit);
--   * app_sales_report()               pipeline per stage + decided bids, so Reports needs no full list.
-- Reads are stable and write nothing; prices (contract_value, quoted, pipeline value) only with sales_prices.
-- =============================================================================

-- One jsonb row per customer (or just p_id), built by joins and GROUP BY (no per-customer subqueries).
create function private.sales_customer_rows(p_company uuid, p_prices boolean, p_id uuid default null)
    returns setof jsonb language sql stable security definer set search_path to '' as $$
  with rf as (
    select r.id, r.buyer_id, r.client_id, r.received_on, r.bid_result, r.bid_decision, r.in_charge_text,
           r.owner_id, r.currency, r.our_price, r.total_value, s.kind as skind, f.kind as fkind
      from public.sales_rfps r
      join public.sales_stages s on s.id = r.stage_id
      join public.sales_flows f on f.id = r.flow_id
     where r.company_id = p_company
       and (r.buyer_id is not null or r.client_id is not null)
       and (p_id is null or r.buyer_id = p_id or r.client_id = p_id)),
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
         'contract_value', coalesce(cv.j, '{}'::jsonb), 'quoted', coalesce(qv.j, '{}'::jsonb))
       else '{}'::jsonb end
  from public.sales_customers c
  left join agg a on a.buyer_id = c.id
  left join cli on cli.client_id = c.id
  left join dl on dl.buyer_id = c.id
  left join own on own.buyer_id = c.id
  left join cv on cv.buyer_id = c.id
  left join qv on qv.buyer_id = c.id
  where c.company_id = p_company and (p_id is null or c.id = p_id)
  order by c.name;
$$;

create function public.app_sales_customers() returns jsonb
    language plpgsql stable security definer set search_path to '' as $$
declare v_company uuid := private.sales_company('sales', 'read');
begin
  return coalesce((select jsonb_agg(x) from private.sales_customer_rows(
    v_company, private.sales_can('sales_prices', 'read')) x), '[]'::jsonb);
end $$;

create function public.app_sales_customer(p_id uuid) returns jsonb
    language plpgsql stable security definer set search_path to '' as $$
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
                          where company_id = v_company and buyer_id = p_id and received_on is not null
                          group by 1 order by 1 desc limit 12) t),
    'client_of', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'count', n)
                                            order by n desc, name), '[]'::jsonb)
                    from (select b.id, b.name, count(*) as n
                            from public.sales_rfps r join public.sales_customers b on b.id = r.buyer_id
                           where r.company_id = v_company and r.client_id = p_id
                           group by b.id, b.name) t),
    'top_words', (select coalesce(jsonb_agg(jsonb_build_object('word', word, 'count', n) order by n desc, word), '[]'::jsonb)
                    from (select w.word, count(*) as n
                            from public.sales_rfps r,
                                 lateral regexp_split_to_table(lower(r.title), '[^[:alnum:]]+') as w(word)
                           where r.company_id = v_company and r.buyer_id = p_id
                             and char_length(w.word) >= 3
                             and w.word <> all (array['and', 'of', 'for', 'the', 'with', 'و', 'برای'])
                           group by w.word order by count(*) desc, w.word limit 10) t));
end $$;

create function public.app_sales_rename_customer(p_id uuid, p_name text) returns void
    language plpgsql security definer set search_path to '' as $$
declare v_company uuid := private.sales_company('sales_settings', 'edit'); v_name text; v_key text;
begin
  v_name := left(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), 200);
  v_key := private.sales_name_key(v_name);
  if v_key = '' then raise exception 'sales: invalid input' using errcode = '22023'; end if;
  perform 1 from public.sales_customers where id = p_id and company_id = v_company for update;
  if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.sales_customers where company_id = v_company and name_key = v_key and id <> p_id) then
    raise exception 'sales: customer exists' using errcode = '23505';
  end if;
  update public.sales_customers set name = v_name, name_key = v_key where id = p_id;
end $$;

create function public.app_sales_merge_customers(p_from uuid, p_into uuid) returns jsonb
    language plpgsql security definer set search_path to '' as $$
declare v_company uuid := private.sales_company('sales_settings', 'edit');
  v_from public.sales_customers; v_into public.sales_customers; v_ids uuid[]; v_n integer;
begin
  if p_from is null or p_into is null or p_from = p_into then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  -- Lock order: customers by id, then the affected records by id.
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
  update public.sales_customers set kind = coalesce(v_into.kind, v_from.kind) where id = p_into;
  delete from public.sales_customers where id = p_from;
  return jsonb_build_object('moved', v_n);
end $$;

create function public.app_sales_report() returns jsonb
    language plpgsql stable security definer set search_path to '' as $$
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
             where r.company_id = v_company group by r.stage_id, s.position) t
      left join (select stage_id, jsonb_object_agg(currency, amt) as j
                   from (select stage_id, currency, sum(coalesce(total_value, our_price)) as amt
                           from public.sales_rfps
                          where company_id = v_company and currency is not null
                            and coalesce(total_value, our_price) is not null
                          group by stage_id, currency) q group by stage_id) v on v.stage_id = t.stage_id),
    'decided', (select coalesce(jsonb_agg(jsonb_build_object(
          'buyer_name', b.name, 'result_at', r.result_at, 'bid_result', r.bid_result)), '[]'::jsonb)
      from public.sales_rfps r left join public.sales_customers b on b.id = r.buyer_id
     where r.company_id = v_company and r.bid_decision = 'bid' and r.bid_result is not null
       and r.import_batch_id is null and cardinality(r.import_batches) = 0));
end $$;

-- ================================================================ grants
revoke all on function private.sales_customer_rows(uuid, boolean, uuid) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['app_sales_customers()', 'app_sales_customer(uuid)',
    'app_sales_rename_customer(uuid, text)', 'app_sales_merge_customers(uuid, uuid)', 'app_sales_report()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
