-- FR-78 (owner 2026-11-16): a first line naming the company on every free-text SMS, and the last
-- line ("Link at the end of each text") may now be empty.
--
-- Owner: "add the company name line to the free-text messages, and remove «لغو11» from the end if it's
-- not needed by melipayamak (if needed keep it)". Melipayamak's SendSms docs list error 15 («لغو11»
-- missing from the end of the text) and say line texts must include it, so the live setting keeps
-- «لغو11». The footer stays the admin's setting; it may now be empty so the owner can try without it.
--
-- private.sms_frame(company, body) puts header_label on its own first line and drops trailing line
-- breaks (an empty footer). It runs in sms_queue (approver, decision, password texts) and app_sms_test.
-- Pattern sends ignore the body (the template text lives at Melipayamak); the log shows it framed.
-- header_label defaults to '' (no line); the existing row gets the client's system name.
-- app_set_sms_settings gains a trailing p_header_label (null keeps it); null p_site_label now keeps
-- the saved footer instead of resetting it to bjeng.app. sms_ws_error is re-created only to name the
-- renamed field ("Last line of each text") in its code 14 / 15 hints.

alter table private.sms_settings
  add column header_label text not null default '',
  add constraint sms_settings_header_label check (char_length(btrim(header_label)) <= 60);

update private.sms_settings set header_label = 'سامانه پرسنلی بهسازان جنوب' where header_label = '';

alter table private.sms_settings drop constraint sms_settings_site_label;
alter table private.sms_settings
  add constraint sms_settings_site_label check (char_length(btrim(site_label)) <= 60);

comment on column private.sms_settings.header_label is
  'FR-78: first line of every free-text SMS (empty = none).';

create function private.sms_frame(p_company uuid, p_body text) returns text
    language sql stable
    set search_path to ''
    as $$
  select coalesce((select nullif(btrim(s.header_label), '') || chr(10)
                     from private.sms_settings s where s.company_id = p_company), '')
         || rtrim(p_body, chr(10) || ' ');
$$;
revoke all on function private.sms_frame(uuid, text) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION private.sms_queue(p_company uuid, p_event text, p_recipient uuid, p_request uuid, p_step uuid, p_body text, p_args text[], p_mobile text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_mobile text; v_id uuid; v_body text := private.sms_frame(p_company, p_body);
begin
  if p_event = 'approver_new' and exists (select 1 from public.sms_outbox o
      where o.event = 'approver_new' and o.request_id = p_request and o.recipient_id = p_recipient
        and o.created_at = now()) then
    return null;
  end if;
  v_mobile := private.normalize_ir_mobile(coalesce(p_mobile,
    (select i.mobile from public.employee_personal_info i where i.employee_id = p_recipient)));
  -- A skipped row is never dispatched, so it is masked now: no plaintext password stays behind.
  insert into public.sms_outbox (company_id, event, recipient_id, request_id, step_id, to_mobile,
                                 body, args, status, skip_reason, created_by)
  values (p_company, p_event, p_recipient, p_request, p_step, v_mobile,
          case when v_mobile is null then private.sms_mask(p_event, v_body, p_args) else v_body end,
          case when v_mobile is null and p_event = 'password_reset' then '{}' else coalesce(p_args, '{}') end,
          case when v_mobile is null then 'skipped' else 'queued' end,
          case when v_mobile is null then 'no_mobile' end, p_actor)
  on conflict do nothing
  returning id into v_id;
  return v_id;
end $$;

CREATE OR REPLACE FUNCTION public.app_sms_test(p_mobile text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_company uuid := private.require_admin();
  s private.sms_settings%rowtype;
  v_mobile text := private.normalize_ir_mobile(p_mobile);
  v_id uuid;
begin
  if v_mobile is null then raise exception 'invalid mobile' using errcode = '22023'; end if;
  select * into s from private.sms_settings where company_id = v_company;
  if s.mode is null or s.mode = 'off' then raise exception 'sms is off' using errcode = '22023'; end if;
  insert into public.sms_outbox (company_id, event, to_mobile, body, created_by)
  values (v_company, 'test', v_mobile,
          private.sms_frame(v_company, 'پیام آزمایشی سامانه' || chr(10) || s.site_label), auth.uid())
  returning id into v_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (auth.uid(), 'sms_test', 'sms_outbox', v_id, jsonb_build_object('mode', s.mode));
  return v_id;
end $$;

DROP FUNCTION public.app_set_sms_settings(text, text, text, text, integer, integer, integer, boolean,
  boolean, boolean, text, text, boolean, text);

CREATE FUNCTION public.app_set_sms_settings(p_mode text, p_username text, p_sender_line text,
    p_send_method text, p_body_approver_new integer, p_body_employee_decision integer,
    p_body_password_reset integer, p_notify_approver_new boolean, p_notify_employee_decision boolean,
    p_notify_password_reset boolean, p_site_label text, p_api_key text DEFAULT NULL::text,
    p_clear_api_key boolean DEFAULT false, p_connection text DEFAULT NULL::text,
    p_header_label text DEFAULT NULL::text) RETURNS void
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
        site_label = btrim(coalesce(p_site_label, site_label)),
        header_label = btrim(coalesce(p_header_label, header_label)),
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
  boolean, boolean, boolean, text, text, boolean, text, text) from public, anon;
grant execute on function public.app_set_sms_settings(text, text, text, text, integer, integer, integer,
  boolean, boolean, boolean, text, text, boolean, text, text) to authenticated;

CREATE OR REPLACE FUNCTION private.sms_ws_error(p_reply jsonb) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select case when plain is null then raw else plain || ' — ' || raw end
  from (
    select coalesce(nullif(p_reply->>'StrRetStatus', ''), 'error')
             || ' (RetStatus ' || coalesce(r, '?') || ', Value ' || coalesce(v, '?') || ')' as raw,
           case
             when v in ('-110', '110') then 'Melipayamak wants the API key, not the panel password'
             when v in ('-109', '109') then 'This server''s IP is not on the allowed list in the Melipayamak panel'
             when v in ('-108', '108') then 'Melipayamak blocked this server''s IP after failed attempts; contact their support'
             when r = '0' or v = '0' then 'Wrong username or API key'
             when v = '2' then 'Not enough credit in the Melipayamak panel'
             when v = '3' then 'Daily send limit reached; contact Melipayamak support'
             when v = '4' then 'Send volume limit reached; contact Melipayamak support'
             when v = '5' then 'The sender line is not valid for this account'
             when v = '6' then 'Melipayamak is updating; send again in a few minutes'
             when v = '7' then 'The text contains a filtered word; contact Melipayamak support'
             when v = '9' then 'Public Melipayamak lines cannot send through the web service; use your own line'
             when v = '10' then 'The Melipayamak panel is inactive'
             when v = '11' then 'Not sent; the number may block advertising texts, which a service line avoids'
             when v = '12' then 'The Melipayamak panel''s identity documents are incomplete'
             when v = '14' then 'The text contains a link; remove it from "Last line of each text" or ask Melipayamak support to allow links'
             when v = '15' then 'The text must end with «لغو11»; put it in "Last line of each text"'
             when v = '18' then 'The mobile number is not valid'
           end as plain
    from (select nullif(p_reply->>'Value', '') as v, p_reply->>'RetStatus' as r) x
  ) y;
$$;
