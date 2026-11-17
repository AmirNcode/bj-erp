-- =============================================================================
-- Migration: 20261116210000_sales_access_fixes.sql
-- Purpose  : ERP › Sales (FR-94) — two access gaps found by the commit security review.
--   1. Item rows are for `project_items` readers: app_sales_record returned them to
--      every `sales` reader, and app_sales_find_node resolved item numbers for them.
--   2. A closed record (stage kind other than open) is read-only except for
--      `sales_decide` holders. app_sales_save_record enforced it; notes, documents and
--      deadlines did not. Items (project_items) and guarantees / payments
--      (sales_bonds) stay writable on closed records on purpose: engineering fills in
--      the items of finished (imported) contracts, and finance records late payments.
-- Functions are redefined whole from 20261116200100 with only those changes.
-- =============================================================================

create or replace function private.sales_writable(p_rfp uuid) returns void
    language plpgsql stable security definer set search_path to '' as $$
begin
  if (select s.kind from public.sales_rfps r join public.sales_stages s on s.id = r.stage_id
       where r.id = p_rfp) <> 'open' and not private.sales_can('sales_decide') then
    raise exception 'sales: not allowed' using errcode = '42501';
  end if;
end $$;
revoke all on function private.sales_writable(uuid) from public, anon, authenticated;

create or replace function public.app_sales_record(p_id uuid) returns jsonb
    language plpgsql stable security definer set search_path to '' as $$
declare v_company uuid := private.sales_company();
  r public.sales_rfps := private.sales_rfp(p_id, v_company, false);
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
                 from public.sales_events e where e.rfp_id = p_id))
    || case when v_bonds then jsonb_build_object('payments',
         (select coalesce(jsonb_agg(to_jsonb(pm) - array['company_id','rfp_id'] order by pm.seq), '[]'::jsonb)
            from public.sales_payments pm where pm.rfp_id = p_id)) else '{}'::jsonb end
    || case when v_prices then jsonb_build_object('quote_revisions',
         (select coalesce(jsonb_agg(distinct q.revision), '[]'::jsonb)
            from public.sales_quote_lines q where q.rfp_id = p_id)) else '{}'::jsonb end;
end $$;

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
    from public.project_nodes n
   where n.company_id = v_company and n.code = v_code and private.sales_can('project_items', 'read');
  if v_out is null and v_code ~ '^\d+$' then
    select jsonb_build_object('rfp_id', r.id, 'node_id', null) into v_out
      from public.sales_rfps r where r.company_id = v_company and r.record_no = v_code::bigint;
  end if;
  return v_out;
end $$;

create or replace function public.app_sales_comment(p_id uuid, p_text text) returns void
    language plpgsql security definer set search_path to '' as $$
declare v_company uuid := private.sales_company('sales', 'edit');
  r public.sales_rfps := private.sales_rfp(p_id, v_company);
begin
  perform private.sales_writable(r.id);
  if char_length(btrim(coalesce(p_text, ''))) not between 1 and 2000 then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  perform private.sales_touch(r.id, 'comment', jsonb_build_object('text', btrim(p_text)));
end $$;

create or replace function public.app_sales_save_deadline(p_rfp uuid, p_id uuid, p jsonb) returns uuid
    language plpgsql security definer set search_path to '' as $$
declare v_company uuid := private.sales_company('sales', 'edit');
  r public.sales_rfps := private.sales_rfp(p_rfp, v_company);
  v_due date := private.sales_date(p->>'due_on');
  v_label text := nullif(left(btrim(coalesce(p->>'label', '')), 200), '');
  v_who uuid := private.sales_uuid(p->>'responsible_id'); v_id uuid := p_id;
begin
  perform private.sales_writable(r.id);
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
  perform private.sales_writable(v_rfp);
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
  perform private.sales_writable(v_rfp);
  delete from public.sales_deadlines where id = p_id;
  perform private.sales_touch(v_rfp, 'edit', jsonb_build_object('fields', jsonb_build_array('deadline')));
end $$;

create or replace function public.app_sales_delete_document(p_id uuid) returns void
    language plpgsql security definer set search_path to '' as $$
declare v_company uuid := private.sales_company('sales', 'edit'); v_rfp uuid;
begin
  select rfp_id into v_rfp from public.sales_documents where id = p_id and company_id = v_company;
  if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
  perform private.sales_rfp(v_rfp, v_company);
  perform private.sales_writable(v_rfp);
  delete from public.sales_documents where id = p_id;
  perform private.sales_touch(v_rfp, 'edit', jsonb_build_object('fields', jsonb_build_array('documents')));
end $$;

create or replace function public.app_sales_save_document(p_rfp uuid, p_id uuid, p jsonb) returns uuid
    language plpgsql security definer set search_path to '' as $$
declare v_company uuid := private.sales_company('sales', 'edit');
  r public.sales_rfps := private.sales_rfp(p_rfp, v_company);
  d public.sales_documents; v_id uuid := p_id; v_who uuid;
begin
  perform private.sales_writable(r.id);
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
