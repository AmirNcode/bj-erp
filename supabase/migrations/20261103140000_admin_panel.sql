-- Admin panel (owner, 2026-11-03; FR-77). Spec: docs/specs/2026-11-03-admin-panel-sms-design.md.
--
-- Read-only views for the single admin: usage stats, system health and the audit log. Every
-- function refuses anyone but the admin (42501), whatever the UI shows. Plus a small backup ledger
-- that deploy/liara/backup.sh writes after each successful dump, so the System tab can show it.
-- Adds only; the app version still running during the deploy keeps working.

create table private.backup_runs (
    id bigint generated always as identity primary key,
    file_name text not null,
    size_bytes bigint not null,
    sha256 text,
    finished_at timestamptz not null default now()
);

comment on table private.backup_runs is
  'FR-77: one row per successful database dump, written by deploy/liara/backup.sh via private.record_backup.';

-- Called by the host backup script as the image superuser; never by the app.
create function private.record_backup(p_file text, p_bytes bigint, p_sha256 text) returns void
    language sql security definer
    set search_path to ''
    as $$
  insert into private.backup_runs (file_name, size_bytes, sha256) values (p_file, p_bytes, p_sha256);
  delete from private.backup_runs where finished_at < now() - interval '90 days';
$$;
revoke all on function private.record_backup(text, bigint, text) from public, anon, authenticated;

create function private.require_admin() returns uuid
    language plpgsql stable security definer
    set search_path to ''
    as $$
begin
  if not private.is_admin(auth.uid()) then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return private.caller_company();
end $$;
revoke all on function private.require_admin() from public, anon;

-- Liveness for /api/health: proves PostgREST reaches the database. Says nothing else.
create function public.app_health() returns boolean
    language sql stable
    set search_path to ''
    as $$ select true; $$;
revoke all on function public.app_health() from public;
grant execute on function public.app_health() to anon, authenticated;

-- Overview tab. p_from / p_to are Tehran dates; requests count by their submit day.
create function public.app_admin_overview(p_from date, p_to date) returns jsonb
    language plpgsql stable security definer
    set search_path to ''
    as $$
declare
  v_company uuid := private.require_admin();
  v_now timestamptz := now();
  v_order boolean;
  v_result jsonb;
