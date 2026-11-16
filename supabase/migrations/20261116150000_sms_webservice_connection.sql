-- FR-78 addendum (owner 2026-11-16, "Yes, add it"): Melipayamak through its web service with the
-- panel username + API key, the method the client's IT and the official melipayamak-node client use.
--
-- Until now every send went to console.melipayamak.com/api/…/<key>. That URL wants the *console*
-- token, a separate key you get by registering at the console; the panel's API key (Developers ›
-- Web service settings) is refused there with «کلید کنسول معتبر نیست». The new default connection,
-- 'webservice', posts JSON to https://rest.payamak-panel.com/api/SendSMS/<Method> with
-- {username, password: <API key>, …}; the reply is {Value, RetStatus, StrRetStatus}.
-- Checked 2026-11-16: the endpoint binds JSON bodies (it answers 415 for XML and text/plain, and
-- RetStatus 0 "UserNameAndPasswordFailed" for a JSON body with a wrong user).
--
-- Melipayamak blocks a server IP after repeated failed sign-ins (-108). So a web-service reply that
-- says the username/key/IP is wrong stores it in sms_settings.auth_error and the dispatcher stops
-- posting new texts (they stay queued) until the admin saves the settings again or a balance check
-- succeeds.
--
-- app_set_sms_settings gains p_connection (null keeps the saved one). Dropped and re-created so no
-- second overload exists; the old app's 13 named arguments still resolve, so a release that still
-- runs the previous app keeps working.

alter table private.sms_settings
  add column connection text not null default 'webservice',
  add column auth_error text,
  add column auth_error_at timestamptz,
  add constraint sms_settings_connection check (connection in ('webservice', 'console'));

comment on column private.sms_settings.connection is
  'FR-78: webservice = rest.payamak-panel.com with username + panel API key; console = console.melipayamak.com/<console key>.';
comment on column private.sms_settings.auth_error is
  'FR-78: last sign-in refusal from the web service; while set, the dispatcher posts no new texts.';

-- Readable text for a web-service reply that did not send. Admin panel is English-only.
create function private.sms_ws_error(p_reply jsonb) returns text
    language sql immutable
    set search_path to ''
    as $$
  select case
    when p_reply->>'Value' in ('-110', '110') then 'Melipayamak wants the API key, not the panel password (-110)'
    when p_reply->>'Value' in ('-109', '109') then 'This server''s IP is not on the allowed list in the Melipayamak panel (-109)'
    when p_reply->>'Value' in ('-108', '108') then 'Melipayamak blocked this server''s IP after failed attempts (-108); contact their support'
    when p_reply->>'RetStatus' = '0' then 'Wrong username or API key (' || coalesce(nullif(p_reply->>'StrRetStatus', ''), '0') || ')'
    when p_reply->>'RetStatus' = '1' then 'Melipayamak code ' || coalesce(nullif(p_reply->>'Value', ''), '?')
    else coalesce(nullif(p_reply->>'StrRetStatus', ''), 'error')
         || ' (RetStatus ' || coalesce(p_reply->>'RetStatus', '?') || ', Value ' || coalesce(nullif(p_reply->>'Value', ''), '?') || ')'
  end;
$$;
revoke all on function private.sms_ws_error(jsonb) from public, anon, authenticated;

-- True when the reply means: stop signing in until someone fixes the settings.
create function private.sms_ws_auth_refused(p_reply jsonb) returns boolean
    language sql immutable
    set search_path to ''
    as $$
  select coalesce(p_reply->>'RetStatus' = '0' or p_reply->>'Value' in ('-108', '-109', '-110', '108', '109', '110'), false);
