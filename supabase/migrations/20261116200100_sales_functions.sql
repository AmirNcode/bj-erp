-- =============================================================================
-- Migration: 20261116200100_sales_functions.sql
-- Purpose  : ERP › Sales module (FR-94) — every read and write of the sales_* tables
--            and project_nodes. Tables: 20261116200000_sales_tables.sql.
-- Spec     : docs/specs/2026-11-16-sales-rfp-module-design.md (§15 wins)
--
-- Rules every function follows:
--   * private.sales_company(key, level) first: the caller's company, or
--     'sales: not allowed' unless they hold `sales` read AND the named key.
--   * Price values (our_price, winning_bid, winner_name, total_value, unit_price,
--     quote lines) leave only for sales_prices holders; guarantee and payment values
--     only for sales_bonds holders. The activity log never stores such a value.
--   * Errors start with 'sales: ' (lib/errors/db-error.ts maps them).
-- =============================================================================

-- ---------------------------------------------------------------- helpers
create or replace function private.sales_can(p_key text, p_level text default 'edit') returns boolean
    language sql stable security definer set search_path to '' as $$
  select coalesce(private.has_perm(auth.uid(), 'sales', 'read')
     and private.has_perm(auth.uid(), p_key, p_level), false);
$$;

create or replace function private.sales_company(p_key text default 'sales', p_level text default 'read')
    returns uuid language plpgsql stable security definer set search_path to '' as $$
declare v uuid;
begin
  if auth.uid() is null or not private.sales_can(p_key, p_level) then
    raise exception 'sales: not allowed' using errcode = '42501';
  end if;
  v := private.caller_company();
  if v is null then raise exception 'sales: not allowed' using errcode = '42501'; end if;
  return v;
end $$;

-- The record, in the caller's company. p_lock: writers lock the row; readers must not
-- (View as runs read-only transactions, where FOR UPDATE is refused).
create or replace function private.sales_rfp(p_id uuid, p_company uuid, p_lock boolean default true)
    returns public.sales_rfps language plpgsql security definer set search_path to '' as $$
declare r public.sales_rfps;
begin
  if p_lock then
    select * into r from public.sales_rfps where id = p_id and company_id = p_company for update;
  else
    select * into r from public.sales_rfps where id = p_id and company_id = p_company;
  end if;
  if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
  return r;
end $$;

create or replace function private.sales_today() returns date
    language sql stable set search_path to '' as $$
  select (now() at time zone 'Asia/Tehran')::date;
$$;

-- Safe casts for typed / imported values: null instead of an error.
create or replace function private.sales_num(p text) returns numeric
    language plpgsql immutable set search_path to '' as $$
begin
  if p is null or btrim(p) = '' then return null; end if;
  return btrim(p)::numeric;
exception when others then return null;
end $$;

create or replace function private.sales_date(p text) returns date
    language plpgsql immutable set search_path to '' as $$
begin
  if p is null or btrim(p) !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  return btrim(p)::date;
exception when others then return null;
end $$;

create or replace function private.sales_uuid(p text) returns uuid
    language plpgsql immutable set search_path to '' as $$
begin
  if p is null or btrim(p) = '' then return null; end if;
  return btrim(p)::uuid;
exception when others then return null;
end $$;

create or replace function private.sales_name_key(p text) returns text
    language sql immutable set search_path to '' as $$
  -- Arabic ي / ك fold to Persian ی / ک; the zero-width non-joiner is dropped.
  select lower(regexp_replace(btrim(translate(coalesce(p, ''), 'يك' || chr(8204), 'یک')), '\s+', ' ', 'g'));
$$;

-- Find a customer by name (case- and space-insensitive) or create it. Null for an empty name.
create or replace function private.sales_customer(p_company uuid, p_name text, p_kind text default null)
    returns uuid language plpgsql security definer set search_path to '' as $$
declare v_key text := private.sales_name_key(p_name); v_id uuid;
  v_kind text := case when p_kind in ('government','contractor') then p_kind end;
begin
  if v_key = '' then return null; end if;
  insert into public.sales_customers (company_id, name, name_key, kind)
    values (p_company, left(regexp_replace(btrim(p_name), '\s+', ' ', 'g'), 200), v_key, v_kind)
    on conflict (company_id, name_key) do update
      set kind = coalesce(public.sales_customers.kind, excluded.kind)
    returning id into v_id;
  return v_id;
end $$;

create or replace function private.sales_in_company(p_profile uuid, p_company uuid) returns boolean
    language sql stable security definer set search_path to '' as $$
  select p_profile is null
      or exists (select 1 from public.profiles where id = p_profile and company_id = p_company);
$$;

-- Keep the derived deadlines of one record in step with their source fields.
-- A done mark is kept unless the date itself changes. p_import: a date already in the
-- past is stored as done, so a ledger import does not fill the Deadlines page with
-- years-old dates.
create or replace function private.sales_sync_deadlines(p_rfp uuid, p_import boolean default false)
    returns void language plpgsql security definer set search_path to '' as $$