begin
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'invalid range' using errcode = '22023';
  end if;
  select coalesce(w.approval_order_enforced, false) into v_order
    from public.work_settings w where w.company_id = v_company;

  with people as (
    select p.id, p.active, p.must_change_password, u.last_sign_in_at
      from public.profiles p
      left join auth.users u on u.id = p.id
     where p.company_id = v_company and not private.is_admin(p.id)
  ),
  reqs as (
    select r.*
      from public.leave_requests r
     where r.company_id = v_company
       and (r.created_at at time zone 'Asia/Tehran')::date between p_from and p_to
  ),
  decided as (
    select extract(epoch from (r.decided_at - r.created_at)) / 3600.0 as hours
      from reqs r
     where r.status in ('approved', 'rejected') and r.decided_at is not null
  ),
  stuck as (
    select r.id, r.serial_year, r.serial_seq, r.kind, r.unit, r.created_at, e.full_name,
           floor(extract(epoch from (v_now - r.created_at)) / 86400)::int as days_waiting,
           (select jsonb_build_object('step_role', s.role, 'manager_scope', s.manager_scope,
                     'step_order', s.step_order)
              from public.approval_steps s
             where s.company_id = r.company_id
               and private.request_step_applies(r.id, s.id)
               and not private.request_step_decided(r.id, s.id)
             order by s.step_order, s.id limit 1) as waiting_on
      from public.leave_requests r
      join public.profiles e on e.id = r.employee_id
     where r.company_id = v_company and r.status = 'pending'
       and r.created_at < v_now - interval '3 days'
  ),
  by_department as (
    select d.id, d.name_fa, d.name_en, count(*) as requests,
           sum(r.requested_minutes)::bigint as minutes
      from reqs r
      join public.profiles e on e.id = r.employee_id
      left join public.departments d on d.id = e.department_id
     where r.status = 'approved' and r.kind = 'leave'
     group by d.id, d.name_fa, d.name_en
  )
  select jsonb_build_object(
    'people', (select jsonb_build_object(
        'active', count(*) filter (where active),
        'inactive', count(*) filter (where not active),
        'never_signed_in', count(*) filter (where active and last_sign_in_at is null),
        'must_change_password', count(*) filter (where active and must_change_password),
        'signed_in_7d', count(*) filter (where active and last_sign_in_at >= v_now - interval '7 days'),
        'signed_in_30d', count(*) filter (where active and last_sign_in_at >= v_now - interval '30 days'))
      from people),
    'requests', (select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'unit', unit,
        'status', status, 'count', n) order by kind, unit, status), '[]')
      from (select kind, unit, status, count(*) as n from reqs group by kind, unit, status) g),
    'speed', (select jsonb_build_object('decided', count(*),
        'median_hours', round((percentile_cont(0.5) within group (order by hours))::numeric, 1),
        'p90_hours', round((percentile_cont(0.9) within group (order by hours))::numeric, 1))
      from decided),
    'stuck', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'serial_year', serial_year,
        'serial_seq', serial_seq, 'kind', kind, 'unit', unit, 'employee_name', full_name,
        'created_at', created_at, 'days_waiting', days_waiting, 'waiting_on', waiting_on)
        order by created_at), '[]') from stuck),
    'leave_by_department', (select coalesce(jsonb_agg(jsonb_build_object('department_id', id,
        'name_fa', name_fa, 'name_en', name_en, 'requests', requests, 'minutes', minutes)
        order by minutes desc), '[]') from by_department),
    'minutes_per_day', private.company_minutes_per_day(v_company),
    'approval_order_enforced', v_order
  ) into v_result;
  return v_result;
end $$;
revoke all on function public.app_admin_overview(date, date) from public, anon;
grant execute on function public.app_admin_overview(date, date) to authenticated;

-- System tab: database size, biggest tables, migrations, scheduled jobs, backups. Optional parts
-- (the deploy ledger, pg_cron) are read with dynamic SQL so a database without them still works.
create function public.app_admin_system() returns jsonb
    language plpgsql stable security definer
    set search_path to ''
    as $$
declare
  v_company uuid := private.require_admin();
  v_migrations jsonb := '[]';
  v_migration_count bigint := 0;
  v_jobs jsonb := '[]';
  v_result jsonb;
begin
  if to_regclass('bj_deploy.schema_migrations') is not null then
    execute $q$select coalesce(jsonb_agg(to_jsonb(m) order by m.filename desc), '[]')
                 from (select * from bj_deploy.schema_migrations order by filename desc limit 10) m$q$
      into v_migrations;
    execute 'select count(*) from bj_deploy.schema_migrations' into v_migration_count;
  end if;
  if to_regclass('cron.job') is not null then
    execute $q$select coalesce(jsonb_agg(jsonb_build_object('jobname', j.jobname,
                   'schedule', j.schedule, 'active', j.active,
                   'last_status', d.status, 'last_start', d.start_time, 'last_end', d.end_time,
                   'last_message', left(d.return_message, 300),
                   'failures_24h', (select count(*) from cron.job_run_details f where f.jobid = j.jobid
                     and f.status = 'failed' and f.start_time > now() - interval '24 hours'))
                   order by j.jobname), '[]')
                 from cron.job j
                 left join lateral (select * from cron.job_run_details x where x.jobid = j.jobid
                   order by x.start_time desc limit 1) d on true$q$
      into v_jobs;
  end if;

  select jsonb_build_object(
    'database_bytes', pg_database_size(current_database()),
    'postgres_version', current_setting('server_version'),
    'tables', (select coalesce(jsonb_agg(t order by (t->>'bytes')::bigint desc), '[]') from (
        select jsonb_build_object('name', n.nspname || '.' || c.relname,
                 'rows', greatest(c.reltuples, 0)::bigint,
                 'bytes', pg_total_relation_size(c.oid)) as t
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where c.relkind = 'r' and n.nspname in ('public', 'private', 'auth')
         order by pg_total_relation_size(c.oid) desc limit 10) x),
    'migrations', v_migrations,
    'migration_count', v_migration_count,
    'jobs', v_jobs,
    'backups', (select coalesce(jsonb_agg(jsonb_build_object('file_name', file_name,
        'size_bytes', size_bytes, 'finished_at', finished_at) order by finished_at desc), '[]')
      from (select * from private.backup_runs order by finished_at desc limit 5) b)
  ) into v_result;
  return v_result;
