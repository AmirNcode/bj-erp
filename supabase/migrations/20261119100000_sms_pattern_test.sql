-- FR-78 (owner 2026-11-19): "make the test text use the selected method instead of testing it with a
-- real request". With How to send = Pattern, Send test now goes through one approved template the admin
-- picks, with sample values, so pattern sending can be checked without a real leave request or reset.
--
-- sms_outbox.test_template names that template's event (only on test rows; null = a free-text test from
-- the line, as before). app_sms_test(p_mobile, p_template): in pattern mode p_template picks the template
-- (null = approver_new, so the old app's one-argument call still works); in line mode it must be null.
-- The row's args are sample values in the template's order; its body is the Farsi text the real event
-- would log, framed like the others. sms_dispatch reads coalesce(test_template, event) for the body id.

alter table public.sms_outbox add column test_template text,
  add constraint sms_outbox_test_template check (test_template is null
    or (event = 'test' and test_template in ('approver_new', 'employee_decision', 'password_reset')));

comment on column public.sms_outbox.test_template is
  'FR-78: on a test row sent by pattern, the event whose template it uses; null otherwise.';

DROP FUNCTION public.app_sms_test(text);

CREATE FUNCTION public.app_sms_test(p_mobile text, p_template text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_company uuid := private.require_admin();
  s private.sms_settings%rowtype;
  v_mobile text := private.normalize_ir_mobile(p_mobile);
  v_template text;
  v_kind text := private.sms_kind_label('leave', 'day', 'fa');
  v_date text := private.jalali_text(current_date, 'fa');
  v_name text;
  v_body text;
  v_args text[] := '{}';
  v_id uuid;
begin
  if v_mobile is null then raise exception 'invalid mobile' using errcode = '22023'; end if;
  select * into s from private.sms_settings where company_id = v_company;
  if s.mode is null or s.mode = 'off' then raise exception 'sms is off' using errcode = '22023'; end if;
  if p_template is not null and p_template not in ('approver_new', 'employee_decision', 'password_reset') then
    raise exception 'sms: invalid input' using errcode = '22023';
  end if;
  if s.send_method = 'pattern' then
    v_template := coalesce(p_template, 'approver_new');
    if (case v_template when 'approver_new' then s.body_approver_new
                        when 'employee_decision' then s.body_employee_decision
                        else s.body_password_reset end) is null then
      raise exception 'no pattern body id for %', v_template using errcode = '22023';
    end if;
    select p.full_name into v_name from public.profiles p where p.id = auth.uid();
    v_name := coalesce(nullif(btrim(v_name), ''), 'آزمایش');
    if v_template = 'approver_new' then
      v_args := array[v_name, v_kind, v_date];
      v_body := format('درخواست %s %s (%s) منتظر تأیید شماست.', v_kind, v_name, v_date);
    elsif v_template = 'employee_decision' then
      v_args := array[v_kind, v_date, 'تأیید شد'];
      v_body := format('درخواست %s شما (%s) %s.', v_kind, v_date, 'تأیید شد');
    else
      -- Sample values only: no real password is ever sent by a test.
      v_args := array['Test1234', '0000'];
      v_body := format('رمز موقت شما: %s%sکد ورود: %s', 'Test1234', chr(10), '0000');
    end if;
    v_body := 'پیام آزمایشی سامانه (الگو)' || chr(10) || v_body;
  elsif p_template is not null then
    raise exception 'sms: invalid input' using errcode = '22023';
  else
    v_body := 'پیام آزمایشی سامانه' || chr(10) || s.site_label;
  end if;
  insert into public.sms_outbox (company_id, event, to_mobile, body, args, test_template, created_by)
  values (v_company, 'test', v_mobile, private.sms_frame(v_company, v_body), v_args, v_template, auth.uid())
  returning id into v_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (auth.uid(), 'sms_test', 'sms_outbox', v_id,
          jsonb_build_object('mode', s.mode, 'send_method', s.send_method, 'template', v_template));
  return v_id;
end $$;

REVOKE ALL ON FUNCTION public.app_sms_test(text, text) FROM PUBLIC, anon;
GRANT ALL ON FUNCTION public.app_sms_test(text, text) TO authenticated, service_role;

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
    perform private.sms_fail(o.id, 'could not read the reply: '
      || private.sms_scrub(v_err, (select k.api_key from private.sms_settings k where k.company_id = o.company_id), 300), false);
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
    perform private.sms_fail(o.id, 'could not send: ' || private.sms_scrub(v_err, s.api_key, 300), false);
    update public.sms_outbox set body = private.sms_mask(event, body, args), args = '{}'
     where id = o.id and event = 'password_reset';
   end;
  end loop;
end $_$;