declare r public.sales_rfps; v_stage text; v_flow text; v_today date := private.sales_today();
begin
  select * into r from public.sales_rfps where id = p_rfp;
  if not found then return; end if;
  select kind into v_stage from public.sales_stages where id = r.stage_id;
  select kind into v_flow from public.sales_flows where id = r.flow_id;

  with want(kind, source_id, due_on, done) as (
    select 'proposal_due', null::uuid, r.proposal_due, (r.submitted_on is not null or v_stage <> 'open')
     where r.proposal_due is not null
    union all
    select 'quote_due', null::uuid, r.quote_due, (r.submitted_on is not null or v_stage <> 'open')
     where r.needs_quote and r.quote_due is not null
    union all
    select 'bond_due', null::uuid, r.bond_due,
           (v_stage <> 'open' or exists (select 1 from public.sales_bonds b
              where b.rfp_id = p_rfp and b.kind = 'bid' and b.status in ('issued','delivered','released')))
     where r.needs_bond and r.bond_due is not null
    union all
    select 'offer_valid_until', null::uuid, r.submitted_on + r.validity_days, (r.bid_result is not null)
     where r.submitted_on is not null and r.validity_days is not null
    union all
    select 'bond_expires', b.id, b.expires_on, (b.status in ('released','expired','void'))
      from public.sales_bonds b where b.rfp_id = p_rfp and b.expires_on is not null
    union all
    select 'delivery_due', null::uuid, r.delivery_date, (v_stage <> 'open')
     where v_flow = 'contract' and r.delivery_date is not null
  ), gone as (
    delete from public.sales_deadlines d
     where d.rfp_id = p_rfp and d.auto
       and not exists (select 1 from want w
                        where w.kind = d.kind and w.source_id is not distinct from d.source_id)
  )
  insert into public.sales_deadlines (company_id, rfp_id, kind, source_id, due_on, responsible_id, auto, done_at)
  select r.company_id, p_rfp, w.kind, w.source_id, w.due_on, r.owner_id, true,
         case when w.done or (p_import and w.due_on < v_today) then now() end
    from want w
  on conflict (rfp_id, kind, (coalesce(source_id, '00000000-0000-0000-0000-000000000000'::uuid))) where auto
  do update set
    due_on = excluded.due_on,
    responsible_id = excluded.responsible_id,
    done_at = case when public.sales_deadlines.due_on is distinct from excluded.due_on then excluded.done_at
                   else coalesce(public.sales_deadlines.done_at, excluded.done_at) end,
    done_by = case when public.sales_deadlines.due_on is distinct from excluded.due_on then null
                   else public.sales_deadlines.done_by end;
end $$;

-- After any write by a person: activity row, updated stamp, deadlines.
create or replace function private.sales_touch(p_rfp uuid, p_kind text, p_body jsonb default '{}')
    returns void language plpgsql security definer set search_path to '' as $$
begin
  insert into public.sales_events (company_id, rfp_id, actor_id, kind, body)
    select company_id, id, auth.uid(), p_kind, coalesce(p_body, '{}') from public.sales_rfps where id = p_rfp;
  update public.sales_rfps
     set updated_by = auth.uid(), updated_at = now(), edited_after_import = true
   where id = p_rfp;
  perform private.sales_sync_deadlines(p_rfp);
end $$;

-- our_price follows the item prices once any exist.
create or replace function private.sales_recalc_price(p_rfp uuid) returns void
    language plpgsql security definer set search_path to '' as $$
begin
  if exists (select 1 from public.sales_item_prices ip
               join public.project_nodes n on n.id = ip.node_id where n.rfp_id = p_rfp) then
    update public.sales_rfps set our_price = (
      select round(coalesce(sum(coalesce(n.qty, 1) * ip.unit_price), 0), 2)
        from public.sales_item_prices ip join public.project_nodes n on n.id = ip.node_id
       where n.rfp_id = p_rfp) where id = p_rfp;
  end if;
end $$;

-- A record as JSON. Price keys are present only when p_prices.
create or replace function private.sales_rfp_json(r public.sales_rfps, p_prices boolean) returns jsonb
    language sql stable security definer set search_path to '' as $$
  select (to_jsonb(r) - array['company_id','node_seq','import_batch_id','edited_after_import',
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

-- Snapshot of the priced item rows as quoted (entering a submit stage), per revision.
create or replace function private.sales_snapshot_quote(p_rfp uuid, p_on date) returns void
    language plpgsql security definer set search_path to '' as $$
declare r public.sales_rfps;
begin
  select * into r from public.sales_rfps where id = p_rfp;
  delete from public.sales_quote_lines where rfp_id = p_rfp and revision = r.revision;
  insert into public.sales_quote_lines (company_id, rfp_id, revision, code, product_type, size, rating,
                                        description, qty, unit, unit_price, quoted_on)
  select r.company_id, p_rfp, r.revision, n.code, n.product_type, n.size, n.rating,
         n.description, n.qty, n.unit, ip.unit_price, p_on
    from public.project_nodes n join public.sales_item_prices ip on ip.node_id = n.id
   where n.rfp_id = p_rfp;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'sales_can(text, text)', 'sales_company(text, text)', 'sales_rfp(uuid, uuid, boolean)', 'sales_today()',
    'sales_num(text)', 'sales_date(text)', 'sales_uuid(text)', 'sales_name_key(text)',
    'sales_customer(uuid, text, text)', 'sales_in_company(uuid, uuid)',
    'sales_sync_deadlines(uuid, boolean)', 'sales_touch(uuid, text, jsonb)', 'sales_recalc_price(uuid)',
    'sales_rfp_json(public.sales_rfps, boolean)', 'sales_snapshot_quote(uuid, date)'] loop
    execute format('revoke all on function private.%s from public, anon, authenticated', f);
  end loop;
end $$;

-- ================================================================ reads
create or replace function public.app_sales_bootstrap() returns jsonb
    language plpgsql stable security definer set search_path to '' as $$
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
                'skipped_count', b.skipped_count,
                'records', (select count(*) from public.sales_rfps r where r.import_batch_id = b.id),
                'untouched', (select count(*) from public.sales_rfps r
                               where r.import_batch_id = b.id and not r.edited_after_import))
              order by b.created_at desc), '[]'::jsonb)
         from public.sales_import_batches b where b.company_id = v_company)
      else '[]'::jsonb end);
end $$;

create or replace function public.app_sales_list() returns jsonb
    language plpgsql stable security definer set search_path to '' as $$
declare v_company uuid := private.sales_company(); v_prices boolean := private.sales_can('sales_prices', 'read');
begin
  return (select coalesce(jsonb_agg(private.sales_rfp_json(r, v_prices) order by r.record_no desc), '[]'::jsonb)
            from public.sales_rfps r where r.company_id = v_company);
end $$;

create or replace function public.app_sales_record(p_id uuid) returns jsonb
    language plpgsql stable security definer set search_path to '' as $$
