-- FR-99 (2026-11-27) part 1: ERP › Sales change history.
-- Spec docs/specs/2026-11-27-sales-customer-phonebook-history-design.md §5, §11; plan Task 1.
-- * New append-only table sales_audit (customers, products, settings, imports); records keep sales_events.
-- * private.sales_log / sales_diff / sales_strip_private (privacy at read time).
-- * Logging added to products, currencies, stages, fields, general settings, categories, cities,
--   aliases / Name matching, ledger + inquiry imports; set_deadline_done logs a record event.
--   Customer functions and app_sales_remove_batch are redefined with logging by part 2 (phone book).
-- * Readers app_sales_product_history and app_sales_activity (new permission sales_activity, read only).
-- Every Sales write function is listed in tests/sql/sales-history.sql (logs / read-only / exempt).

-- ---------------------------------------------------------------- permissions (FR-55 catalog)
create or replace function private.permission_keys() returns setof text
  language sql immutable set search_path = '' as $$
  select unnest(array['people','people_create','reset_employee_password','role_manager','role_assign',
    'personal_info','personal_info_own','clearance','departments','leave_balances','leave_accrual',
    'annual_leave_borrow','special_leave','leave_requests','calendar','reports','approval_steps','approval_delegate',
    'work_settings','holidays','finance','finance_forms','travel_booking',
    'edit_leave_daily','edit_leave_hourly','edit_errand_daily','edit_errand_hourly','edit_requests_own',
    'sales','sales_prices','sales_bonds','sales_decide','sales_reports','sales_settings','project_items',
    'sales_customers','sales_customers_import','sales_activity']);
$$;

create or replace function private.permission_allows(p_key text, p_level text) returns boolean
  language sql immutable set search_path = '' as $$
  select case
    when p_key in ('people_create','reset_employee_password','role_manager','role_assign','leave_accrual',
      'personal_info_own','annual_leave_borrow','special_leave','approval_delegate','travel_booking',
      'edit_leave_daily','edit_leave_hourly','edit_errand_daily','edit_errand_hourly',
      'edit_requests_own','sales_decide','sales_settings','sales_customers','sales_customers_import') then p_level = 'edit'
    when p_key in ('calendar','reports','finance','finance_forms','sales_reports','sales_activity') then p_level = 'read'
    when p_key in ('people','personal_info','clearance','departments','leave_balances',
      'leave_requests','approval_steps','work_settings','holidays',
      'sales','sales_prices','sales_bonds','project_items') then p_level in ('read','edit')
    else false end;
$$;

create or replace function private.permission_deps() returns table(key text, key_level text, needs text)
  language sql immutable set search_path = '' as $$
  values
    ('finance_forms','read','finance'),
    ('people_create','read','people'), ('reset_employee_password','read','people'),
    ('role_manager','read','people'), ('role_manager','read','leave_balances'),
    ('role_manager','read','calendar'), ('role_assign','read','people'),
    ('personal_info','read','people'), ('clearance','edit','people'),
    ('departments','read','people'), ('leave_balances','read','people'),
    ('leave_accrual','read','departments'), ('leave_requests','read','people'),
    ('approval_steps','read','people'), ('reports','read','people'),
    ('reports','read','leave_balances'), ('reports','read','leave_requests'),
    ('special_leave','read','people'), ('special_leave','read','leave_balances'),
    ('edit_leave_daily','read','leave_requests'), ('edit_leave_hourly','read','leave_requests'),
    ('edit_errand_daily','read','leave_requests'), ('edit_errand_hourly','read','leave_requests'),
    ('edit_requests_own','read','leave_requests'),
    ('sales_prices','read','sales'), ('sales_bonds','read','sales'), ('sales_decide','read','sales'),
    ('sales_reports','read','sales'), ('sales_settings','read','sales'), ('project_items','read','sales'),
    ('sales_customers','read','sales'), ('sales_customers_import','read','sales_customers'),
    ('sales_activity','read','sales');
$$;

-- ---------------------------------------------------------------- table sales_audit (function-only)
create table public.sales_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,             -- no FK: the history outlives everything it names
  at timestamptz not null default clock_timestamp(),
  actor_id uuid,
  entity text not null check (entity in ('customer', 'product', 'settings', 'import')),
  entity_id uuid,                        -- no FK: deleted / merged rows keep their history
  entity_label text,                     -- the name at write time
  action text not null check (char_length(action) between 1 and 40),
  body jsonb not null default '{}'::jsonb
);
create index sales_audit_company_at on public.sales_audit (company_id, at desc, id);
create index sales_audit_entity on public.sales_audit (company_id, entity, entity_id, at desc);
create index sales_audit_actor on public.sales_audit (company_id, actor_id, at desc);
alter table public.sales_audit enable row level security;
revoke all on public.sales_audit from public, anon, authenticated;

