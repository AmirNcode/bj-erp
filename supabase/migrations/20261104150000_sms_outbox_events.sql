-- SMS log history (owner, 2026-11-04; FR-78). Each text in Admin › SMS › Log gets an expandable
-- list of what happened to it: every status change, the request to Melipayamak and its reply.
--
--   private.sms_outbox_events  one row per step. Written by a trigger on public.sms_outbox (status
--                              or attempt changes) and by private.sms_dispatch (request / reply).
--                              Deleted with its text (the 180-day outbox purge cleans it too).
--   public.app_sms_log         same signature; each row gains 'events'.
--
-- Never stored: the request URL (it carries the API key) or the request body (password texts).
-- Provider replies are scrubbed of the API key as a guard. Rows already in the outbox get a
-- two-step summary marked backfilled. Adds only; the app version still running keeps working.

create table private.sms_outbox_events (
    id bigserial primary key,
    outbox_id uuid not null references public.sms_outbox(id) on delete cascade,
    at timestamptz not null default clock_timestamp(),
    kind text not null,
    status text,
    attempt integer,
    error text,
    skip_reason text,
    retry_at timestamptz,
    provider_ref text,
    endpoint text,
    body_id integer,
    http_status integer,
    timed_out boolean,
    response text,
    backfilled boolean not null default false,
    constraint sms_outbox_events_kind check (kind in ('status', 'request', 'reply'))
);

comment on table private.sms_outbox_events is
  'FR-78: step-by-step history of each SMS (status changes, provider request and reply). Never holds the API key, the URL or a request body.';

create index sms_outbox_events_outbox_idx on private.sms_outbox_events (outbox_id, id);

revoke all on table private.sms_outbox_events from public, anon, authenticated;
revoke all on sequence private.sms_outbox_events_id_seq from public, anon, authenticated;

-- Text with the API key (if any) replaced, cut to p_len.
create function private.sms_scrub(p_text text, p_key text, p_len integer default 500) returns text
    language sql immutable
    set search_path to ''
    as $$
  select left(case when p_key is null or p_key = '' or p_text is null then p_text
                   else replace(p_text, p_key, '***') end, p_len);
$$;

revoke all on function private.sms_scrub(text, text, integer) from public, anon, authenticated;

-- ── status steps (trigger) ──────────────────────────────────────────────────

create function private.sms_outbox_log_status() returns trigger
    language plpgsql security definer
    set search_path to ''
    as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status
     and new.attempts is not distinct from old.attempts then
    return null;
  end if;
  begin
    insert into private.sms_outbox_events (outbox_id, kind, status, attempt, error, skip_reason,
                                           retry_at, provider_ref)
    values (new.id, 'status', new.status, new.attempts,
            case when new.status in ('failed', 'queued', 'sent') then new.error end,
            new.skip_reason,
            case when new.status = 'queued' and new.attempts > 0 then new.next_attempt_at end,
            case when new.status = 'sent' then new.provider_ref end);
  exception when others then
    null; -- history must never undo a text, a request or an approval
  end;
  return null;
end $$;

revoke all on function private.sms_outbox_log_status() from public, anon, authenticated;

create trigger sms_outbox_log_status after insert or update of status, attempts on public.sms_outbox
  for each row execute function private.sms_outbox_log_status();

-- ── dispatch: same as 20261103140001, plus request / reply events ───────────

create or replace function private.sms_dispatch() returns void
    language plpgsql security definer
    set search_path to ''
    as $_$
declare
  o record;
  s private.sms_settings%rowtype;
  resp record;
  v_json jsonb;
  v_ref text;
  v_status text;
  v_body jsonb;
  v_url text;
  v_req bigint;