$$;
revoke all on function private.sms_ws_auth_refused(jsonb) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION private.sms_dispatch() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  o record;
  s private.sms_settings%rowtype;
  resp record;
  v_json jsonb;
  v_ref text;
  v_status text;
  v_body jsonb;
  v_url text;
  v_endpoint text;
  v_req bigint;
  v_ws boolean;
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
    v_ws := coalesce(v_json ? 'RetStatus', false);
    if v_ws then
      v_ref := v_json->>'Value';
      v_status := case when v_json->>'RetStatus' = '1' and v_ref ~ '^[0-9]{6,}$' then null
                       else private.sms_ws_error(v_json) end;
    else
      v_ref := v_json->>'recId';
      v_status := v_json->>'status';
    end if;
    if resp.status_code between 200 and 299 and v_ref ~ '^[0-9]{6,}$'
       and (not v_ws or v_json->>'RetStatus' = '1') then
      update public.sms_outbox set status = 'sent', provider_ref = v_ref, sent_at = now(),
             error = nullif(v_status, ''), net_request_id = null, sending_since = null
       where id = o.id;
    elsif resp.timed_out or resp.status_code is null or resp.status_code >= 500 then
      perform private.sms_fail(o.id, coalesce(resp.error_msg, 'HTTP ' || resp.status_code, 'timeout'), true);
    else
      perform private.sms_fail(o.id, coalesce(nullif(v_status, ''), nullif(v_ref, ''),
        'HTTP ' || resp.status_code || ' ' || left(coalesce(resp.content, ''), 200)), false);
      if v_ws and private.sms_ws_auth_refused(v_json) then
        update private.sms_settings set auth_error = left(v_status, 300), auth_error_at = now()
         where company_id = o.company_id;
      end if;
    end if;
  end loop;

  -- 2. Credit checks the admin asked for.
  for s in select * from private.sms_settings where credit_request_id is not null for update skip locked loop
    select * into resp from net._http_response where id = s.credit_request_id;
    continue when not found;
    begin v_json := resp.content::jsonb; exception when others then v_json := null; end;
    if v_json ? 'RetStatus' then
      -- Web service: {Value: "<credit>", RetStatus: 1}.
      v_ws := coalesce(resp.status_code between 200 and 299 and v_json->>'RetStatus' = '1'
              and v_json->>'Value' ~ '^[0-9]+(\.[0-9]+)?$', false);
      update private.sms_settings
         set credit_amount = case when v_ws then (v_json->>'Value')::numeric else credit_amount end,
             credit_error = case when v_ws then null else left(private.sms_ws_error(v_json), 300) end,
             auth_error = case when v_ws then null
                               when private.sms_ws_auth_refused(v_json) then left(private.sms_ws_error(v_json), 300)
                               else auth_error end,
             auth_error_at = case when v_ws then null
                                  when private.sms_ws_auth_refused(v_json) then now()
                                  else auth_error_at end,
             credit_checked_at = now(), credit_request_id = null
       where company_id = s.company_id;
    else
      update private.sms_settings
         set credit_amount = case when resp.status_code between 200 and 299 and v_json ? 'amount'
                                  then (v_json->>'amount')::numeric else credit_amount end,
             credit_error = case when resp.status_code between 200 and 299 and v_json ? 'amount' then null
                                 else left(coalesce(nullif(v_json->>'status', ''), resp.error_msg,
                                           'HTTP ' || resp.status_code), 300) end,
             credit_checked_at = now(), credit_request_id = null
       where company_id = s.company_id;
    end if;
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
    v_ws := s.connection = 'webservice';
    -- Melipayamak refused the sign-in: wait for new settings instead of risking an IP block.
    continue when v_ws and s.auth_error is not null;
    if v_ws and s.username is null then
      perform private.sms_fail(o.id, 'no username for the web service', false);
      update public.sms_outbox set body = private.sms_mask(event, body, args), args = '{}'
       where id = o.id and event = 'password_reset';
      continue;
    end if;
    if s.send_method = 'pattern' and o.event <> 'test' then
      v_body := jsonb_build_object(
        'bodyId', case o.event when 'approver_new' then s.body_approver_new
                               when 'employee_decision' then s.body_employee_decision
                               when 'password_reset' then s.body_password_reset end);
      if v_body->'bodyId' = 'null'::jsonb then
        perform private.sms_fail(o.id, 'no pattern body id for ' || o.event, false);
        update public.sms_outbox set body = private.sms_mask(event, body, args), args = '{}'
         where id = o.id and event = 'password_reset';
        continue;
      end if;
      if v_ws then
        -- Pattern variables go as one text, separated by ';'.
        v_body := v_body || jsonb_build_object('username', s.username, 'password', s.api_key,
                    'to', o.to_mobile, 'text', array_to_string(o.args, ';'));
        v_endpoint := 'SendSMS/BaseServiceNumber';
        v_url := 'https://rest.payamak-panel.com/api/SendSMS/BaseServiceNumber';
      else
        v_body := v_body || jsonb_build_object('to', o.to_mobile, 'args', to_jsonb(o.args));
        v_endpoint := 'send/shared';
        v_url := 'https://console.melipayamak.com/api/send/shared/' || s.api_key;
      end if;
    else
      if s.sender_line is null then
        perform private.sms_fail(o.id, 'no sender line', false);
        update public.sms_outbox set body = private.sms_mask(event, body, args), args = '{}'
         where id = o.id and event = 'password_reset';
        continue;
      end if;
      if v_ws then
        v_body := jsonb_build_object('username', s.username, 'password', s.api_key,
                    'from', s.sender_line, 'to', o.to_mobile, 'text', o.body, 'isFlash', false);
        v_endpoint := 'SendSMS/SendSMS';
        v_url := 'https://rest.payamak-panel.com/api/SendSMS/SendSMS';
      else
        v_body := jsonb_build_object('from', s.sender_line, 'to', o.to_mobile, 'text', o.body);
        v_endpoint := 'send/simple';
        v_url := 'https://console.melipayamak.com/api/send/simple/' || s.api_key;
      end if;
    end if;
    v_req := net.http_post(url := v_url, body := v_body,
                           headers := '{"Content-Type": "application/json"}'::jsonb,
                           timeout_milliseconds := 15000);
    insert into private.sms_outbox_events (outbox_id, kind, attempt, endpoint, body_id)
    values (o.id, 'request', o.attempts + 1, v_endpoint, (v_body->>'bodyId')::integer);
    update public.sms_outbox
       set status = 'sending', net_request_id = v_req, sending_since = now(), attempts = attempts + 1,
           body = private.sms_mask(event, body, args),
           args = case when event = 'password_reset' then '{}' else args end
     where id = o.id;
  end loop;