-- Append-only. A statement trigger (not per row): it also refuses a statement that RLS would
-- leave with no rows. Not security definer, so current_user is the real caller; only the
-- maintenance roles (restores) pass.
create function private.sales_audit_append_only() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if current_user in ('supabase_admin', 'postgres') then return null; end if;
  raise exception 'sales: history is read-only' using errcode = '42501';
end $$;
create trigger sales_audit_append_only before update or delete or truncate on public.sales_audit
  for each statement execute function private.sales_audit_append_only();

-- The Activity page reads record events by company and time / actor.
create index sales_events_company_at on public.sales_events (company_id, at desc, id);
create index sales_events_company_actor on public.sales_events (company_id, actor_id, at desc);

-- ---------------------------------------------------------------- helpers
create function private.sales_log(p_company uuid, p_entity text, p_entity_id uuid, p_label text,
                                  p_action text, p_body jsonb default '{}'::jsonb) returns void
  language plpgsql security definer set search_path = '' as $$
begin
  insert into public.sales_audit (company_id, actor_id, entity, entity_id, entity_label, action, body)
    values (p_company, auth.uid(), p_entity, p_entity_id, left(p_label, 300), p_action,
            coalesce(p_body, '{}'::jsonb));
end $$;

-- [{field, from, to, private?}] for every top-level key whose value differs, ordered by key.
-- A key `<name>_id` is left out when `<name>` holds an {id, name} object (list refs are logged with
-- the name they had, so a later rename does not rewrite history).
create function private.sales_diff(p_before jsonb, p_after jsonb, p_private text[] default '{}'::text[])
  returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('field', ks.k, 'from', x.b -> ks.k, 'to', x.a -> ks.k)
           || case when ks.k = any (coalesce(p_private, '{}'::text[])) then '{"private": true}'::jsonb
                   else '{}'::jsonb end
           order by ks.k), '[]'::jsonb)
    from (select case when jsonb_typeof(p_before) = 'object' then p_before else '{}'::jsonb end as b,
                 case when jsonb_typeof(p_after) = 'object' then p_after else '{}'::jsonb end as a) x
   cross join lateral (select jsonb_object_keys(x.b) union select jsonb_object_keys(x.a)) as ks(k)
   where (x.b -> ks.k) is distinct from (x.a -> ks.k)
     and not (ks.k like '%\_id'
              and (jsonb_typeof(x.b -> left(ks.k, -3)) = 'object' or jsonb_typeof(x.a -> left(ks.k, -3)) = 'object'));
$$;

-- Walks a history body for a caller without sales_customers: private keys (anywhere) become
-- private_changed, a change marked private (or naming a private field) keeps only {field, private}.
create function private.sales_strip_walk(p jsonb) returns jsonb
  language plpgsql immutable set search_path = '' as $$
declare v jsonb := '{}'::jsonb; k text; e jsonb; v_hit boolean := false;
  v_keys text[] := array['ceo_name', 'ceo_phone', 'address', 'people', 'contacts'];
begin
  if jsonb_typeof(p) = 'object' then
    if p->'private' = 'true'::jsonb or (jsonb_typeof(p->'field') = 'string' and p->>'field' = any (v_keys)) then
      return jsonb_build_object('field', p->'field', 'private', true);
    end if;
    for k, e in select * from jsonb_each(p) loop
      if k = any (v_keys) then v_hit := true;
      else v := v || jsonb_build_object(k, private.sales_strip_walk(e));
      end if;
    end loop;
    if v_hit then v := v || '{"private_changed": true}'::jsonb; end if;
    return v;
  elsif jsonb_typeof(p) = 'array' then
    return coalesce((select jsonb_agg(private.sales_strip_walk(t.x) order by t.i)
                       from jsonb_array_elements(p) with ordinality as t(x, i)), '[]'::jsonb);
  end if;
  return p;
end $$;

create function private.sales_strip_private(p_body jsonb, p_private boolean) returns jsonb
  language plpgsql immutable set search_path = '' as $$
declare v jsonb;
begin
  if p_private or p_body is null then return p_body; end if;
  v := private.sales_strip_walk(p_body);
  if v is distinct from p_body and jsonb_typeof(v) = 'object' then
    v := v || '{"private_changed": true}'::jsonb;
  end if;
  return v;
end $$;

-- op of a list entry save: created | hidden | shown | edited.
create function private.sales_list_op(p_new boolean, p_before jsonb, p_after jsonb) returns text
  language sql immutable set search_path = '' as $$
  select case when p_new then 'created'
              when (p_before->>'active')::boolean and not (p_after->>'active')::boolean then 'hidden'
              when not (p_before->>'active')::boolean and (p_after->>'active')::boolean then 'shown'
              else 'edited' end;