begin
  -- 1. Replies to earlier sends.
  for o in select * from public.sms_outbox where status = 'sending' order by sending_since
           for update skip locked loop
    select * into resp from net._http_response where id = o.net_request_id;
    if not found then
      if o.sending_since < now() - interval '10 minutes' then
        insert into private.sms_outbox_events (outbox_id, kind, attempt, error)
        values (o.id, 'reply', o.attempts, 'no reply from provider');
        perform private.sms_fail(o.id, 'no reply from provider', true);
      end if;
      continue;
    end if;
    select * into s from private.sms_settings where company_id = o.company_id;
    insert into private.sms_outbox_events (outbox_id, kind, attempt, http_status, timed_out, error, response)
    values (o.id, 'reply', o.attempts, resp.status_code, resp.timed_out,
            private.sms_scrub(resp.error_msg, s.api_key), private.sms_scrub(resp.content, s.api_key));
    begin v_json := resp.content::jsonb; exception when others then v_json := null; end;
    v_ref := v_json->>'recId';
    v_status := v_json->>'status';
    if resp.status_code between 200 and 299 and v_ref ~ '^[0-9]{6,}$' then
      update public.sms_outbox set status = 'sent', provider_ref = v_ref, sent_at = now(),
             error = nullif(v_status, ''), net_request_id = null, sending_since = null
       where id = o.id;
    elsif resp.timed_out or resp.status_code is null or resp.status_code >= 500 then
      perform private.sms_fail(o.id, coalesce(resp.error_msg, 'HTTP ' || resp.status_code, 'timeout'), true);
    else
      perform private.sms_fail(o.id, coalesce(nullif(v_status, ''), nullif(v_ref, ''),
        'HTTP ' || resp.status_code || ' ' || left(coalesce(resp.content, ''), 200)), false);
    end if;
  end loop;

  -- 2. Credit checks the admin asked for.
  for s in select * from private.sms_settings where credit_request_id is not null for update skip locked loop
    select * into resp from net._http_response where id = s.credit_request_id;
    continue when not found;
    begin v_json := resp.content::jsonb; exception when others then v_json := null; end;
    update private.sms_settings
       set credit_amount = case when resp.status_code between 200 and 299 and v_json ? 'amount'
                                then (v_json->>'amount')::numeric else credit_amount end,
           credit_error = case when resp.status_code between 200 and 299 and v_json ? 'amount' then null
                               else left(coalesce(nullif(v_json->>'status', ''), resp.error_msg,
                                         'HTTP ' || resp.status_code), 300) end,
           credit_checked_at = now(), credit_request_id = null
     where company_id = s.company_id;
  end loop;

  -- 3. Due texts.
  for o in select * from public.sms_outbox where status = 'queued' and next_attempt_at <= now()
           order by created_at limit 20 for update skip locked loop
    select * into s from private.sms_settings where company_id = o.company_id;
    if o.event = 'approver_new' and not exists (select 1 from public.leave_requests r
        where r.id = o.request_id and r.status = 'pending') then
      update public.sms_outbox set status = 'skipped', skip_reason = 'request_decided' where id = o.id;
      continue;
    end if;
    if s.mode is null or s.mode = 'off' then
      update public.sms_outbox set status = 'skipped', skip_reason = 'sms_off',
             body = private.sms_mask(event, body, args),
             args = case when event = 'password_reset' then '{}' else args end
       where id = o.id;
      continue;
    end if;
    if s.mode = 'dry_run' then
      update public.sms_outbox set status = 'dry_run', sent_at = now(),
             body = private.sms_mask(event, body, args),
             args = case when event = 'password_reset' then '{}' else args end
       where id = o.id;
      continue;
    end if;
    -- live
    if s.send_method = 'pattern' and o.event <> 'test' then
      v_body := jsonb_build_object('to', o.to_mobile, 'args', to_jsonb(o.args),
        'bodyId', case o.event when 'approver_new' then s.body_approver_new
                               when 'employee_decision' then s.body_employee_decision
                               when 'password_reset' then s.body_password_reset end);
      v_url := 'https://console.melipayamak.com/api/send/shared/' || s.api_key;
      if v_body->'bodyId' = 'null'::jsonb then
        perform private.sms_fail(o.id, 'no pattern body id for ' || o.event, false);
        update public.sms_outbox set body = private.sms_mask(event, body, args), args = '{}'
         where id = o.id and event = 'password_reset';
        continue;
      end if;
    else
      if s.sender_line is null then
        perform private.sms_fail(o.id, 'no sender line', false);
        update public.sms_outbox set body = private.sms_mask(event, body, args), args = '{}'
         where id = o.id and event = 'password_reset';
        continue;
      end if;
      v_body := jsonb_build_object('from', s.sender_line, 'to', o.to_mobile, 'text', o.body);
      v_url := 'https://console.melipayamak.com/api/send/simple/' || s.api_key;
    end if;
    v_req := net.http_post(url := v_url, body := v_body,
                           headers := '{"Content-Type": "application/json"}'::jsonb,
                           timeout_milliseconds := 15000);
    insert into private.sms_outbox_events (outbox_id, kind, attempt, endpoint, body_id)
    values (o.id, 'request', o.attempts + 1,
            case when v_body ? 'bodyId' then 'send/shared' else 'send/simple' end,
            (v_body->>'bodyId')::integer);
    update public.sms_outbox
       set status = 'sending', net_request_id = v_req, sending_since = now(), attempts = attempts + 1,
           body = private.sms_mask(event, body, args),
           args = case when event = 'password_reset' then '{}' else args end
     where id = o.id;
  end loop;
