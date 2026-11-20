-- Sales CEO feedback, task 5: per-record files, grouped by stage (spec 2026-11-20 section 6).
-- Metadata only; the bytes live on disk (Task 6). Function-only table.

create table public.sales_files (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  rfp_id      uuid not null references public.sales_rfps(id) on delete cascade,
  stage_id    uuid not null references public.sales_stages(id) on delete restrict,
  name        text not null check (char_length(name) between 1 and 255),
  size_bytes  bigint not null check (size_bytes between 1 and 52428800),
  mime        text check (mime is null or char_length(mime) <= 200),
  sha256      text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  status      text not null default 'pending' check (status in ('pending', 'ready')),
  uploaded_by uuid references public.profiles(id) on delete set null,
  uploaded_at timestamptz not null default now()
);
create index sales_files_rfp_stage on public.sales_files (rfp_id, stage_id);
comment on table public.sales_files is
  'FR-94: record files (metadata; bytes on disk under FILES_DIR/<company>/<rfp>/<id>). Functions only.';
alter table public.sales_files enable row level security;
revoke all on public.sales_files from public, anon, authenticated;

alter table public.sales_events drop constraint sales_events_kind_check;
alter table public.sales_events add constraint sales_events_kind_check
  check (kind = any (array['created','edit','stage','decision','result','comment','import','items','finance','file']));

-- FR-95: a test account holds no Sales access, whatever other role it also has.
create or replace function private.sales_can(p_key text, p_level text default 'edit') returns boolean
  language sql stable security definer set search_path = '' as $$
  select coalesce(not private.is_test_account(auth.uid())
     and private.has_perm(auth.uid(), 'sales', 'read')
     and private.has_perm(auth.uid(), p_key, p_level), false);
$$;

create function public.app_sales_file_begin(p_rfp uuid, p_stage uuid, p_name text, p_size bigint, p_mime text) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare v_company uuid := private.sales_company('sales', 'edit');
  v_name text := btrim(coalesce(p_name, '')); v_id uuid := gen_random_uuid();
begin
  perform private.sales_rfp(p_rfp, v_company);
  perform private.sales_writable(p_rfp);
  if p_size is null or p_size not between 1 and 52428800
     or char_length(v_name) not between 1 and 255 or v_name ~ '[[:cntrl:]]'
     or char_length(coalesce(p_mime, '')) > 200
     or not exists (select 1 from public.sales_stages where id = p_stage and company_id = v_company) then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  insert into public.sales_files (id, company_id, rfp_id, stage_id, name, size_bytes, mime, uploaded_by)
    values (v_id, v_company, p_rfp, p_stage, v_name, p_size, nullif(btrim(coalesce(p_mime, '')), ''), auth.uid());
  return jsonb_build_object('id', v_id, 'company_id', v_company);
end $$;

create function public.app_sales_file_commit(p_id uuid, p_size bigint, p_sha256 text) returns void
  language plpgsql security definer set search_path = '' as $$
declare v_company uuid := private.sales_company('sales', 'edit'); f public.sales_files;
begin
  select * into f from public.sales_files where id = p_id and company_id = v_company;
  if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
  perform private.sales_rfp(f.rfp_id, v_company);
  select * into f from public.sales_files where id = p_id for update;
  if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
  if f.uploaded_by is distinct from auth.uid() then
    raise exception 'sales: not allowed' using errcode = '42501';
  end if;
  if f.status <> 'pending' or p_size is distinct from f.size_bytes
     or (p_sha256 is not null and p_sha256 !~ '^[0-9a-f]{64}$') then
    raise exception 'sales: invalid input' using errcode = '22023';
  end if;
  update public.sales_files set status = 'ready', sha256 = p_sha256 where id = p_id;
  perform private.sales_touch(f.rfp_id, 'file', jsonb_build_object('action', 'add', 'name', f.name,
    'stage', (select s.code from public.sales_stages s where s.id = f.stage_id)));
end $$;

create function public.app_sales_file_abort(p_id uuid) returns void
  language plpgsql security definer set search_path = '' as $$
declare v_company uuid := private.sales_company('sales', 'edit'); f public.sales_files;
begin
  select * into f from public.sales_files where id = p_id and company_id = v_company;
  if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
  perform private.sales_rfp(f.rfp_id, v_company);
  select * into f from public.sales_files where id = p_id for update;
  if not found then return; end if;
  if f.uploaded_by is distinct from auth.uid() then
    raise exception 'sales: not allowed' using errcode = '42501';
  end if;
  if f.status <> 'pending' then raise exception 'sales: invalid input' using errcode = '22023'; end if;
  delete from public.sales_files where id = p_id;
end $$;

create function public.app_sales_file_get(p_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
declare v_company uuid := private.sales_company(); f public.sales_files;
begin
  select * into f from public.sales_files where id = p_id and company_id = v_company and status = 'ready';
  if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('id', f.id, 'company_id', f.company_id, 'rfp_id', f.rfp_id,
                            'name', f.name, 'size_bytes', f.size_bytes);
end $$;

create function public.app_sales_file_delete(p_id uuid) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare v_company uuid := private.sales_company('sales', 'edit'); f public.sales_files;
begin
  select * into f from public.sales_files where id = p_id and company_id = v_company;
  if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
  perform private.sales_rfp(f.rfp_id, v_company);
  select * into f from public.sales_files where id = p_id for update;
  if not found then raise exception 'sales: not found' using errcode = 'P0002'; end if;
  if f.uploaded_by is distinct from auth.uid() and not private.sales_can('sales_settings') then
    raise exception 'sales: not allowed' using errcode = '42501';
  end if;
  perform private.sales_writable(f.rfp_id);
  delete from public.sales_files where id = p_id;
  if f.status = 'ready' then
    perform private.sales_touch(f.rfp_id, 'file', jsonb_build_object('action', 'delete', 'name', f.name,
      'stage', (select s.code from public.sales_stages s where s.id = f.stage_id)));
  end if;
  return jsonb_build_object('company_id', f.company_id, 'rfp_id', f.rfp_id);
end $$;

create function private.sales_files_gc() returns setof jsonb
  language sql security definer set search_path = '' as $$
  with gone as (
    delete from public.sales_files where status = 'pending' and uploaded_at < now() - interval '1 day'
    returning id, company_id, rfp_id)
  select jsonb_build_object('id', id, 'company_id', company_id, 'rfp_id', rfp_id) from gone;
$$;

create function private.sales_file_ids() returns setof uuid
  language sql stable security definer set search_path = '' as $$
  select id from public.sales_files;
$$;

revoke all on function private.sales_files_gc() from public, anon, authenticated;
revoke all on function private.sales_file_ids() from public, anon, authenticated;
revoke all on function public.app_sales_file_begin(uuid, uuid, text, bigint, text) from public, anon;
grant execute on function public.app_sales_file_begin(uuid, uuid, text, bigint, text) to authenticated;
revoke all on function public.app_sales_file_commit(uuid, bigint, text) from public, anon;
grant execute on function public.app_sales_file_commit(uuid, bigint, text) to authenticated;
revoke all on function public.app_sales_file_abort(uuid) from public, anon;
grant execute on function public.app_sales_file_abort(uuid) to authenticated;
revoke all on function public.app_sales_file_get(uuid) from public, anon;
grant execute on function public.app_sales_file_get(uuid) to authenticated;
revoke all on function public.app_sales_file_delete(uuid) from public, anon;
grant execute on function public.app_sales_file_delete(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.app_sales_record(p_id uuid) RETURNS jsonb
  language plpgsql stable security definer set search_path = '' as $$
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
end $$;