end $$;
revoke all on function public.app_admin_system() from public, anon;
grant execute on function public.app_admin_system() to authenticated;

-- Audit log tab. Signature images and password-like keys never leave the database.
create function private.audit_redact(p jsonb) returns jsonb
    language sql immutable
    set search_path to ''
    as $$
  select case when p is null or jsonb_typeof(p) <> 'object' then p else
    (select coalesce(jsonb_object_agg(k, case
        when k ~* '(^|_)(signature_data|password|secret|api_key|token)$' and v <> 'null'::jsonb
          then to_jsonb('[hidden]'::text)
        when jsonb_typeof(v) = 'string' and length(v #>> '{}') > 500
          then to_jsonb(left(v #>> '{}', 120) || '…'::text)
        else v end), '{}'::jsonb)
       from jsonb_each(p) as e(k, v)) end;
$$;

create function public.app_audit_log(p_from date default null, p_to date default null,
    p_actor uuid default null, p_entity text default null, p_action text default null,
    p_limit integer default 50, p_offset integer default 0) returns jsonb
    language plpgsql stable security definer
    set search_path to ''
    as $$
declare
  v_company uuid := private.require_admin();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_result jsonb;
begin
  with scoped as (
    select a.*
      from public.audit_log a
      left join public.profiles ap on ap.id = a.actor_id
     where (ap.company_id = v_company or a.actor_id is null)
       and (p_from is null or (a.created_at at time zone 'Asia/Tehran')::date >= p_from)
       and (p_to is null or (a.created_at at time zone 'Asia/Tehran')::date <= p_to)
       and (p_actor is null or a.actor_id = p_actor)
       and (p_entity is null or a.entity = p_entity)
       and (p_action is null or a.action = p_action)
  )
  select jsonb_build_object(
    'total', (select count(*) from scoped),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'created_at', s.created_at,
        'actor_id', s.actor_id, 'actor_name', p.full_name, 'action', s.action, 'entity', s.entity,
        'entity_id', s.entity_id, 'entity_label', case
          when s.entity = 'profiles' then (select full_name from public.profiles where id = s.entity_id)
          when s.entity = 'leave_requests' then (select r.serial_year || '-' || lpad(r.serial_seq::text, 4, '0')
            from public.leave_requests r where r.id = s.entity_id) end,
        'before', private.audit_redact(s.before), 'after', private.audit_redact(s.after))
        order by s.created_at desc, s.id), '[]')
      from (select * from scoped order by created_at desc, id limit v_limit offset greatest(coalesce(p_offset, 0), 0)) s
      left join public.profiles p on p.id = s.actor_id),
    'entities', (select coalesce(jsonb_agg(distinct a.entity), '[]') from public.audit_log a),
    'actions', (select coalesce(jsonb_agg(distinct a.action), '[]') from public.audit_log a)
  ) into v_result;
  return v_result;
end $$;
revoke all on function public.app_audit_log(date, date, uuid, text, text, integer, integer) from public, anon;
grant execute on function public.app_audit_log(date, date, uuid, text, text, integer, integer) to authenticated;