end $_$;

revoke all on function private.sms_dispatch() from public, anon, authenticated;

-- ── admin log: rows carry their events ──────────────────────────────────────

create or replace function public.app_sms_log(p_status text default null, p_event text default null,
                                              p_limit integer default 50, p_offset integer default 0)
    returns jsonb
    language plpgsql stable security definer
    set search_path to ''
    as $$
declare v_company uuid := private.require_admin(); v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  return (with scoped as (
    select o.* from public.sms_outbox o
     where o.company_id = v_company
       and (p_status is null or o.status = p_status)
       and (p_event is null or o.event = p_event))
  select jsonb_build_object(
    'total', (select count(*) from scoped),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'event', x.event,
        'recipient_id', x.recipient_id, 'recipient_name', p.full_name, 'request_id', x.request_id,
        'to_mobile', x.to_mobile,
        'body', case when x.status = 'queued' then private.sms_mask(x.event, x.body, x.args) else x.body end,
        'status', x.status, 'skip_reason', x.skip_reason, 'attempts', x.attempts, 'error', x.error,
        'provider_ref', x.provider_ref, 'created_at', x.created_at, 'sent_at', x.sent_at,
        'events', (select coalesce(jsonb_agg(jsonb_build_object('at', e.at, 'kind', e.kind,
              'status', e.status, 'attempt', e.attempt, 'error', e.error, 'skip_reason', e.skip_reason,
              'retry_at', e.retry_at, 'provider_ref', e.provider_ref, 'endpoint', e.endpoint,
              'body_id', e.body_id, 'http_status', e.http_status, 'timed_out', e.timed_out,
              'response', e.response, 'backfilled', e.backfilled) order by e.id), '[]')
            from private.sms_outbox_events e where e.outbox_id = x.id))
        order by x.created_at desc, x.id), '[]')
      from (select * from scoped order by created_at desc, id limit v_limit offset greatest(coalesce(p_offset, 0), 0)) x
      left join public.profiles p on p.id = x.recipient_id),
    'counts', (select coalesce(jsonb_object_agg(status, n), '{}') from
      (select status, count(*) as n from public.sms_outbox where company_id = v_company
        and created_at > now() - interval '30 days' group by status) c)));
end $$;

revoke all on function public.app_sms_log(text, text, integer, integer) from public, anon;
grant execute on function public.app_sms_log(text, text, integer, integer) to authenticated;

-- ── backfill: texts from before this migration get a two-step summary ───────

insert into private.sms_outbox_events (outbox_id, at, kind, status, attempt, backfilled)
select o.id, o.created_at, 'status', 'queued', 0, true from public.sms_outbox o;

insert into private.sms_outbox_events (outbox_id, at, kind, status, attempt, error, skip_reason,
                                       provider_ref, backfilled)
select o.id, coalesce(o.sent_at, o.created_at), 'status', o.status, o.attempts, o.error, o.skip_reason,
       o.provider_ref, true
  from public.sms_outbox o
 where o.status <> 'queued';