declare v_company uuid := private.sales_company();
  r public.sales_rfps := private.sales_rfp(p_id, v_company, false);
  v_prices boolean := private.sales_can('sales_prices', 'read');
  v_bonds boolean := private.sales_can('sales_bonds', 'read');
begin
  return jsonb_build_object(
    'record', private.sales_rfp_json(r, v_prices),
    'nodes', (select coalesce(jsonb_agg(
                (to_jsonb(n) - array['company_id','child_seq','rfp_id'])
                || case when v_prices then jsonb_build_object('unit_price',
                     (select ip.unit_price from public.sales_item_prices ip where ip.node_id = n.id))
                   else '{}'::jsonb end
                order by n.depth, n.seq), '[]'::jsonb)
                from public.project_nodes n where n.rfp_id = p_id),
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
                 from public.sales_events e where e.rfp_id = p_id))
    || case when v_bonds then jsonb_build_object('payments',
         (select coalesce(jsonb_agg(to_jsonb(pm) - array['company_id','rfp_id'] order by pm.seq), '[]'::jsonb)
            from public.sales_payments pm where pm.rfp_id = p_id)) else '{}'::jsonb end
    || case when v_prices then jsonb_build_object('quote_revisions',
         (select coalesce(jsonb_agg(distinct q.revision), '[]'::jsonb)
            from public.sales_quote_lines q where q.rfp_id = p_id)) else '{}'::jsonb end;
end $$;

create or replace function public.app_sales_deadlines(p_include_done boolean default false) returns jsonb
    language plpgsql stable security definer set search_path to '' as $$
declare v_company uuid := private.sales_company();
begin
  return (select coalesce(jsonb_agg(
            (to_jsonb(d) - array['company_id'])
            || jsonb_build_object('record_no', r.record_no, 'title', r.title, 'stage_id', r.stage_id,
                 'buyer_name', (select name from public.sales_customers where id = r.buyer_id),
                 'responsible_name', (select full_name from public.profiles where id = d.responsible_id))
            order by d.due_on, r.record_no), '[]'::jsonb)
            from public.sales_deadlines d join public.sales_rfps r on r.id = d.rfp_id
           where d.company_id = v_company and (p_include_done or d.done_at is null));
end $$;

-- A typed number → the record (and the item row). Tolerates "BJ", spaces and padded
-- segments ("BJ 11511-01"), as printed on offers.
create or replace function public.app_sales_find_node(p_code text) returns jsonb
    language plpgsql stable security definer set search_path to '' as $$
declare v_company uuid := private.sales_company(); v_code text; v_out jsonb;
begin
  v_code := regexp_replace(upper(coalesce(p_code, '')), '^\s*BJ', '');
  v_code := regexp_replace(v_code, '[^0-9-]', '', 'g');
  if v_code !~ '^\d{1,9}(-\d{1,9})*$' then return null; end if;
  select string_agg((seg::bigint)::text, '-' order by ord) into v_code
    from unnest(string_to_array(v_code, '-')) with ordinality as t(seg, ord);
  select jsonb_build_object('rfp_id', n.rfp_id, 'node_id', n.id) into v_out
    from public.project_nodes n where n.company_id = v_company and n.code = v_code;
  if v_out is null and v_code ~ '^\d+$' then
    select jsonb_build_object('rfp_id', r.id, 'node_id', null) into v_out
      from public.sales_rfps r where r.company_id = v_company and r.record_no = v_code::bigint;
  end if;
  return v_out;
end $$;