$$;

create function private.sales_product_snapshot(p_id uuid) returns jsonb
  language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('name_fa', p.name_fa, 'name_en', p.name_en, 'code', p.code, 'active', p.active,
           'position', p.position,
           'fields', (select coalesce(jsonb_agg(jsonb_build_object('field', f.field, 'default', f."default")
                                                order by f.position, f.field), '[]'::jsonb)
                        from public.sales_product_fields f where f.product_id = p.id))
    from public.sales_products p where p.id = p_id;
$$;

create function private.sales_stage_snapshot(p_id uuid) returns jsonb
  language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('name_fa', s.name_fa, 'name_en', s.name_en, 'kind', s.kind, 'action', s.action,
           'active', s.active, 'required', to_jsonb(s.required),
           'owner_role', (select jsonb_build_object('id', r.id, 'name', r.name)
                            from public.roles r where r.id = s.owner_role_id))
    from public.sales_stages s where s.id = p_id;
$$;

-- ---------------------------------------------------------------- products
create or replace function public.app_sales_save_product(p_id uuid, p jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_company uuid := private.sales_company('sales_settings', 'edit');
  pr public.sales_products; e jsonb; v_pos integer := 0; v_field text; v_before jsonb := '{}'; v_changes jsonb;
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
    v_before := private.sales_product_snapshot(p_id);
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
  v_changes := private.sales_diff(v_before, private.sales_product_snapshot(pr.id));
  if p_id is null or v_changes <> '[]'::jsonb then
    perform private.sales_log(v_company, 'product', pr.id, pr.name_fa,
      case when p_id is null then 'created' else 'edited' end, jsonb_build_object('changes', v_changes));
  end if;
  return pr.id;
end $$;

create or replace function public.app_sales_delete_product(p_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_company uuid := private.sales_company('sales_settings', 'edit'); v_name text; v_snap jsonb;
begin
  select name_fa into v_name from public.sales_products where id = p_id and company_id = v_company for update;
  if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.project_nodes where product_id = p_id) then
    raise exception 'sales: in use' using errcode = '22023';
  end if;
  v_snap := private.sales_product_snapshot(p_id);
  delete from public.sales_products where id = p_id;
  perform private.sales_log(v_company, 'product', p_id, v_name, 'deleted', jsonb_build_object('snapshot', v_snap));
end $$;

-- ---------------------------------------------------------------- currencies
create or replace function public.app_sales_save_currency(p_code text, p jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare v_company uuid := private.sales_company('sales_settings', 'edit');
  c public.sales_currencies; v_new boolean; v_before jsonb := '{}'; v_after jsonb; v_changes jsonb;
begin
  if p_code is null or p_code !~ '^[A-Za-z0-9]{1,10}$' or p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  select * into c from public.sales_currencies where company_id = v_company and code = p_code for update;
  v_new := not found;
  if v_new then
    c.company_id := v_company; c.code := p_code; c.active := true; c.decimals := 0;
    c.position := (select coalesce(max(position), 0) + 1 from public.sales_currencies where company_id = v_company);
  else
    v_before := to_jsonb(c) - 'company_id';
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
  v_after := to_jsonb(c) - 'company_id';
  v_changes := private.sales_diff(v_before, v_after);
  if v_new or v_changes <> '[]'::jsonb then
    perform private.sales_log(v_company, 'settings', null, c.name_fa, 'currency',
      jsonb_build_object('op', private.sales_list_op(v_new, v_before, v_after), 'name', c.name_fa,
                         'name_en', c.name_en, 'code', c.code, 'changes', v_changes));
  end if;
end $_$;

create or replace function public.app_sales_delete_currency(p_code text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_company uuid := private.sales_company('sales_settings', 'edit'); c public.sales_currencies;
begin
  select * into c from public.sales_currencies where company_id = v_company and code = p_code for update;
  if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.sales_rfps where company_id = v_company and currency = p_code)
     or exists (select 1 from public.sales_bonds where company_id = v_company and currency = p_code) then
    raise exception 'sales: in use' using errcode = '22023';
  end if;
  delete from public.sales_currencies where company_id = v_company and code = p_code;
  perform private.sales_log(v_company, 'settings', null, c.name_fa, 'currency',
    jsonb_build_object('op', 'deleted', 'name', c.name_fa, 'name_en', c.name_en, 'code', c.code,
                       'snapshot', to_jsonb(c) - 'company_id'));
end $$;

-- ---------------------------------------------------------------- stages and fields
create or replace function public.app_sales_save_stage(p_id uuid, p_flow uuid, p jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare v_company uuid := private.sales_company('sales_settings', 'edit');
  s public.sales_stages; v_id uuid := p_id; v_role uuid; v_before jsonb := '{}'; v_after jsonb; v_changes jsonb;
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
    v_before := private.sales_stage_snapshot(p_id);
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
  v_after := private.sales_stage_snapshot(v_id);
  v_changes := private.sales_diff(v_before, v_after);
  if p_id is null or v_changes <> '[]'::jsonb then
    perform private.sales_log(v_company, 'settings', v_id, s.name_fa, 'stage',
      jsonb_build_object('op', private.sales_list_op(p_id is null, v_before, v_after), 'name', s.name_fa,
                         'name_en', s.name_en, 'flow', s.flow_id, 'changes', v_changes));
  end if;
  return v_id;
exception when invalid_text_representation then
  raise exception 'sales: invalid input' using errcode = '22023';
end $_$;

create or replace function public.app_sales_order_stages(p_flow uuid, p_ids uuid[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_company uuid := private.sales_company('sales_settings', 'edit'); v_from jsonb; v_to jsonb;
begin
  if not exists (select 1 from public.sales_flows where id = p_flow and company_id = v_company)
     or (select count(*) from public.sales_stages where flow_id = p_flow)
        <> (select count(distinct x) from unnest(p_ids) x
              join public.sales_stages s on s.id = x and s.flow_id = p_flow) then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(name_fa order by position, id), '[]') into v_from
    from public.sales_stages where flow_id = p_flow;
  update public.sales_stages s set position = t.ord
    from unnest(p_ids) with ordinality as t(sid, ord) where s.id = t.sid and s.flow_id = p_flow;
  select coalesce(jsonb_agg(name_fa order by position, id), '[]') into v_to
    from public.sales_stages where flow_id = p_flow;
  if v_from is distinct from v_to then
    perform private.sales_log(v_company, 'settings', p_flow,
      (select name_fa from public.sales_flows where id = p_flow), 'stage_order',
      jsonb_build_object('flow', p_flow, 'flow_kind', (select kind from public.sales_flows where id = p_flow),
                         'from', v_from, 'order', v_to));
  end if;
end $$;

create or replace function public.app_sales_save_field(p_id uuid, p jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_company uuid := private.sales_company();
  d public.sales_field_defs; v_id uuid := p_id; v_key text; v_try integer := 0;
  v_before jsonb := '{}'; v_after jsonb; v_changes jsonb;
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
    v_before := to_jsonb(d) - array['company_id', 'id'];
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
  select to_jsonb(x) - array['company_id', 'id'] into v_after from public.sales_field_defs x where x.id = v_id;
  v_changes := private.sales_diff(v_before, v_after);
  if p_id is null or v_changes <> '[]'::jsonb then
    perform private.sales_log(v_company, 'settings', v_id, d.label_fa, 'field',
      jsonb_build_object('op', private.sales_list_op(p_id is null, v_before, v_after), 'name', d.label_fa,
                         'name_en', d.label_en, 'entity', d.entity, 'key', v_after->>'key', 'changes', v_changes));
  end if;
  return v_id;
exception when invalid_text_representation then
  raise exception 'sales: invalid input' using errcode = '22023';
end $$;

create or replace function public.app_sales_save_settings(p jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_company uuid := private.sales_company('sales_settings', 'edit');
  s public.sales_settings; v_next integer; v_before jsonb; v_changes jsonb;
begin
  select * into s from public.sales_settings where company_id = v_company for update;
  v_before := to_jsonb(s) - 'company_id';
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
  v_changes := private.sales_diff(v_before,
    (select to_jsonb(x) - 'company_id' from public.sales_settings x where x.company_id = v_company));
  if v_changes <> '[]'::jsonb then
    perform private.sales_log(v_company, 'settings', null, null, 'general', jsonb_build_object('changes', v_changes));
  end if;
end $$;

-- ---------------------------------------------------------------- customer lists
create or replace function public.app_sales_save_category(p jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_company uuid := private.sales_company(); v_id uuid; v_fa text; v_en text; v_key text; v_other uuid;
  v_row public.sales_contractor_categories; v_before jsonb := '{}'; v_after jsonb; v_changes jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'sales: invalid input' using errcode = '22023'; end if;
  v_id := private.sales_uuid(p->>'id');
  if nullif(p->>'id', '') is not null and v_id is null then raise exception 'sales: invalid input' using errcode = '22023'; end if;
  if v_id is null and not (private.sales_can('sales_customers') or private.sales_can('sales_settings')) then
    raise exception 'sales: not allowed' using errcode = '42501';
  end if;
  if v_id is not null and not private.sales_can('sales_settings') then
    raise exception 'sales: not allowed' using errcode = '42501';
  end if;
  v_fa := private.sales_clean(p->>'name_fa'); v_en := private.sales_clean(p->>'name_en');
  v_key := private.sales_name_key(v_fa);
  if v_fa is null or v_key = '' then raise exception 'sales: invalid input' using errcode = '22023'; end if;
  perform private.sales_customer_lock(v_company);
  select id into v_other from public.sales_contractor_categories
   where company_id = v_company and name_key = v_key and id is distinct from v_id;
  if v_other is not null then
    raise exception 'sales: duplicate name' using errcode = '23505',
      hint = (select jsonb_build_object('id', id, 'name', name_fa, 'name_en', name_en)::text
                from public.sales_contractor_categories where id = v_other);
  end if;
  if v_id is not null then
    select to_jsonb(x) - array['company_id', 'id', 'name_key', 'created_by', 'created_at'] into v_before
      from public.sales_contractor_categories x where x.id = v_id and x.company_id = v_company;
  end if;
  begin
    if v_id is null then
      insert into public.sales_contractor_categories (company_id, name_fa, name_key, name_en, position, created_by)
        values (v_company, v_fa, v_key, v_en,
                coalesce(private.sales_num(p->>'position')::integer,
                         (select coalesce(max(position), 0) + 1 from public.sales_contractor_categories
                           where company_id = v_company)), auth.uid())
        returning * into v_row;
    else
      update public.sales_contractor_categories set name_fa = v_fa, name_key = v_key, name_en = v_en,
          active = coalesce((p->>'active')::boolean, active),
          position = coalesce(private.sales_num(p->>'position')::integer, position)
       where id = v_id and company_id = v_company returning * into v_row;
      if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
    end if;
  exception when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range then
    raise exception 'sales: invalid input' using errcode = '22023';
  end;
  v_after := to_jsonb(v_row) - array['company_id', 'id', 'name_key', 'created_by', 'created_at'];
  v_changes := private.sales_diff(v_before, v_after);
  if v_id is null or v_changes <> '[]'::jsonb then
    perform private.sales_log(v_company, 'settings', v_row.id, v_row.name_fa, 'category',
      jsonb_build_object('op', private.sales_list_op(v_id is null, v_before, v_after), 'name', v_row.name_fa,
                         'name_en', v_row.name_en, 'changes', v_changes));
  end if;
  return to_jsonb(v_row) - array['company_id', 'name_key', 'created_by'];
end $$;

create or replace function public.app_sales_save_city(p jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_company uuid := private.sales_company(); v_id uuid; v_fa text; v_en text; v_key text; v_prov text;
  v_other uuid; v_row public.sales_cities; v_before jsonb := '{}'; v_after jsonb; v_changes jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'sales: invalid input' using errcode = '22023'; end if;
  v_id := private.sales_uuid(p->>'id');
  if nullif(p->>'id', '') is not null and v_id is null then raise exception 'sales: invalid input' using errcode = '22023'; end if;
  if v_id is null and not (private.sales_can('sales_customers') or private.sales_can('sales_settings')) then
    raise exception 'sales: not allowed' using errcode = '42501';
  end if;
  if v_id is not null and not private.sales_can('sales_settings') then
    raise exception 'sales: not allowed' using errcode = '42501';
  end if;
  v_fa := private.sales_clean(p->>'name_fa'); v_en := private.sales_clean(p->>'name_en');
  v_key := private.sales_name_key(v_fa);
  if v_id is null then
    v_prov := nullif(p->>'province_code', '');
  else
    select province_code into v_prov from public.sales_cities where id = v_id and company_id = v_company;
    if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
  end if;
  if v_fa is null or v_key = '' or v_prov is null
     or not exists (select 1 from public.iran_provinces where code = v_prov) then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  perform private.sales_customer_lock(v_company);
  select id into v_other from public.sales_cities
   where company_id = v_company and province_code = v_prov and name_key = v_key and id is distinct from v_id;
  if v_other is not null then
    raise exception 'sales: duplicate name' using errcode = '23505',
      hint = (select jsonb_build_object('id', id, 'name', name_fa, 'name_en', name_en)::text
                from public.sales_cities where id = v_other);
  end if;
  if v_id is not null then
    select to_jsonb(x) - array['company_id', 'id', 'name_key', 'created_by', 'created_at'] into v_before
      from public.sales_cities x where x.id = v_id;
  end if;
  begin
    if v_id is null then
      insert into public.sales_cities (company_id, province_code, name_fa, name_key, name_en, created_by)
        values (v_company, v_prov, v_fa, v_key, v_en, auth.uid()) returning * into v_row;
    else
      update public.sales_cities set name_fa = v_fa, name_key = v_key, name_en = v_en,
          active = coalesce((p->>'active')::boolean, active)
       where id = v_id returning * into v_row;
    end if;
  exception when check_violation or not_null_violation or invalid_text_representation then
    raise exception 'sales: invalid input' using errcode = '22023';
  end;
  v_after := to_jsonb(v_row) - array['company_id', 'id', 'name_key', 'created_by', 'created_at'];
  v_changes := private.sales_diff(v_before, v_after);
  if v_id is null or v_changes <> '[]'::jsonb then
    perform private.sales_log(v_company, 'settings', v_row.id, v_row.name_fa, 'city',
      jsonb_build_object('op', private.sales_list_op(v_id is null, v_before, v_after), 'name', v_row.name_fa,
                         'name_en', v_row.name_en, 'province_code', v_row.province_code, 'changes', v_changes));
  end if;
  return to_jsonb(v_row) - array['company_id', 'name_key', 'created_by'];
end $$;

-- ---------------------------------------------------------------- aliases and Name matching
create or replace function public.app_sales_remove_alias(p_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_company uuid := private.sales_company('sales_settings', 'edit'); a public.sales_name_aliases;
begin
  delete from public.sales_name_aliases where id = p_id and company_id = v_company returning * into a;
  if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
  if a.kind = 'customer' then
    perform private.sales_log(v_company, 'customer', a.target_id,
      (select name from public.sales_customers where id = a.target_id), 'alias_removed',
      jsonb_build_object('name', a.alias));
  else
    perform private.sales_log(v_company, 'settings', a.target_id, a.alias, 'name_match',
      jsonb_build_object('op', 'removed', 'name', a.alias, 'profile_id', a.target_id,
                         'profile_name', (select full_name from public.profiles where id = a.target_id)));
  end if;
end $$;

create or replace function public.app_sales_match_person(p_name text, p_profile uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
  if v_old is distinct from p_profile or v_n > 0 then
    perform private.sales_log(v_company, 'settings', coalesce(p_profile, v_old), v_name, 'name_match',
      jsonb_build_object('op', case when p_profile is null then 'removed' else 'added' end, 'name', v_name,
                         'profile_id', coalesce(p_profile, v_old), 'profile_name', coalesce(v_to, v_from),
                         'from_name', v_from, 'updated', v_n));
  end if;
  return jsonb_build_object('updated', v_n);
end $$;

-- ---------------------------------------------------------------- record gap: deadline done / reopened
-- A direct event, not sales_touch: its sales_sync_deadlines would mark a reopened automatic
-- deadline done again.
create or replace function public.app_sales_set_deadline_done(p_id uuid, p_done boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_company uuid := private.sales_company('sales', 'edit'); v_rfp uuid; d public.sales_deadlines;
begin
  select rfp_id into v_rfp from public.sales_deadlines where id = p_id and company_id = v_company;
  if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
  perform private.sales_rfp(v_rfp, v_company);
  perform private.sales_writable(v_rfp);
  select * into d from public.sales_deadlines where id = p_id;
  update public.sales_deadlines set
    done_at = case when p_done then coalesce(done_at, now()) end,
    done_by = case when p_done then coalesce(done_by, auth.uid()) end
  where id = p_id;
  update public.sales_rfps set updated_by = auth.uid(), updated_at = now(), edited_after_import = true
   where id = v_rfp;
  if (d.done_at is not null) <> coalesce(p_done, false) then
    insert into public.sales_events (company_id, rfp_id, actor_id, kind, body)
      values (v_company, v_rfp, auth.uid(), 'edit',
              jsonb_build_object('deadline', jsonb_build_object('label', d.label, 'kind', d.kind),
                                 'done', coalesce(p_done, false)));
  end if;
end $$;

-- ---------------------------------------------------------------- imports (ledger, inquiries)
create or replace function public.app_sales_import(p_file text, p_rows jsonb, p_fields jsonb DEFAULT '[]'::jsonb, p_people jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
  perform private.sales_customer_lock(v_company);  -- FR-98 lock order
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000
     or jsonb_typeof(coalesce(p_fields, '[]')) <> 'array' or jsonb_typeof(coalesce(p_people, '{}')) <> 'object' then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  select id into v_flow from public.sales_flows where company_id = v_company and kind = 'contract';
  insert into public.sales_import_batches (company_id, file_name, created_by)
    values (v_company, nullif(left(btrim(coalesce(p_file, '')), 200), ''), auth.uid()) returning id into v_batch;
  -- FR-99: customers this import creates log their source (private.sales_customer reads it).
  perform set_config('bj.sales_source', 'ledger_import:' || v_batch::text, true);

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
  perform set_config('bj.sales_source', '', true);
  perform private.sales_log(v_company, 'import', v_batch, nullif(left(btrim(coalesce(p_file, '')), 200), ''),
    'ledger_import', jsonb_build_object('file', nullif(left(btrim(coalesce(p_file, '')), 200), ''),
      'created', v_created, 'updated', v_updated, 'skipped', v_skipped, 'deleted', v_deleted));
  return jsonb_build_object('batch_id', v_batch, 'created', v_created, 'updated', v_updated,
    'skipped', v_skipped, 'skipped_rows', v_reasons, 'deleted', v_deleted);
end $$;

create or replace function public.app_sales_import_inquiries(p_batch uuid, p_file text, p_rows jsonb, p_people jsonb DEFAULT '{}'::jsonb, p_cutoff date DEFAULT NULL::date, p_last boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
  perform private.sales_customer_lock(v_company);  -- FR-98 lock order
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
  -- FR-99: customers this import creates log their source (private.sales_customer reads it).
  perform set_config('bj.sales_source', 'inquiry_import:' || v_batch::text, true);
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
  perform set_config('bj.sales_source', '', true);
  -- One row per call (a file arrives in several calls): the counts of this call.
  perform private.sales_log(v_company, 'import', v_batch,
    (select file_name from public.sales_import_batches where id = v_batch), 'inquiry_import',
    jsonb_build_object('file', (select file_name from public.sales_import_batches where id = v_batch),
      'created', v_created, 'updated', v_updated, 'skipped', v_skipped, 'deleted', v_deleted,
      'by_result', v_by, 'last', coalesce(p_last, false)));
  return jsonb_build_object('batch_id', v_batch, 'created', v_created, 'updated', v_updated,
    'skipped', v_skipped, 'skipped_rows', v_reasons, 'by_result', v_by, 'deleted', v_deleted);
end $$;

-- ---------------------------------------------------------------- readers
create function public.app_sales_product_history(p_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
declare v_company uuid := private.sales_company();
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'at', a.at, 'actor_id', a.actor_id,
                    'actor_name', pr.full_name, 'action', a.action, 'body', a.body, 'entity_label', a.entity_label)
                  order by a.at desc, a.id desc), '[]'::jsonb)
            from (select * from public.sales_audit
                   where company_id = v_company and entity = 'product' and entity_id = p_id
                   order by at desc, id desc limit 500) a
            left join public.profiles pr on pr.id = a.actor_id);
end $$;

-- One page (50) of record events + sales_audit, newest first. p: {actor?, from?, to? (Tehran days,
-- inclusive), entity? (record|customer|product|settings|import), before? {at, id}}.
create function public.app_sales_activity(p jsonb default '{}'::jsonb) returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
declare v_company uuid := private.sales_company('sales_activity', 'read');
  v_private boolean := private.sales_can('sales_customers', 'edit');
  v_admin boolean := private.sales_is_admin();
  v_actor uuid; v_from timestamptz; v_to timestamptz; v_entity text; v_bat timestamptz; v_bid uuid;
  v_rows jsonb; v_next jsonb;
begin
  p := coalesce(p, '{}'::jsonb);
  if jsonb_typeof(p) <> 'object' then raise exception 'sales: invalid input' using errcode = '22023'; end if;
  if nullif(p->>'actor', '') is not null then
    v_actor := private.sales_uuid(p->>'actor');
    if v_actor is null then raise exception 'sales: invalid input' using errcode = '22023'; end if;
  end if;
  if nullif(p->>'from', '') is not null then
    v_from := private.sales_date(p->>'from')::timestamp at time zone 'Asia/Tehran';
    if v_from is null then raise exception 'sales: invalid input' using errcode = '22023'; end if;
  end if;
  if nullif(p->>'to', '') is not null then
    v_to := (private.sales_date(p->>'to') + 1)::timestamp at time zone 'Asia/Tehran';
    if v_to is null then raise exception 'sales: invalid input' using errcode = '22023'; end if;
  end if;
  v_entity := nullif(p->>'entity', '');
  if v_entity is not null and v_entity not in ('record', 'customer', 'product', 'settings', 'import') then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  if jsonb_typeof(p->'before') = 'object' then
    begin
      v_bat := (p->'before'->>'at')::timestamptz;
    exception when others then
      raise exception 'sales: invalid input' using errcode = '22023';
    end;
    v_bid := private.sales_uuid(p->'before'->>'id');
    if v_bat is null or v_bid is null then raise exception 'sales: invalid input' using errcode = '22023'; end if;
  end if;

  with ev as (
    select 'record'::text as source, e.id, e.at, e.actor_id, 'record'::text as entity, e.rfp_id as entity_id,
           r.record_no::text || ' · ' || r.title as entity_label, e.kind as action, e.body,
           r.deleted_at is null as present
      from public.sales_events e join public.sales_rfps r on r.id = e.rfp_id
     where e.company_id = v_company and e.kind <> 'import'   -- the import audit row stands for them
       and (r.deleted_at is null or v_admin)
       and (v_entity is null or v_entity = 'record')
       and (v_actor is null or e.actor_id = v_actor)
       and (v_from is null or e.at >= v_from) and (v_to is null or e.at < v_to)
       and (v_bat is null or (e.at, e.id) < (v_bat, v_bid))
     order by e.at desc, e.id desc limit 51),
  au as (
    select 'audit'::text, a.id, a.at, a.actor_id, a.entity, a.entity_id, a.entity_label, a.action, a.body,
           case a.entity
             when 'customer' then exists (select 1 from public.sales_customers c where c.id = a.entity_id)
             when 'product' then exists (select 1 from public.sales_products x where x.id = a.entity_id)
             when 'import' then exists (select 1 from public.sales_import_batches b where b.id = a.entity_id)
             else false end
      from public.sales_audit a
     where a.company_id = v_company
       and (v_entity is null or a.entity = v_entity)
       and (v_actor is null or a.actor_id = v_actor)
       and (v_from is null or a.at >= v_from) and (v_to is null or a.at < v_to)
       and (v_bat is null or (a.at, a.id) < (v_bat, v_bid))
     order by a.at desc, a.id desc limit 51),
  pg as (select * from ev union all select * from au order by at desc, id desc limit 51)
  select coalesce(jsonb_agg(jsonb_build_object('source', pg.source, 'id', pg.id, 'at', pg.at,
           'actor_id', pg.actor_id, 'actor_name', pr.full_name, 'entity', pg.entity, 'entity_id', pg.entity_id,
           'entity_label', pg.entity_label, 'action', pg.action,
           'body', private.sales_strip_private(pg.body, v_private), 'exists', pg.present)
         order by pg.at desc, pg.id desc), '[]'::jsonb)
    into v_rows
    from pg left join public.profiles pr on pr.id = pg.actor_id;

  if jsonb_array_length(v_rows) > 50 then
    v_next := jsonb_build_object('at', v_rows->49->'at', 'id', v_rows->49->'id');
    v_rows := v_rows - 50;
  end if;
  return jsonb_build_object('rows', v_rows, 'next', v_next);
end $$;

-- ---------------------------------------------------------------- bootstrap: caps.activity
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
      'items_edit', private.sales_can('project_items', 'edit'),
      'remove_records', private.sales_is_admin(),
      'customers', private.sales_can('sales_customers', 'edit'),
      'customers_import', private.sales_can('sales_customers_import', 'edit'),
      'activity', private.sales_can('sales_activity', 'read')),
    'me', auth.uid(),
    'flows', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'kind', f.kind,
                'name_fa', f.name_fa, 'name_en', f.name_en) order by f.kind), '[]'::jsonb)
                from public.sales_flows f where f.company_id = v_company),
    'stages', (select coalesce(jsonb_agg((to_jsonb(s) - 'company_id') order by s.flow_id, s.position), '[]'::jsonb)
                 from public.sales_stages s where s.company_id = v_company),
    'fields', (select coalesce(jsonb_agg((to_jsonb(d) - 'company_id') order by d.entity, d.position, d.label_en), '[]'::jsonb)
                 from public.sales_field_defs d where d.company_id = v_company),
    'customers', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'name_en', c.name_en, 'kind', c.kind,
                    'incomplete', cardinality(c.missing) > 0)
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
         from public.sales_import_batches b where b.company_id = v_company and b.kind <> 'customers')
      else '[]'::jsonb end);
end $$;

-- ---------------------------------------------------------------- grants
revoke all on function private.sales_audit_append_only() from public, anon, authenticated;
revoke all on function private.sales_log(uuid, text, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function private.sales_diff(jsonb, jsonb, text[]) from public, anon, authenticated;
revoke all on function private.sales_strip_walk(jsonb) from public, anon, authenticated;
revoke all on function private.sales_strip_private(jsonb, boolean) from public, anon, authenticated;
revoke all on function private.sales_list_op(boolean, jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.sales_product_snapshot(uuid) from public, anon, authenticated;
revoke all on function private.sales_stage_snapshot(uuid) from public, anon, authenticated;
revoke all on function public.app_sales_product_history(uuid) from public, anon;
grant execute on function public.app_sales_product_history(uuid) to authenticated;
revoke all on function public.app_sales_activity(jsonb) from public, anon;
grant execute on function public.app_sales_activity(jsonb) to authenticated;
