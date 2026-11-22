-- Read password messages only through the masked history functions.
alter policy sms_outbox_select_admin on public.sms_outbox using (
  event <> 'password_reset' and private.is_admin((select auth.uid()))
  and company_id = (select private.caller_company())
);
revoke insert, update, delete, truncate, references, trigger on public.sms_outbox from public, anon, authenticated;


CREATE OR REPLACE FUNCTION public.app_start_password_recovery(p_code text) RETURNS TABLE(request_id uuid, hint text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
<<lookup>>
declare
  code text := lower(btrim(left(p_code, 65)));
  ip text := coalesce(nullif(current_setting('request.headers', true),'')::jsonb->>'x-bj-client-ip','unknown');
  salt bytea;
  source_key bytea;
  code_key bytea;
  target uuid;
  mobile text;
begin
  select s.salt into strict salt from private.recovery_secret s;
  source_key := extensions.hmac(convert_to(ip,'UTF8'), salt, 'sha256');
  code_key := extensions.hmac(convert_to(coalesce(code,''),'UTF8'), salt, 'sha256');
  request_id := gen_random_uuid();
  hint := '09•••••••' || lpad((get_byte(code_key,0) % 100)::text, 2, '0');
  perform pg_advisory_xact_lock(hashtextextended(encode(source_key,'hex'), 0));
  perform pg_advisory_xact_lock(hashtextextended(encode(code_key,'hex'), 1));
  if (select count(*) from private.recovery_requests r where r.source_key = lookup.source_key
        and r.created_at > now()-interval '10 minutes') >= 30
     or (select count(*) from private.recovery_requests r where r.code_key = lookup.code_key
        and r.created_at > now()-interval '10 minutes') >= 10 then
    return next; return;
  end if;
  select p.id, private.normalize_ir_mobile(i.mobile) into target, mobile
    from public.profiles p join public.employee_personal_info i on i.employee_id=p.id
    where lower(p.employee_code)=code and p.active and not private.is_admin(p.id)
    for share of i;
  if mobile is not null then hint := left(mobile,2) || '•••••••' || right(mobile,2); end if;
  insert into private.recovery_requests(id,source_key,code_key,employee_id,mobile)
    values(request_id,source_key,code_key,target,mobile);
  delete from private.recovery_requests where id in (
    select r.id from private.recovery_requests r where r.created_at < now() - interval '2 hours'
    order by r.created_at limit 100 for update skip locked);
  return next;
end $$;

CREATE OR REPLACE FUNCTION public.app_confirm_password_recovery(p_request uuid, p_mobile text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  r private.recovery_requests%rowtype;
  p public.profiles%rowtype;
  s private.sms_settings%rowtype;
  mobile text;
  password text;
  hashed text;
  outbox uuid;
begin
  -- Lock mobile first, matching the phone-update trigger's lock order.
  select private.normalize_ir_mobile(i.mobile) into mobile from public.employee_personal_info i
    join private.recovery_requests q on q.employee_id=i.employee_id
    where q.id=p_request and q.created_at >= now()-interval '10 minutes' for update of i;
  select * into r from private.recovery_requests where id=p_request for update;
  if not found or r.created_at < clock_timestamp()-interval '10 minutes' or r.attempts >= 5 or r.issued_at is not null then return; end if;
  update private.recovery_requests set attempts=attempts+1 where id=r.id;
  if r.mobile is null or r.mobile is distinct from private.normalize_ir_mobile(left(p_mobile,64)) then return; end if;

  if mobile is distinct from r.mobile then return; end if;
  select * into p from public.profiles where id=r.employee_id for update;
  if not found or not p.active or private.is_admin(p.id) or
    r.code_key <> (select extensions.hmac(convert_to(lower(p.employee_code),'UTF8'), salt,'sha256') from private.recovery_secret) then return; end if;
  if exists(select 1 from private.recovery_requests where employee_id=p.id and issued_at>now()-interval '1 minute')
    or (select count(*) from private.recovery_requests where employee_id=p.id and issued_at>now()-interval '1 hour') >= 3 then return; end if;
  select * into s from private.sms_settings where company_id=p.company_id for share;
  if not found or s.mode <> 'live' or not s.notify_password_reset or
     (s.connection='webservice' and (s.username is null or s.auth_error is not null)) or
     (s.send_method='pattern' and s.body_password_reset is null) or
     (s.send_method='line' and s.sender_line is null) then return; end if;

  -- Generate inside the trusted transaction. The public endpoint never accepts or returns a password.
  password := encode(extensions.gen_random_bytes(9),'hex') || '!2';
  hashed := extensions.crypt(password,extensions.gen_salt('bf'));
  outbox := private.sms_queue(p.company_id,'password_reset',p.id,null,null,
    case when p.language_pref='en' then 'Your temporary password: ' else 'رمز موقت شما: ' end || password || chr(10) ||
    case when p.language_pref='en' then 'Login code: ' else 'کد ورود: ' end || p.employee_code || chr(10) || s.site_label,
    array[password,p.employee_code],mobile,null);
  if outbox is null then raise exception 'recovery unavailable'; end if;
  update auth.users set encrypted_password=hashed, updated_at=now() where id=p.id;
  if not found then raise exception 'recovery unavailable'; end if;
  perform set_config('bj.password_flag_write','on',true);
  update public.profiles set must_change_password=true where id=p.id;
  perform set_config('bj.password_flag_write','',true);
  perform private.revoke_sessions(p.id,'password_recovery');
  insert into private.recovery_credentials values(p.id,extensions.digest(hashed,'sha256'),outbox)
    on conflict(employee_id) do update set password_fingerprint=excluded.password_fingerprint,outbox_id=excluded.outbox_id;
  update private.recovery_requests set issued_at=clock_timestamp() where id=r.id;
  insert into public.audit_log(action,entity,entity_id) values('password_recovery','auth.users',p.id);
exception when others then
  -- PostgREST includes DETAIL, which can contain the entire rejected outbox row.
  raise exception 'recovery unavailable';
end $$;

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
  v_err text;
begin
  -- 1. Replies to earlier sends.
  for o in select * from public.sms_outbox where status = 'sending' order by sending_since
           for update skip locked loop
   begin
    select * into resp from net._http_response where id = o.net_request_id;
    if not found then
      if o.sending_since < now() - interval '10 minutes' then
        -- F4: the request may still go out (or have gone out); resending could text twice.
        insert into private.sms_outbox_events (outbox_id, kind, attempt, error)
        values (o.id, 'reply', o.attempts, 'no reply from provider');
        perform private.sms_fail(o.id, 'no reply from Melipayamak within 10 minutes; not resent (it may have been delivered)', false);
      end if;
      continue;
    end if;
    select * into s from private.sms_settings where company_id = o.company_id;
    -- Providers can echo the submitted text in any free-form field. Retain only
    -- the numeric response codes needed for classification of password texts.
    if o.event = 'password_reset' then
      begin v_json := resp.content::jsonb; exception when others then v_json := null; end;
      if v_json ? 'RetStatus' then
        resp.content := jsonb_build_object(
          'RetStatus', case when v_json->>'RetStatus' ~ '^[0-9]{1,4}$' then v_json->>'RetStatus' end,
          'Value', case when v_json->>'Value' ~ '^-?[0-9]{1,24}$' then v_json->>'Value' end
        )::text;
      else
        resp.content := jsonb_build_object('recId',
          case when v_json->>'recId' ~ '^[0-9]{6,24}$' then v_json->>'recId' end)::text;
      end if;
      if resp.error_msg is not null then resp.error_msg := 'password SMS transport error'; end if;
    end if;
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
    elsif resp.status_code is null and not coalesce(resp.timed_out, false)
          and resp.error_msg ~* '(could ?n.?t|could not) (connect|resolve)|connection refused|ssl connect error' then
      -- Never reached Melipayamak: safe to try again (1 and 5 minutes, 3 attempts in all).
      perform private.sms_fail(o.id, 'could not reach Melipayamak: ' || resp.error_msg, true);
    elsif resp.timed_out or resp.status_code is null or resp.status_code >= 500 then
      -- F4: a timeout or server error may come after Melipayamak accepted the text. Not resent.
      perform private.sms_fail(o.id, coalesce(case when resp.timed_out then 'timeout' end,
        'HTTP ' || resp.status_code, resp.error_msg, 'no answer')
        || '; not resent (it may have been delivered)', false);
    else
      perform private.sms_fail(o.id, coalesce(nullif(v_status, ''), nullif(v_ref, ''),
        'HTTP ' || resp.status_code || ' ' || left(coalesce(resp.content, ''), 200)), false);
      if v_ws and private.sms_ws_auth_refused(v_json) then
        update private.sms_settings set auth_error = left(v_status, 300), auth_error_at = now()
         where company_id = o.company_id;
      end if;
    end if;
   exception when others then
    -- F5: one unreadable reply must not stop every other text. It may have been sent: no retry.
    get stacked diagnostics v_err = message_text;
    perform private.sms_fail(o.id, case when o.event = 'password_reset' then 'could not read password SMS reply'
      else 'could not read the reply: ' || private.sms_scrub(v_err, (select k.api_key from private.sms_settings k where k.company_id = o.company_id), 300) end, false);
   end;
  end loop;

  -- 2. Credit checks the admin asked for.
  for s in select * from private.sms_settings where credit_request_id is not null for update skip locked loop
   begin
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
   exception when others then
    -- F5: e.g. a non-numeric amount. Clear the request so the next runs go on.
    get stacked diagnostics v_err = message_text;
    update private.sms_settings
       set credit_error = left('could not read the balance reply: ' || private.sms_scrub(v_err, s.api_key), 300),
           credit_checked_at = now(), credit_request_id = null
     where company_id = s.company_id;
   end;
  end loop;

  -- 3. Due texts.
  for o in select * from public.sms_outbox where status = 'queued' and next_attempt_at <= now()
           order by created_at limit 20 for update skip locked loop
   begin
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
    if s.send_method = 'pattern' and (o.event <> 'test' or o.test_template is not null) then
      v_body := jsonb_build_object(
        'bodyId', case coalesce(o.test_template, o.event) when 'approver_new' then s.body_approver_new
                               when 'employee_decision' then s.body_employee_decision
                               when 'password_reset' then s.body_password_reset end);
      if v_body->'bodyId' = 'null'::jsonb then
        perform private.sms_fail(o.id, 'no pattern body id for ' || coalesce(o.test_template, o.event), false);
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
   exception when others then
    -- F5: this row failed before anything was sent (the block's pg_net request is rolled back too).
    get stacked diagnostics v_err = message_text;
    perform private.sms_fail(o.id, case when o.event = 'password_reset' then 'could not send password SMS'
      else 'could not send: ' || private.sms_scrub(v_err, s.api_key, 300) end, false);
    update public.sms_outbox set body = private.sms_mask(event, body, args), args = '{}'
     where id = o.id and event = 'password_reset';
   end;
  end loop;
end $_$;
