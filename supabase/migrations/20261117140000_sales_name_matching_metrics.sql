-- =============================================================================
-- Migration: 20261117140000_sales_name_matching_metrics.sql
-- Purpose  : ERP > Sales, FR-94 sections 16.8 + 16.9:
--   * sales_name_aliases: saved spellings (customer / person) that later imports resolve first;
--   * private.sales_customer resolves a customer alias; both imports resolve a person alias;
--   * merge / rename customers save aliases; person matching (people to match, match, aliases, remove);
--   * imports keep the original in-charge name in in_charge_text even when an owner is found;
--   * app_sales_list_page: sort / dir + from / to / result filters;
--   * customer rows: `sales`; app_sales_customers(p) / app_sales_metrics filters; owners on the customer page.
-- Reads are stable and write nothing; money keys only with sales_prices. Function-only: no client grants.
-- =============================================================================

create table public.sales_name_aliases (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind       text not null check (kind in ('customer', 'person')),
  alias_key  text not null check (alias_key <> ''),
  alias      text not null check (char_length(btrim(alias)) between 1 and 200),
  target_id  uuid not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (company_id, kind, alias_key)
);
comment on table public.sales_name_aliases is
  'FR-94 16.8: saved spellings. kind customer: target is a sales_customers id; person: a profiles id. Resolved by the imports before they create or match.';
alter table public.sales_name_aliases enable row level security;
revoke all on public.sales_name_aliases from public, anon, authenticated;

-- ================================================================ filters (16.9)
create function private.sales_filter_check(p jsonb) returns void
    language plpgsql immutable set search_path to '' as $$
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
exception when invalid_datetime_format or datetime_field_overflow then
  raise exception 'sales: invalid input' using errcode = '22023';
end $$;

-- Does a record pass from / to / result / owner? (kind is the buyer's and is tested by the caller.)
-- Assumes private.sales_filter_check(p) ran. A null received date fails a from / to filter.
create function private.sales_rec_ok(p jsonb, p_recv date, p_result text, p_decision text, p_skind text, p_owner uuid)
    returns boolean language sql immutable set search_path to '' as $$
  select coalesce(
       (nullif(p->>'from', '') is null or p_recv >= (p->>'from')::date)
   and (nullif(p->>'to', '') is null or p_recv <= (p->>'to')::date)
   and (nullif(p->>'result', '') is null or case p->>'result'
          when 'won' then p_result = 'won' when 'lost' then p_result = 'lost'
          when 'no_bid' then p_decision = 'no_bid' else p_skind = p->>'result' end)
   and (nullif(p->>'owner', '') is null or p_owner = (p->>'owner')::uuid), false);
$$;

create function private.sales_filtered(p jsonb) returns boolean
    language sql immutable set search_path to '' as $$
  select coalesce(nullif(p->>'from', ''), nullif(p->>'to', ''), nullif(p->>'result', ''),
                  nullif(p->>'owner', ''), nullif(p->>'kind', '')) is not null;
$$;

-- ================================================================ customer alias on lookup
create or replace function private.sales_customer(p_company uuid, p_name text, p_kind text default null)
    returns uuid language plpgsql security definer set search_path to '' as $$
declare v_key text := private.sales_name_key(p_name); v_id uuid;
  v_kind text := case when p_kind in ('government','contractor') then p_kind end;
begin
  if v_key = '' then return null; end if;
  -- A saved alias (a merged or renamed spelling) wins while its customer still exists.
  select c.id into v_id from public.sales_name_aliases a
    join public.sales_customers c on c.id = a.target_id and c.company_id = p_company
   where a.company_id = p_company and a.kind = 'customer' and a.alias_key = v_key;
  if v_id is not null then return v_id; end if;
  insert into public.sales_customers (company_id, name, name_key, kind)
    values (p_company, left(regexp_replace(btrim(p_name), '\s+', ' ', 'g'), 200), v_key, v_kind)
    on conflict (company_id, name_key) do update
      set kind = coalesce(public.sales_customers.kind, excluded.kind)
    returning id into v_id;
  return v_id;
end $$;

-- ================================================================ customer rows (+ sales, + filters)
drop function private.sales_customer_rows(uuid, boolean, uuid);
create function private.sales_customer_rows(p_company uuid, p_prices boolean, p_id uuid default null,
                                            p_f jsonb default '{}'::jsonb)
    returns setof jsonb language sql stable security definer set search_path to '' as $$
  with rf as (
    select r.id, r.buyer_id, r.client_id, r.received_on, r.bid_result, r.bid_decision, r.in_charge_text,
           r.owner_id, r.currency, r.our_price, r.total_value, s.kind as skind, f.kind as fkind,
           (r.bid_result = 'won' or (f.kind = 'contract' and s.kind <> 'cancelled')) as is_won
      from public.sales_rfps r
      join public.sales_stages s on s.id = r.stage_id
      join public.sales_flows f on f.id = r.flow_id
     where r.company_id = p_company
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
$$;

drop function public.app_sales_customers();
create function public.app_sales_customers(p jsonb default '{}'::jsonb) returns jsonb
    language plpgsql stable security definer set search_path to '' as $$
declare v_company uuid := private.sales_company('sales', 'read');
begin
  p := coalesce(p, '{}'::jsonb);
  perform private.sales_filter_check(p);
  return coalesce((select jsonb_agg(x) from private.sales_customer_rows(
    v_company, private.sales_can('sales_prices', 'read'), null, p) x), '[]'::jsonb);
end $$;

create or replace function public.app_sales_customer(p_id uuid) returns jsonb
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
                           group by w.word order by count(*) desc, w.word limit 10) t),
    'owners', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'count', n)
                                         order by n desc, name), '[]'::jsonb)
                 from (select o.id, o.full_name as name, count(*) as n
                         from public.sales_rfps r join public.profiles o on o.id = r.owner_id
                        where r.company_id = v_company and r.buyer_id = p_id
                        group by o.id, o.full_name) t));
