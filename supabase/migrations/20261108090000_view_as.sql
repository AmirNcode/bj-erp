-- FR-86: the admin reads the app as another employee, strictly read-only.
-- A view is a short-lived row in private.view_as_sessions. The app sends its id in the
-- `x-view-as` header; the PostgREST pre-request hook below checks it, swaps `sub` in
-- request.jwt.claims for the target and makes the transaction read-only, so every RLS
-- policy and RPC treats the request as the target and nothing can be written.
-- The hook is switched on by deploy/lib/sync-view-as-hook.sql (role setting), not here:
-- role settings live outside the migration ledger and pg_dump backups.

create table private.view_as_sessions (
  id         uuid primary key default gen_random_uuid(),
  admin_id   uuid not null,
  target_id  uuid not null,
  expires_at timestamptz not null,
  ended_at   timestamptz
);

comment on table private.view_as_sessions is 'FR-86: one row per View as session. Read only by the security definer view-as functions.';

alter table private.view_as_sessions enable row level security;
revoke all on table private.view_as_sessions from public, anon, authenticated, service_role;

-- PostgREST runs this before every request, as the request's role (anon too), so those
-- roles need USAGE on schema private. Every private function anon could already execute
-- is a trigger or a pure helper, and PostgREST exposes only schema public.
grant usage on schema private to anon, service_role;

create function private.view_as_pre_request() returns void
    language plpgsql volatile security definer
    set search_path to ''
    as $$
declare
  v_header text := nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-view-as';
  v_caller uuid;
  v_claims jsonb;
  v_target uuid;
begin
  -- No header: the normal path for every request. Return before any table read.
  if v_header is null then return; end if;

  -- No logged-in caller (anon, service_role): nothing to swap, and a leftover cookie must
  -- not break the login page.
  v_caller := auth.uid();
  if v_caller is null then return; end if;

  -- Checked before the cast, so garbage gets the same 403 as an unknown id.
  if v_header !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'view-as refused' using errcode = 'PT403';
  end if;

  select s.target_id into v_target
    from private.view_as_sessions s
   where s.id = v_header::uuid
     and s.admin_id = v_caller
     and s.ended_at is null
     and s.expires_at > now()
     and private.is_active(s.target_id)
     and private.is_admin(v_caller);
  if v_target is null then
    raise exception 'view-as refused' using errcode = 'PT403';
  end if;

  -- SQL never reads app_roles / app_perms, but drop them so no claim describes the admin.
  v_claims := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
  perform set_config('request.jwt.claims',
    ((v_claims - 'app_roles' - 'app_perms') || jsonb_build_object('sub', v_target))::text, true);
  -- auth.uid() reads the legacy per-claim setting first; never let it keep the admin's sub.
  perform set_config('request.jwt.claim.sub', v_target::text, true);
  -- Postgres refuses switching a read-only transaction back to read-write.
  perform set_config('transaction_read_only', 'on', true);
end $$;

revoke all on function private.view_as_pre_request() from public;
grant execute on function private.view_as_pre_request() to anon, authenticated, service_role;

create function public.app_view_as_start(p_target uuid) returns table(session_id uuid, expires_at timestamptz)
    language plpgsql volatile security definer
    set search_path to ''
    as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_expires timestamptz;
begin
  -- Through the hook the identity is the target, never an admin: views cannot nest.
  if v_uid is null or not private.is_admin(v_uid) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_target is null or p_target = v_uid then
    raise exception 'cannot view as yourself' using errcode = '22023';
  end if;
  if not exists (select 1
                   from public.profiles t
                   join public.profiles a on a.id = v_uid and a.company_id = t.company_id
                  where t.id = p_target and t.active) then
    raise exception 'this person cannot be viewed' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('view_as:' || v_uid::text, 0));
  delete from private.view_as_sessions s
   where s.admin_id = v_uid and (s.ended_at is not null or s.expires_at <= now());
  -- At most one live session per admin: a second browser's view ends here, audited like Exit.
  with ended as (
    update private.view_as_sessions s set ended_at = now()
     where s.admin_id = v_uid and s.ended_at is null
    returning s.id, s.target_id
  )
  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  select v_uid, 'view_as.end', 'profiles', e.target_id, jsonb_build_object('session_id', e.id)
    from ended e;
  insert into private.view_as_sessions as s (admin_id, target_id, expires_at)
  values (v_uid, p_target, now() + interval '30 minutes')
  returning s.id, s.expires_at into v_id, v_expires;

  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (v_uid, 'view_as.start', 'profiles', p_target,
          jsonb_build_object('session_id', v_id, 'expires_at', v_expires));
  return query select v_id, v_expires;
end $$;

create function public.app_view_as_end() returns void
    language plpgsql volatile security definer
    set search_path to ''
    as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  with ended as (
    update private.view_as_sessions s set ended_at = now()
     where s.admin_id = v_uid and s.ended_at is null and s.expires_at > now()
    returning s.id, s.target_id
  )
  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  select v_uid, 'view_as.end', 'profiles', e.target_id, jsonb_build_object('session_id', e.id)
    from ended e;
end $$;

create function public.app_view_as_session(p_id uuid)
    returns table(target_id uuid, target_name text, personnel_no text, expires_at timestamptz)
    language sql stable security definer
    set search_path to ''
    as $$
  select s.target_id, p.full_name, p.personnel_no, s.expires_at
    from private.view_as_sessions s
    join public.profiles p on p.id = s.target_id and p.active
   where s.id = p_id
     and s.admin_id = auth.uid()
     and s.ended_at is null
     and s.expires_at > now()
     and private.is_admin(auth.uid());
$$;

-- Called with the header, proves the hook really swapped the identity and locked writes.
-- Volatile on purpose: PostgREST runs a stable function in a read-only transaction, so a
-- stable probe would report read_only 'on' even with the hook off. It writes nothing.
create function public.app_view_as_probe() returns table(uid uuid, read_only text)
    language sql volatile security definer
    set search_path to ''
    as $$
  select auth.uid(), current_setting('transaction_read_only');
$$;

revoke all on function public.app_view_as_start(uuid) from public, anon, service_role;
revoke all on function public.app_view_as_end() from public, anon, service_role;
revoke all on function public.app_view_as_session(uuid) from public, anon, service_role;
revoke all on function public.app_view_as_probe() from public, service_role;
grant execute on function public.app_view_as_start(uuid) to authenticated;
grant execute on function public.app_view_as_end() to authenticated;
grant execute on function public.app_view_as_session(uuid) to authenticated;
grant execute on function public.app_view_as_probe() to authenticated, anon;