create or replace function public.app_sales_price_history(p_q text) returns jsonb
    language plpgsql stable security definer set search_path to '' as $$
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
       where q.company_id = v_company
         and not exists (
           select 1 from unnest(regexp_split_to_array(btrim(coalesce(p_q, '')), '\s+')) as t(term)
            where term <> ''
              and concat_ws(' ', q.code, q.product_type, q.size, q.rating, q.description)
                  not ilike '%' || replace(replace(replace(term, '\', '\\'), '%', '\%'), '_', '\_') || '%')
       order by q.quoted_on desc, r.record_no desc
       limit 500) x);
end $$;

-- ================================================================ records
create or replace function public.app_sales_save_record(p_id uuid, p jsonb) returns uuid
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
  end if;

  -- Field names only, never values: every Sales reader sees the log.
  select array_agg(key order by key) into v_changed from jsonb_each(to_jsonb(v_new))
   where value is distinct from (to_jsonb(v_old)->key)
     and key not in ('updated_at','updated_by','edited_after_import');
  if v_created then
    perform private.sales_touch(v_old.id, 'created', jsonb_build_object('record_no', v_old.record_no));
    update public.sales_rfps set edited_after_import = false where id = v_old.id;
  elsif v_changed is not null then
    perform private.sales_touch(v_old.id, 'edit', jsonb_build_object('fields', to_jsonb(v_changed)));
  end if;
  return v_old.id;
end $$;

create or replace function public.app_sales_move_stage(
    p_id uuid, p_stage uuid, p_owner uuid default null, p_note text default null, p_submit jsonb default null)
    returns void language plpgsql security definer set search_path to '' as $$
declare
  v_company uuid := private.sales_company('sales', 'edit');
  r public.sales_rfps := private.sales_rfp(p_id, v_company);
  cur public.sales_stages; tgt public.sales_stages; v_flow text; v_missing text[];
  v_set public.sales_settings; v_method text;
begin
  select * into cur from public.sales_stages where id = r.stage_id;
  select * into tgt from public.sales_stages where id = p_stage and flow_id = r.flow_id and active;
  if not found or tgt.id = cur.id then
    raise exception 'sales: stage not available' using errcode = '22023';
  end if;
  select kind into v_flow from public.sales_flows where id = r.flow_id;
  -- A bid closes only through the decision or the result (which record why).
  if v_flow = 'bid' and tgt.kind <> 'open' then
    raise exception 'sales: stage not available' using errcode = '22023';
  end if;
  if (tgt.kind <> 'open' or cur.kind <> 'open') and not private.sales_can('sales_decide') then
    raise exception 'sales: not allowed' using errcode = '42501';
  end if;
  if not private.sales_in_company(p_owner, v_company) then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;

  if cur.kind = 'open' and tgt.position > cur.position then
    if v_flow = 'bid' and r.bid_decision <> 'bid' and exists (
         select 1 from public.sales_stages s
          where s.flow_id = r.flow_id and s.active and s.action = 'decide'
            and s.position >= cur.position and s.position < tgt.position) then
      raise exception 'sales: decision required' using errcode = '22023';
    end if;
    select array_agg(k) into v_missing from unnest(cur.required) as k
     where coalesce(to_jsonb(r)->>k, r.custom->>k, '') = '';
    if v_missing is not null then
      raise exception 'sales: required fields missing' using errcode = '22023',
        detail = array_to_string(v_missing, ', ');
    end if;
  end if;

  -- Reopening a closed bid takes its result back.
  if v_flow = 'bid' and cur.kind <> 'open' and tgt.kind = 'open' then
    r.bid_result := null; r.result_at := null; r.result_by := null; r.result_reason := null;
    if r.bid_decision = 'no_bid' then
      r.bid_decision := 'pending'; r.decided_by := null; r.decided_at := null; r.decision_reason := null;
    end if;
  end if;

  if tgt.action = 'submit' then
    select * into v_set from public.sales_settings where company_id = v_company;
    r.submitted_on := coalesce(private.sales_date(p_submit->>'submitted_on'), r.submitted_on, private.sales_today());
    v_method := p_submit->>'delivery_method';
    r.delivery_method := case when v_method in ('hand','courier') then v_method else r.delivery_method end;
    r.received_by := coalesce(nullif(left(btrim(p_submit->>'received_by'), 200), ''), r.received_by);
    r.validity_days := coalesce(private.sales_num(p_submit->>'validity_days')::integer, r.validity_days,
                                v_set.validity_days);
    if r.validity_days not between 1 and 3650 then
      raise exception 'sales: invalid input' using errcode = '22023';
    end if;
  end if;

  update public.sales_rfps set
    stage_id = tgt.id, owner_id = coalesce(p_owner, r.owner_id),
    bid_result = r.bid_result, result_at = r.result_at, result_by = r.result_by,
    result_reason = r.result_reason, bid_decision = r.bid_decision, decided_by = r.decided_by,
    decided_at = r.decided_at, decision_reason = r.decision_reason,
    submitted_on = r.submitted_on, delivery_method = r.delivery_method, received_by = r.received_by,
    validity_days = r.validity_days
  where id = r.id;
  if tgt.action = 'submit' then perform private.sales_snapshot_quote(r.id, r.submitted_on); end if;
  perform private.sales_touch(r.id, 'stage', jsonb_build_object('from', cur.id, 'to', tgt.id,
    'note', nullif(left(btrim(coalesce(p_note, '')), 1000), '')));
end $$;

create or replace function public.app_sales_decide(p_id uuid, p_bid boolean, p_reason text default null)
    returns void language plpgsql security definer set search_path to '' as $$
declare
  v_company uuid := private.sales_company('sales_decide', 'edit');
  r public.sales_rfps := private.sales_rfp(p_id, v_company);
  cur public.sales_stages; v_target uuid; v_gate integer;
begin
  select * into cur from public.sales_stages where id = r.stage_id;
  if (select kind from public.sales_flows where id = r.flow_id) <> 'bid'
     or cur.kind not in ('open', 'no_bid') or p_bid is null then
    raise exception 'sales: stage not available' using errcode = '22023';
  end if;
  if p_bid then
    -- Out of the decision stage (or back from No bid) to the first open stage after the gate.
    if cur.action = 'decide' or cur.kind = 'no_bid' then
      select coalesce(max(position), 0) into v_gate from public.sales_stages
       where flow_id = r.flow_id and active and action = 'decide';
      if cur.action = 'decide' then v_gate := cur.position; end if;
      select id into v_target from public.sales_stages
       where flow_id = r.flow_id and active and kind = 'open' and position > v_gate
       order by position limit 1;
    end if;
  else
    select id into v_target from public.sales_stages
     where flow_id = r.flow_id and active and kind = 'no_bid' order by position limit 1;
    if v_target is null then raise exception 'sales: stage not available' using errcode = '22023'; end if;
  end if;
  update public.sales_rfps set
    bid_decision = case when p_bid then 'bid' else 'no_bid' end,
    decided_by = auth.uid(), decided_at = now(),
    decision_reason = nullif(left(btrim(coalesce(p_reason, '')), 2000), ''),
    stage_id = coalesce(v_target, stage_id)
  where id = r.id;
  perform private.sales_touch(r.id, 'decision', jsonb_build_object('bid', p_bid,
    'reason', nullif(left(btrim(coalesce(p_reason, '')), 2000), '')));
end $$;

create or replace function public.app_sales_result(p_id uuid, p_result text, p jsonb default '{}')
    returns void language plpgsql security definer set search_path to '' as $$
declare
  v_company uuid := private.sales_company('sales_decide', 'edit');
  r public.sales_rfps := private.sales_rfp(p_id, v_company);
  v_flow uuid := r.flow_id; v_target uuid;
begin
  if p_result is null or p_result not in ('won', 'lost', 'cancelled') then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  if (select kind from public.sales_flows where id = r.flow_id) <> 'bid' then
    raise exception 'sales: stage not available' using errcode = '22023';
  end if;
  if p_result = 'won' then
    select id into v_flow from public.sales_flows where company_id = v_company and kind = 'contract';
    select id into v_target from public.sales_stages
     where flow_id = v_flow and active and kind = 'open' order by position limit 1;
  else
    select id into v_target from public.sales_stages
     where flow_id = r.flow_id and active and kind = p_result order by position limit 1;
  end if;
  if v_target is null then raise exception 'sales: stage not available' using errcode = '22023'; end if;
  begin
    update public.sales_rfps set
      bid_result = p_result, result_at = now(), result_by = auth.uid(),
      result_reason = nullif(left(btrim(coalesce(p->>'reason', '')), 2000), ''),
      winning_bid = coalesce(private.sales_num(p->>'winning_bid'), winning_bid),
      winner_name = coalesce(nullif(left(btrim(coalesce(p->>'winner_name', '')), 200), ''), winner_name),
      bid_decision = case when p_result = 'won' then 'bid' else bid_decision end,
      total_value = case when p_result = 'won' then coalesce(total_value, our_price) else total_value end,
      flow_id = v_flow, stage_id = v_target
    where id = r.id;
  exception when check_violation or numeric_value_out_of_range then
    raise exception 'sales: invalid input' using errcode = '22023';
  end;
  perform private.sales_touch(r.id, 'result', jsonb_build_object('result', p_result,
    'reason', nullif(left(btrim(coalesce(p->>'reason', '')), 2000), '')));
end $$;

create or replace function public.app_sales_comment(p_id uuid, p_text text) returns void
    language plpgsql security definer set search_path to '' as $$
declare v_company uuid := private.sales_company('sales', 'edit');
  r public.sales_rfps := private.sales_rfp(p_id, v_company);
begin
  if char_length(btrim(coalesce(p_text, ''))) not between 1 and 2000 then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  perform private.sales_touch(r.id, 'comment', jsonb_build_object('text', btrim(p_text)));
end $$;

-- ================================================================ guarantees, payments
create or replace function public.app_sales_save_bond(p_rfp uuid, p_id uuid, p jsonb) returns uuid
    language plpgsql security definer set search_path to '' as $$
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

create or replace function public.app_sales_delete_bond(p_id uuid) returns void
    language plpgsql security definer set search_path to '' as $$
declare v_company uuid := private.sales_company('sales_bonds', 'edit'); b public.sales_bonds;
begin
  select * into b from public.sales_bonds where id = p_id and company_id = v_company;
  if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
  perform private.sales_rfp(b.rfp_id, v_company);  -- record first: one lock order everywhere
  delete from public.sales_bonds where id = p_id;
  perform private.sales_touch(b.rfp_id, 'finance', jsonb_build_object('what', 'guarantee', 'kind', b.kind,
    'action', 'removed'));
end $$;

create or replace function public.app_sales_save_payment(p_rfp uuid, p_id uuid, p jsonb) returns uuid
    language plpgsql security definer set search_path to '' as $$
declare v_company uuid := private.sales_company('sales_bonds', 'edit');
  r public.sales_rfps := private.sales_rfp(p_rfp, v_company);
  b public.sales_payments; n public.sales_payments; v_patch jsonb;
begin
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_patch from jsonb_each(coalesce(p, '{}'))
   where key = any (array['seq','amount','paid_on','note']);
  if p_id is null then
    b.id := gen_random_uuid(); b.company_id := v_company; b.rfp_id := r.id; b.imported := false;
    select coalesce(max(seq), 0) + 1 into b.seq from public.sales_payments where rfp_id = r.id;
  else
    select * into b from public.sales_payments where id = p_id and rfp_id = r.id for update;
    if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
  end if;
  begin
    n := jsonb_populate_record(b, v_patch);
    if p_id is null then
      insert into public.sales_payments select n.*;
    else
      update public.sales_payments set seq = n.seq, amount = n.amount, paid_on = n.paid_on, note = n.note
       where id = p_id;
    end if;
  exception when others then
    raise exception 'sales: invalid input' using errcode = '22023';
  end;
  perform private.sales_touch(r.id, 'finance', jsonb_build_object('what', 'payment',
    'action', case when p_id is null then 'added' else 'changed' end));
  return n.id;
end $$;

create or replace function public.app_sales_delete_payment(p_id uuid) returns void
    language plpgsql security definer set search_path to '' as $$
declare v_company uuid := private.sales_company('sales_bonds', 'edit'); v_rfp uuid;
begin
  select rfp_id into v_rfp from public.sales_payments where id = p_id and company_id = v_company;
  if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
  perform private.sales_rfp(v_rfp, v_company);
  delete from public.sales_payments where id = p_id;
  perform private.sales_touch(v_rfp, 'finance', jsonb_build_object('what', 'payment', 'action', 'removed'));
end $$;

-- ================================================================ deadlines, documents
create or replace function public.app_sales_save_deadline(p_rfp uuid, p_id uuid, p jsonb) returns uuid
    language plpgsql security definer set search_path to '' as $$
declare v_company uuid := private.sales_company('sales', 'edit');
  r public.sales_rfps := private.sales_rfp(p_rfp, v_company);
  v_due date := private.sales_date(p->>'due_on');
  v_label text := nullif(left(btrim(coalesce(p->>'label', '')), 200), '');
  v_who uuid := private.sales_uuid(p->>'responsible_id'); v_id uuid := p_id;
begin
  if v_due is null or v_label is null or not private.sales_in_company(v_who, v_company) then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.sales_deadlines (company_id, rfp_id, kind, label, due_on, responsible_id, auto)
      values (v_company, r.id, 'other', v_label, v_due, v_who, false) returning id into v_id;
  else
    update public.sales_deadlines set label = v_label, due_on = v_due, responsible_id = v_who
     where id = p_id and rfp_id = r.id and not auto;
    if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
  end if;
  perform private.sales_touch(r.id, 'edit', jsonb_build_object('fields', jsonb_build_array('deadline')));
  return v_id;
end $$;

create or replace function public.app_sales_set_deadline_done(p_id uuid, p_done boolean) returns void
    language plpgsql security definer set search_path to '' as $$
declare v_company uuid := private.sales_company('sales', 'edit'); v_rfp uuid;
begin
  select rfp_id into v_rfp from public.sales_deadlines where id = p_id and company_id = v_company;
  if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
  perform private.sales_rfp(v_rfp, v_company);
  update public.sales_deadlines set
    done_at = case when p_done then coalesce(done_at, now()) end,
    done_by = case when p_done then coalesce(done_by, auth.uid()) end
  where id = p_id;
  update public.sales_rfps set updated_by = auth.uid(), updated_at = now(), edited_after_import = true
   where id = v_rfp;
end $$;

create or replace function public.app_sales_delete_deadline(p_id uuid) returns void
    language plpgsql security definer set search_path to '' as $$
declare v_company uuid := private.sales_company('sales', 'edit'); v_rfp uuid;
begin
  select rfp_id into v_rfp from public.sales_deadlines where id = p_id and company_id = v_company and not auto;
  if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
  perform private.sales_rfp(v_rfp, v_company);
  delete from public.sales_deadlines where id = p_id;
  perform private.sales_touch(v_rfp, 'edit', jsonb_build_object('fields', jsonb_build_array('deadline')));
end $$;

create or replace function public.app_sales_save_document(p_rfp uuid, p_id uuid, p jsonb) returns uuid
    language plpgsql security definer set search_path to '' as $$
declare v_company uuid := private.sales_company('sales', 'edit');
  r public.sales_rfps := private.sales_rfp(p_rfp, v_company);
  d public.sales_documents; v_id uuid := p_id; v_who uuid;
begin
  if p_id is null then
    d.status := 'todo';
    select coalesce(max(position), 0) + 1 into d.position from public.sales_documents where rfp_id = r.id;
  else
    select * into d from public.sales_documents where id = p_id and rfp_id = r.id for update;
    if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
  end if;
  if p ? 'name' then d.name := left(btrim(coalesce(p->>'name', '')), 200); end if;
  if p ? 'status' then d.status := p->>'status'; end if;
  if p ? 'note' then d.note := nullif(left(btrim(coalesce(p->>'note', '')), 500), ''); end if;
  if p ? 'assignee_id' then
    v_who := private.sales_uuid(p->>'assignee_id');
    if not private.sales_in_company(v_who, v_company) then
      raise exception 'sales: invalid input' using errcode = '22023';
    end if;
    d.assignee_id := v_who;
  end if;
  if coalesce(d.name, '') = '' or d.status is null or d.status not in ('todo', 'in_progress', 'ready') then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.sales_documents (company_id, rfp_id, position, name, assignee_id, status, note)
      values (v_company, r.id, d.position, d.name, d.assignee_id, d.status, d.note) returning id into v_id;
  else
    update public.sales_documents set name = d.name, assignee_id = d.assignee_id, status = d.status,
      note = d.note where id = p_id;
  end if;
  perform private.sales_touch(r.id, 'edit', jsonb_build_object('fields', jsonb_build_array('documents')));
  return v_id;
end $$;

create or replace function public.app_sales_delete_document(p_id uuid) returns void
    language plpgsql security definer set search_path to '' as $$
declare v_company uuid := private.sales_company('sales', 'edit'); v_rfp uuid;
begin
  select rfp_id into v_rfp from public.sales_documents where id = p_id and company_id = v_company;
  if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
  perform private.sales_rfp(v_rfp, v_company);
  delete from public.sales_documents where id = p_id;
  perform private.sales_touch(v_rfp, 'edit', jsonb_build_object('fields', jsonb_build_array('documents')));
end $$;

-- ================================================================ items (the ID tree)
create or replace function public.app_project_save_node(p_rfp uuid, p_id uuid, p_parent uuid, p jsonb)
    returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_company uuid := private.sales_company('project_items', 'edit');
  r public.sales_rfps; n public.project_nodes; v_patch jsonb; v_seq integer; v_code text; v_depth integer;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_patch from jsonb_each(p)
   where key = any (array['description','product_type','size','rating','qty','unit','custom']);
  if v_patch ? 'custom' then
    if jsonb_typeof(v_patch->'custom') <> 'object' then
      raise exception 'sales: invalid input' using errcode = '22023';
    end if;
    v_patch := jsonb_set(v_patch, '{custom}', coalesce((
      select jsonb_object_agg(key, value) from jsonb_each(v_patch->'custom')
       where key ~ '^x_[a-z0-9_]{1,38}$' and jsonb_typeof(value) <> 'null'
         and value <> '""'::jsonb), '{}'::jsonb));
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
  n.updated_by := auth.uid(); n.updated_at := now();
  begin
    n := jsonb_populate_record(n, v_patch);
    n.custom := coalesce(n.custom, '{}'::jsonb);
    if p_id is null then
      insert into public.project_nodes select n.*;
    else
      update public.project_nodes set description = n.description, product_type = n.product_type,
        size = n.size, rating = n.rating, qty = n.qty, unit = n.unit, custom = n.custom,
        updated_by = n.updated_by, updated_at = n.updated_at
      where id = p_id;
    end if;
  exception when others then
    raise exception 'sales: invalid input' using errcode = '22023';
  end;
  perform private.sales_recalc_price(p_rfp);
  perform private.sales_touch(p_rfp, 'items', jsonb_build_object('code', n.code,
    'action', case when p_id is null then 'added' else 'changed' end));
  return jsonb_build_object('id', n.id, 'code', n.code);
end $$;

create or replace function public.app_project_delete_node(p_id uuid) returns void
    language plpgsql security definer set search_path to '' as $$
declare v_company uuid := private.sales_company('project_items', 'edit'); n public.project_nodes;
begin
  select * into n from public.project_nodes where id = p_id and company_id = v_company;
  if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
  perform private.sales_rfp(n.rfp_id, v_company);
  -- Counters stay as they are: the number (and those under it) is retired.
  delete from public.project_nodes where id = p_id;
  perform private.sales_recalc_price(n.rfp_id);
  perform private.sales_touch(n.rfp_id, 'items', jsonb_build_object('code', n.code, 'action', 'removed'));
end $$;

create or replace function public.app_project_set_columns(p_rfp uuid, p_columns jsonb) returns void
    language plpgsql security definer set search_path to '' as $$
declare v_company uuid := private.sales_company('project_items', 'edit');
  r public.sales_rfps := private.sales_rfp(p_rfp, v_company);
begin
  if p_columns is null or jsonb_typeof(p_columns) <> 'object' or exists (
       select 1 from jsonb_each(p_columns) e
        where e.key !~ '^[1-9]$' or jsonb_typeof(e.value) <> 'array' or jsonb_array_length(e.value) > 40
           or exists (select 1 from jsonb_array_elements(e.value) c
                       where jsonb_typeof(c) <> 'string'
                          or not ((c #>> '{}') in ('product_type','size','rating','qty','unit')
                                  or exists (select 1 from public.sales_field_defs d
                                              where d.company_id = v_company and d.entity = 'item'
                                                and d.key = (c #>> '{}'))))) then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  update public.sales_rfps set item_columns = p_columns where id = r.id;
  perform private.sales_touch(r.id, 'items', jsonb_build_object('action', 'columns'));
end $$;

create or replace function public.app_sales_set_item_price(p_node uuid, p_price numeric) returns void
    language plpgsql security definer set search_path to '' as $$
declare v_company uuid := private.sales_company('sales_prices', 'edit'); n public.project_nodes;
begin
  select * into n from public.project_nodes where id = p_node and company_id = v_company;
  if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
  perform private.sales_rfp(n.rfp_id, v_company);
  if p_price is null then
    delete from public.sales_item_prices where node_id = p_node;
  elsif p_price < 0 or p_price >= 1e16 then
    raise exception 'sales: invalid input' using errcode = '22023';
  else
    insert into public.sales_item_prices (node_id, unit_price) values (p_node, p_price)
      on conflict (node_id) do update set unit_price = excluded.unit_price;
  end if;
  perform private.sales_recalc_price(n.rfp_id);
  perform private.sales_touch(n.rfp_id, 'edit', jsonb_build_object('fields', jsonb_build_array('item_price')));
end $$;

-- ================================================================ settings
-- Extra columns. Sales settings holders manage both kinds; whoever edits items may add
-- or change an item column (engineering creates the columns it needs).
create or replace function public.app_sales_save_field(p_id uuid, p jsonb) returns uuid
    language plpgsql security definer set search_path to '' as $$
declare v_company uuid := private.sales_company();
  d public.sales_field_defs; v_id uuid := p_id; v_key text; v_try integer := 0;
begin
  if p_id is null then
    d.entity := p->>'entity'; d.type := coalesce(p->>'type', 'text'); d.options := '{}';
    d.show_in_list := false; d.active := true;
    if d.entity is null or d.entity not in ('rfp', 'item') then
      raise exception 'sales: invalid input' using errcode = '22023';
    end if;
  else
    select * into d from public.sales_field_defs where id = p_id and company_id = v_company for update;
    if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
  end if;
  if not (private.sales_can('sales_settings')
          or (d.entity = 'item' and private.sales_can('project_items'))) then
    raise exception 'sales: not allowed' using errcode = '42501';
  end if;
  if p ? 'label_fa' then d.label_fa := left(btrim(coalesce(p->>'label_fa', '')), 80); end if;
  if p ? 'label_en' then d.label_en := left(btrim(coalesce(p->>'label_en', '')), 80); end if;
  if p_id is null and p ? 'type' then d.type := p->>'type'; end if;
  if p ? 'options' and jsonb_typeof(p->'options') = 'array' then
    d.options := coalesce((select array_agg(left(btrim(o), 80)) from jsonb_array_elements_text(p->'options') o
                            where btrim(o) <> ''), '{}');
  end if;
  if p ? 'show_in_list' then d.show_in_list := coalesce((p->>'show_in_list')::boolean, false); end if;
  if p ? 'active' then d.active := coalesce((p->>'active')::boolean, true); end if;
  if p ? 'position' then d.position := coalesce(private.sales_num(p->>'position')::integer, 0); end if;
  d.label_fa := coalesce(nullif(d.label_fa, ''), nullif(d.label_en, ''));
  d.label_en := coalesce(nullif(d.label_en, ''), d.label_fa);
  if d.label_fa is null or d.type not in ('text', 'number', 'date', 'select', 'yes_no') then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  if p_id is null then
    select coalesce(max(position), 0) + 1 into d.position from public.sales_field_defs
     where company_id = v_company and entity = d.entity;
    -- The key is made here and never changes: x_ + the English label, made unique.
    v_key := left(btrim(regexp_replace(lower(d.label_en), '[^a-z0-9]+', '_', 'g'), '_'), 30);
    if v_key = '' then v_key := substr(md5(d.label_fa || clock_timestamp()::text), 1, 8); end if;
    d.key := 'x_' || v_key;
    while exists (select 1 from public.sales_field_defs
                   where company_id = v_company and entity = d.entity and key = d.key) loop
      v_try := v_try + 1;
      d.key := 'x_' || left(v_key, 26) || '_' || v_try;
    end loop;
    insert into public.sales_field_defs (company_id, entity, key, label_fa, label_en, type, options,
                                         position, show_in_list, active)
      values (v_company, d.entity, d.key, d.label_fa, d.label_en, d.type, d.options, d.position,
              d.show_in_list, d.active) returning id into v_id;
  else
    update public.sales_field_defs set label_fa = d.label_fa, label_en = d.label_en, options = d.options,
      position = d.position, show_in_list = d.show_in_list, active = d.active where id = p_id;
  end if;
  return v_id;
exception when invalid_text_representation then
  raise exception 'sales: invalid input' using errcode = '22023';
end $$;

create or replace function public.app_sales_save_stage(p_id uuid, p_flow uuid, p jsonb) returns uuid
    language plpgsql security definer set search_path to '' as $$
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
     or s.kind not in ('open', 'lost', 'no_bid', 'cancelled', 'done')
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
end $$;

create or replace function public.app_sales_order_stages(p_flow uuid, p_ids uuid[]) returns void
    language plpgsql security definer set search_path to '' as $$
declare v_company uuid := private.sales_company('sales_settings', 'edit');
begin
  if not exists (select 1 from public.sales_flows where id = p_flow and company_id = v_company)
     or (select count(*) from public.sales_stages where flow_id = p_flow)
        <> (select count(distinct x) from unnest(p_ids) x
              join public.sales_stages s on s.id = x and s.flow_id = p_flow) then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  update public.sales_stages s set position = t.ord
    from unnest(p_ids) with ordinality as t(sid, ord) where s.id = t.sid and s.flow_id = p_flow;
end $$;

create or replace function public.app_sales_save_settings(p jsonb) returns void
    language plpgsql security definer set search_path to '' as $$
declare v_company uuid := private.sales_company('sales_settings', 'edit');
  s public.sales_settings; v_next integer;
begin
  select * into s from public.sales_settings where company_id = v_company for update;
  if p ? 'next_record_no' then
    v_next := private.sales_num(p->>'next_record_no')::integer;
    if v_next is null or v_next < 1 or exists (
         select 1 from public.sales_rfps where company_id = v_company and record_no >= v_next) then
      raise exception 'sales: record number taken' using errcode = '23505';
    end if;
    s.next_record_no := v_next;
  end if;
  if p ? 'warn_days' then s.warn_days := private.sales_num(p->>'warn_days')::integer; end if;
  if p ? 'validity_days' then s.validity_days := private.sales_num(p->>'validity_days')::integer; end if;
  if p ? 'doc_template' and jsonb_typeof(p->'doc_template') = 'array' then
    s.doc_template := coalesce((select array_agg(left(btrim(t), 200))
      from jsonb_array_elements_text(p->'doc_template') t where btrim(t) <> ''), '{}');
  end if;
  begin
    update public.sales_settings set next_record_no = s.next_record_no, warn_days = s.warn_days,
      validity_days = s.validity_days, doc_template = s.doc_template where company_id = v_company;
  exception when check_violation or not_null_violation then
    raise exception 'sales: invalid input' using errcode = '22023';
  end;
end $$;

-- ================================================================ ledger import
-- p_rows: rows already normalised by lib/sales/ledger.ts (checked again here: a row
-- that cannot be read is skipped, never an error). p_fields: headers to keep as extra
-- record fields. p_people: {ledger name: profile id} chosen in the preview.
-- Rules: one record per Rec, updated when it exists; an empty cell never overwrites a
-- stored value; the stage follows the ledger only until someone edits the record here.
create or replace function public.app_sales_import(
    p_file text, p_rows jsonb, p_fields jsonb default '[]', p_people jsonb default '{}')
    returns jsonb language plpgsql security definer set search_path to '' as $$
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
                                       import_batch_id, created_by, updated_by)
          values (v_company, v_rec, coalesce(v_title, 'Record ' || v_rec), v_flow, v_stage, 'won',
                  v_batch, auth.uid(), auth.uid())
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
end $$;

-- Clear test data: the records a batch CREATED that nobody has worked on since. Records it
-- only updated, and records edited here, stay. The one delete path for records.
create or replace function public.app_sales_remove_batch(p_batch uuid) returns jsonb
    language plpgsql security definer set search_path to '' as $$
declare v_company uuid := private.sales_company('sales_settings', 'edit'); v_deleted integer; v_kept integer;
begin
  if not exists (select 1 from public.sales_import_batches where id = p_batch and company_id = v_company) then
    raise exception 'sales: not found' using errcode = 'P0002';
  end if;
  with gone as (
    delete from public.sales_rfps
     where company_id = v_company and import_batch_id = p_batch and not edited_after_import returning 1)
  select count(*) into v_deleted from gone;
  select count(*) into v_kept from public.sales_rfps where import_batch_id = p_batch;
  delete from public.sales_customers c
   where c.company_id = v_company
     and not exists (select 1 from public.sales_rfps r where r.buyer_id = c.id or r.client_id = c.id);
  if v_kept = 0 then delete from public.sales_import_batches where id = p_batch; end if;
  return jsonb_build_object('deleted', v_deleted, 'kept', v_kept);
end $$;

-- ================================================================ grants
do $$
declare f text;
begin
  foreach f in array array[
    'app_sales_bootstrap()', 'app_sales_list()', 'app_sales_record(uuid)', 'app_sales_deadlines(boolean)',
    'app_sales_find_node(text)', 'app_sales_price_history(text)',
    'app_sales_save_record(uuid, jsonb)', 'app_sales_move_stage(uuid, uuid, uuid, text, jsonb)',
    'app_sales_decide(uuid, boolean, text)', 'app_sales_result(uuid, text, jsonb)',
    'app_sales_comment(uuid, text)',
    'app_sales_save_bond(uuid, uuid, jsonb)', 'app_sales_delete_bond(uuid)',
    'app_sales_save_payment(uuid, uuid, jsonb)', 'app_sales_delete_payment(uuid)',
    'app_sales_save_deadline(uuid, uuid, jsonb)', 'app_sales_set_deadline_done(uuid, boolean)',
    'app_sales_delete_deadline(uuid)',
    'app_sales_save_document(uuid, uuid, jsonb)', 'app_sales_delete_document(uuid)',
    'app_project_save_node(uuid, uuid, uuid, jsonb)', 'app_project_delete_node(uuid)',
    'app_project_set_columns(uuid, jsonb)', 'app_sales_set_item_price(uuid, numeric)',
    'app_sales_save_field(uuid, jsonb)', 'app_sales_save_stage(uuid, uuid, jsonb)',
    'app_sales_order_stages(uuid, uuid[])', 'app_sales_save_settings(jsonb)',
    'app_sales_import(text, jsonb, jsonb, jsonb)', 'app_sales_remove_batch(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