end $$;

-- ================================================================ merge / rename keep aliases
create or replace function public.app_sales_rename_customer(p_id uuid, p_name text) returns void
    language plpgsql security definer set search_path to '' as $$
declare v_company uuid := private.sales_company('sales_settings', 'edit'); v_name text; v_key text;
  v_old public.sales_customers;
begin
  v_name := left(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), 200);
  v_key := private.sales_name_key(v_name);
  if v_key = '' then raise exception 'sales: invalid input' using errcode = '22023'; end if;
  select * into v_old from public.sales_customers where id = p_id and company_id = v_company for update;
  if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.sales_customers where company_id = v_company and name_key = v_key and id <> p_id) then
    raise exception 'sales: customer exists' using errcode = '23505';
  end if;
  update public.sales_customers set name = v_name, name_key = v_key where id = p_id;
  if v_old.name_key <> v_key then
    -- The new name is now the real one: an alias with its key would only redirect it elsewhere.
    delete from public.sales_name_aliases where company_id = v_company and kind = 'customer' and alias_key = v_key;
    insert into public.sales_name_aliases (company_id, kind, alias_key, alias, target_id, created_by)
      values (v_company, 'customer', v_old.name_key, v_old.name, p_id, auth.uid())
      on conflict (company_id, kind, alias_key) do update
        set target_id = excluded.target_id, alias = excluded.alias, created_by = excluded.created_by;
  end if;
end $$;

create or replace function public.app_sales_merge_customers(p_from uuid, p_into uuid) returns jsonb
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
  -- Aliases: the source's own aliases move to the target, and its name becomes one.
  update public.sales_name_aliases set target_id = p_into
   where company_id = v_company and kind = 'customer' and target_id = p_from;
  insert into public.sales_name_aliases (company_id, kind, alias_key, alias, target_id, created_by)
    values (v_company, 'customer', v_from.name_key, v_from.name, p_into, auth.uid())
    on conflict (company_id, kind, alias_key) do update
      set target_id = excluded.target_id, alias = excluded.alias, created_by = excluded.created_by;
  delete from public.sales_name_aliases
   where company_id = v_company and kind = 'customer' and alias_key = v_into.name_key;
  return jsonb_build_object('moved', v_n);
end $$;

-- ================================================================ person matching
create function public.app_sales_people_to_match(p_batch uuid default null) returns jsonb
    language plpgsql stable security definer set search_path to '' as $$