end $_$;

CREATE OR REPLACE FUNCTION public.app_sms_check_credit() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_company uuid := private.require_admin(); s private.sms_settings%rowtype;
begin
  select * into s from private.sms_settings where company_id = v_company for update;
  if s.api_key is null then raise exception 'no api key' using errcode = '22023'; end if;
  if s.connection = 'webservice' and s.username is null then
    raise exception 'username required' using errcode = '22023';
  end if;
  update private.sms_settings
     set credit_request_id = case
           when s.connection = 'webservice' then
             net.http_post(url := 'https://rest.payamak-panel.com/api/SendSMS/GetCredit',
                           body := jsonb_build_object('username', s.username, 'password', s.api_key),
                           headers := '{"Content-Type": "application/json"}'::jsonb,
                           timeout_milliseconds := 15000)
           else net.http_get(url := 'https://console.melipayamak.com/api/receive/credit/' || s.api_key,
                             timeout_milliseconds := 15000) end,
         credit_error = null
   where company_id = v_company;
end $$;

DROP FUNCTION public.app_set_sms_settings(text, text, text, text, integer, integer, integer, boolean,
  boolean, boolean, text, text, boolean);

CREATE FUNCTION public.app_set_sms_settings(p_mode text, p_username text, p_sender_line text,
    p_send_method text, p_body_approver_new integer, p_body_employee_decision integer,
    p_body_password_reset integer, p_notify_approver_new boolean, p_notify_employee_decision boolean,
    p_notify_password_reset boolean, p_site_label text, p_api_key text DEFAULT NULL::text,
    p_clear_api_key boolean DEFAULT false, p_connection text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_company uuid := private.require_admin();
  v_before private.sms_settings%rowtype;
  v_after private.sms_settings%rowtype;
  v_constraint text;
  v_column text;
begin
  insert into private.sms_settings (company_id) values (v_company) on conflict do nothing;
  select * into v_before from private.sms_settings where company_id = v_company for update;
  begin
    update private.sms_settings set
        mode = p_mode,
        connection = coalesce(p_connection, connection),
        username = nullif(btrim(coalesce(p_username, '')), ''),
        sender_line = nullif(regexp_replace(translate(coalesce(p_sender_line, ''),
          '۰۱۲۳۴۵۶۷۸۹', '0123456789'), '\s', '', 'g'), ''),
        send_method = p_send_method,
        body_approver_new = p_body_approver_new,
        body_employee_decision = p_body_employee_decision,
        body_password_reset = p_body_password_reset,
        notify_approver_new = coalesce(p_notify_approver_new, true),
        notify_employee_decision = coalesce(p_notify_employee_decision, true),
        notify_password_reset = coalesce(p_notify_password_reset, true),
        site_label = btrim(coalesce(p_site_label, 'bjeng.app')),
        api_key = case when p_clear_api_key then null
                       when nullif(btrim(coalesce(p_api_key, '')), '') is not null then btrim(p_api_key)
                       else api_key end,
        -- Any save is the admin's "try again": the dispatcher resumes after a sign-in refusal.
        auth_error = null, auth_error_at = null,
        updated_by = auth.uid(), updated_at = now()
     where company_id = v_company
    returning * into v_after;
  exception
    -- Re-raised without DETAIL: the original one lists every column value, api_key included.
    when check_violation then
      get stacked diagnostics v_constraint = constraint_name;
      raise exception 'new row for relation "sms_settings" violates check constraint "%"', v_constraint
        using errcode = '23514';
    when not_null_violation then
      get stacked diagnostics v_column = column_name;
      raise exception 'null value in column "%" of relation "sms_settings" violates not-null constraint', v_column
        using errcode = '23502';
  end;
  if v_after.mode = 'live' and v_after.connection = 'webservice' and v_after.username is null then
    raise exception 'username required' using errcode = '22023';
  end if;
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'update_sms_settings', 'sms_settings', v_company,
          to_jsonb(v_before) - 'api_key' - 'credit_request_id',
          (to_jsonb(v_after) - 'api_key' - 'credit_request_id')
            || jsonb_build_object('api_key_changed', v_before.api_key is distinct from v_after.api_key));
end $$;

revoke all on function public.app_set_sms_settings(text, text, text, text, integer, integer, integer,
  boolean, boolean, boolean, text, text, boolean, text) from public, anon;
grant execute on function public.app_set_sms_settings(text, text, text, text, integer, integer, integer,
  boolean, boolean, boolean, text, text, boolean, text) to authenticated;