declare v_company uuid := private.sales_company('sales_settings', 'edit');
begin
  return coalesce((
    with t as (
      select private.sales_name_key(r.in_charge_text) as k, btrim(r.in_charge_text) as nm
        from public.sales_rfps r
       where r.company_id = v_company and nullif(btrim(r.in_charge_text), '') is not null
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
end $$;

create function public.app_sales_match_person(p_name text, p_profile uuid) returns jsonb
    language plpgsql security definer set search_path to '' as $$
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
     where company_id = v_company and in_charge_text is not null
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
end $$;

create function public.app_sales_aliases() returns jsonb
    language plpgsql stable security definer set search_path to '' as $$
declare v_company uuid := private.sales_company('sales_settings', 'edit');
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'alias', a.alias, 'target_id', a.target_id,
             'target_name', case a.kind when 'customer' then c.name else p.full_name end,
             'created_at', a.created_at) order by a.kind, a.alias)
      from public.sales_name_aliases a
      left join public.sales_customers c on a.kind = 'customer' and c.id = a.target_id
      left join public.profiles p on a.kind = 'person' and p.id = a.target_id
     where a.company_id = v_company), '[]'::jsonb);
end $$;

create function public.app_sales_remove_alias(p_id uuid) returns void
    language plpgsql security definer set search_path to '' as $$
declare v_company uuid := private.sales_company('sales_settings', 'edit');
begin
  delete from public.sales_name_aliases where id = p_id and company_id = v_company;
  if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
end $$;

-- ================================================================ records list: sort + filters
create or replace function public.app_sales_list_page(p jsonb default '{}'::jsonb) returns jsonb
    language plpgsql stable security definer set search_path to '' as $_$
declare v_company uuid := private.sales_company(); v_prices boolean := private.sales_can('sales_prices', 'read');
  v_state text := coalesce(nullif(p->>'state', ''), 'open'); v_flow text := nullif(p->>'flow', '');
  v_stage uuid := private.sales_uuid(p->>'stage'); v_owner uuid := private.sales_uuid(p->>'owner');
  v_buyer uuid := private.sales_uuid(p->>'buyer'); v_q text := nullif(btrim(coalesce(p->>'q', '')), '');
  v_sort text := coalesce(nullif(p->>'sort', ''), 'record_no'); v_dir text := nullif(p->>'dir', '');
  v_limit integer; v_pat text; v_no integer; v_total integer; v_rows jsonb;
begin
  if jsonb_typeof(coalesce(p, '{}'::jsonb)) <> 'object' or v_state not in ('open', 'closed', 'all')
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
       and (v_state = 'all' or (v_state = 'open') = (s.kind = 'open'))
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
end $_$;

-- ================================================================ imports: person alias + keep the original name
CREATE OR REPLACE FUNCTION public.app_sales_import(p_file text, p_rows jsonb, p_fields jsonb DEFAULT '[]'::jsonb, p_people jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
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

-- ================================================================ metrics (16.8 + 16.9)
-- Sale date = order date, else result date, else offer date, else received date. A record is a
-- sale when it is won (bid_result) or a live contract; its value is the contract value, else our price.
create function public.app_sales_metrics(p_customer uuid, p_year_start date, p_prev_year_start date,
                                         p jsonb default '{}'::jsonb) returns jsonb
    language plpgsql stable security definer set search_path to '' as $$
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
     where r.company_id = v_company
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
       where x.company_id = v_company and x.buyer_id in (select buyer_id from mine where buyer_id is not null)
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
end $$;

-- ================================================================ grants
revoke all on function private.sales_filter_check(jsonb) from public, anon, authenticated;
revoke all on function private.sales_rec_ok(jsonb, date, text, text, text, uuid) from public, anon, authenticated;
revoke all on function private.sales_filtered(jsonb) from public, anon, authenticated;
revoke all on function private.sales_customer_rows(uuid, boolean, uuid, jsonb) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['app_sales_customers(jsonb)', 'app_sales_metrics(uuid, date, date, jsonb)',
    'app_sales_people_to_match(uuid)', 'app_sales_match_person(text, uuid)', 'app_sales_aliases()',
    'app_sales_remove_alias(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
