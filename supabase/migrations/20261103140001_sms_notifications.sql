-- SMS notifications (owner, 2026-11-03; FR-78). Spec: docs/specs/2026-11-03-admin-panel-sms-design.md.
--
-- The database does all of it, so the app container needs no new secret or environment variable:
--
--   private.sms_settings  one row per company: mode (off / dry_run / live), Melipayamak console
--                         API key (write-only), sender line or pattern body ids, per-event switches
--   public.sms_outbox     every text: queued → sending → sent | failed, or dry_run / skipped.
--                         The admin reads it; nobody writes it directly.
--
--   Queueing: deferred constraint triggers on leave_requests / leave_request_approvals run at
--   commit, when the request's final state for that transaction is known (an approval at
--   submission under delegated authority, for example), and call private.sms_enqueue_request.
--   They never raise: a texting problem must not undo a request or an approval.
--
--   Sending: pg_cron job 'bj-sms-dispatch' (every 30 s) calls private.sms_dispatch, which posts
--   to https://console.melipayamak.com/api/send/{simple|shared}/<key> with pg_net and, on the
--   next run, reads the reply from net._http_response. Jobs are not in schema.sql (it dumps only
--   public and private). pg_net only executes requests in the 'postgres' database.
--
-- Password texts: the plaintext is in the row only until the first dispatch, which masks it.
-- Adds only; the app version still running during the deploy keeps working.

create extension if not exists pg_net;

create table private.sms_settings (
    company_id uuid primary key references public.companies(id) on delete cascade,
    mode text not null default 'dry_run',
    provider text not null default 'melipayamak',
    api_key text,
    username text,
    sender_line text,
    send_method text not null default 'line',
    body_approver_new integer,
    body_employee_decision integer,
    body_password_reset integer,
    notify_approver_new boolean not null default true,
    notify_employee_decision boolean not null default true,
    notify_password_reset boolean not null default true,
    site_label text not null default 'bjeng.app',
    credit_amount numeric,
    credit_checked_at timestamptz,
    credit_error text,
    credit_request_id bigint,
    updated_by uuid references public.profiles(id) on delete set null,
    updated_at timestamptz not null default now(),
    constraint sms_settings_mode check (mode in ('off', 'dry_run', 'live')),
    constraint sms_settings_provider check (provider = 'melipayamak'),
    constraint sms_settings_send_method check (send_method in ('line', 'pattern')),
    constraint sms_settings_sender_line check (sender_line is null or sender_line ~ '^[0-9]{4,20}$'),
    constraint sms_settings_api_key check (api_key is null or api_key ~ '^[A-Za-z0-9._~-]{8,200}$'),
    constraint sms_settings_site_label check (char_length(btrim(site_label)) between 1 and 60),
    constraint sms_settings_live_needs_key check (mode <> 'live' or api_key is not null)
);

comment on table private.sms_settings is
  'FR-78: SMS provider settings per company. api_key never leaves the database except to the provider.';

insert into private.sms_settings (company_id) select id from public.companies on conflict do nothing;

create table public.sms_outbox (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references public.companies(id) on delete cascade,
    event text not null,
    recipient_id uuid references public.profiles(id) on delete set null,
    request_id uuid references public.leave_requests(id) on delete set null,
    step_id uuid,
    to_mobile text,
    body text not null,
    args text[] not null default '{}',
    status text not null default 'queued',
    skip_reason text,
    attempts integer not null default 0,
    next_attempt_at timestamptz not null default now(),
    net_request_id bigint,
    sending_since timestamptz,
    provider_ref text,
    error text,
    created_by uuid references public.profiles(id) on delete set null,
    created_at timestamptz not null default now(),
    sent_at timestamptz,
    constraint sms_outbox_event check (event in ('approver_new', 'employee_decision', 'password_reset', 'test')),
    constraint sms_outbox_status check (status in ('queued', 'sending', 'sent', 'dry_run', 'failed', 'skipped')),
    constraint sms_outbox_mobile check (to_mobile is null or to_mobile ~ '^09[0-9]{9}$'),
    constraint sms_outbox_skipped_reason check ((status = 'skipped') = (skip_reason is not null))
);

comment on table public.sms_outbox is
  'FR-78: one row per text. Written only by security-definer functions; the admin reads it in the SMS tab.';

create index sms_outbox_due_idx on public.sms_outbox (next_attempt_at) where status = 'queued';
create index sms_outbox_sending_idx on public.sms_outbox (sending_since) where status = 'sending';
create index sms_outbox_company_created_idx on public.sms_outbox (company_id, created_at desc);
create unique index sms_outbox_approver_once on public.sms_outbox
  (request_id, coalesce(step_id, '00000000-0000-0000-0000-000000000000'::uuid), recipient_id)
  where event = 'approver_new';
create unique index sms_outbox_decision_once on public.sms_outbox (request_id) where event = 'employee_decision';

alter table public.sms_outbox enable row level security;

create policy sms_outbox_select_admin on public.sms_outbox for select to authenticated
  using (private.is_admin((select auth.uid())) and company_id = (select private.caller_company()));

grant select on table public.sms_outbox to authenticated;
grant all on table public.sms_outbox to service_role;

-- ── helpers ────────────────────────────────────────────────────────────────

-- Iranian mobile → 09XXXXXXXXX, or null. Persian / Arabic digits, spaces, dashes, +98 / 0098 / 98.
create function private.normalize_ir_mobile(p text) returns text
    language sql immutable
    set search_path to ''
    as $$
  select case when d ~ '^9[0-9]{9}$' then '0' || d end
    from (select regexp_replace(regexp_replace(
                   translate(coalesce(p, ''), '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'),
                   '[^0-9]', '', 'g'),
                 '^(0098|98|0)', '') as d) x;
$$;

-- Jalali YYYY/MM/DD from jalali_months; ISO date outside the table's range.
create function private.jalali_text(p_date date, p_lang text default 'fa') returns text
    language sql stable
    set search_path to ''
    as $$
  select case when p_lang = 'fa' then translate(t, '0123456789', '۰۱۲۳۴۵۶۷۸۹') else t end
    from (select coalesce(
      (select m.jalali_year || '/' || lpad(m.jalali_month::text, 2, '0') || '/'
              || lpad((p_date - m.gregorian_start + 1)::text, 2, '0')
         from public.jalali_months m where p_date between m.gregorian_start and m.gregorian_end),
      to_char(p_date, 'YYYY/MM/DD')) as t) x;
$$;

create function private.sms_kind_label(p_kind public.request_kind, p_unit public.leave_unit, p_lang text)
    returns text
    language sql immutable
    set search_path to ''
    as $$
  select case when p_lang = 'en' then
    case when p_kind = 'leave' then case when p_unit = 'hour' then 'hourly leave' else 'daily leave' end
         else case when p_unit = 'hour' then 'work errand' else 'work trip' end end
  else
    case when p_kind = 'leave' then case when p_unit = 'hour' then 'مرخصی ساعتی' else 'مرخصی روزانه' end
         else case when p_unit = 'hour' then 'مأموریت ساعتی' else 'مأموریت روزانه' end end
  end;
$$;

-- Insert one text. No valid mobile → a 'skipped' row, so the log shows who could not be reached.
-- In one transaction, a second open step held by the same person is folded into the first text.
create function private.sms_queue(p_company uuid, p_event text, p_recipient uuid, p_request uuid,
    p_step uuid, p_body text, p_args text[], p_mobile text default null, p_actor uuid default null)
    returns uuid
    language plpgsql security definer
    set search_path to ''
    as $$
declare v_mobile text; v_id uuid;
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
          case when v_mobile is null then private.sms_mask(p_event, p_body, p_args) else p_body end,
          case when v_mobile is null and p_event = 'password_reset' then '{}' else coalesce(p_args, '{}') end,
          case when v_mobile is null then 'skipped' else 'queued' end,
          case when v_mobile is null then 'no_mobile' end, p_actor)
  on conflict do nothing
  returning id into v_id;
  return v_id;
end $$;
revoke all on function private.sms_queue(uuid, text, uuid, uuid, uuid, text, text[], text, uuid) from public, anon, authenticated;

-- What a request's current state should text. Idempotent: the unique indexes drop repeats.
create function private.sms_enqueue_request(p_request uuid) returns void
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  r public.leave_requests%rowtype;
  s private.sms_settings%rowtype;
  e public.profiles%rowtype;
  st record;
  u record;
  v_order boolean;
  v_any_step boolean := false;
  v_lang text;
  v_kind text;
  v_date text;
  v_word text;
begin
  select * into r from public.leave_requests where id = p_request;
  if not found then return; end if;
  select * into s from private.sms_settings where company_id = r.company_id;
  if not found or s.mode = 'off' then return; end if;
  select * into e from public.profiles where id = r.employee_id;

  if r.status = 'pending' and s.notify_approver_new then
    select coalesce(w.approval_order_enforced, false) into v_order
      from public.work_settings w where w.company_id = r.company_id;
    for st in
      select a.id, a.step_order from public.approval_steps a
       where a.company_id = r.company_id and private.request_step_applies(r.id, a.id)
       order by a.step_order, a.id
    loop
      v_any_step := true;
      continue when private.request_step_decided(r.id, st.id);
      continue when coalesce(v_order, false) and exists (select 1 from public.approval_steps prev
        where prev.company_id = r.company_id and prev.step_order < st.step_order
          and private.request_step_applies(r.id, prev.id)
          and not private.request_step_decided(r.id, prev.id, 'approved'));
      for u in
        select p.id, p.language_pref from public.profiles p
         where p.company_id = r.company_id and p.active and p.id <> r.employee_id
           and private.can_approve_step(p.id, r.id, st.id)
      loop
        v_lang := case when u.language_pref = 'en' then 'en' else 'fa' end;
        v_kind := private.sms_kind_label(r.kind, r.unit, v_lang);
        v_date := private.jalali_text(r.start_date, v_lang);
        perform private.sms_queue(r.company_id, 'approver_new', u.id, r.id, st.id,
          case when v_lang = 'en'
            then format('%s''s %s request (%s) is waiting for your approval.%s%s', e.full_name, v_kind, v_date, chr(10), s.site_label)
            else format('درخواست %s %s (%s) منتظر تأیید شماست.%s%s', v_kind, e.full_name, v_date, chr(10), s.site_label) end,
          array[e.full_name, v_kind, v_date]);
      end loop;
    end loop;
    -- No configured step applies: the legacy chain, decided by the direct manager.
    if not v_any_step and e.manager_id is not null then
      select p.id, p.language_pref into u from public.profiles p where p.id = e.manager_id and p.active;
      if found then
        v_lang := case when u.language_pref = 'en' then 'en' else 'fa' end;
        v_kind := private.sms_kind_label(r.kind, r.unit, v_lang);
        v_date := private.jalali_text(r.start_date, v_lang);
        perform private.sms_queue(r.company_id, 'approver_new', u.id, r.id, null,
          case when v_lang = 'en'
            then format('%s''s %s request (%s) is waiting for your approval.%s%s', e.full_name, v_kind, v_date, chr(10), s.site_label)
            else format('درخواست %s %s (%s) منتظر تأیید شماست.%s%s', v_kind, e.full_name, v_date, chr(10), s.site_label) end,
          array[e.full_name, v_kind, v_date]);
      end if;
    end if;
  elsif r.status in ('approved', 'rejected') and s.notify_employee_decision then
    v_lang := case when e.language_pref = 'en' then 'en' else 'fa' end;
    v_kind := private.sms_kind_label(r.kind, r.unit, v_lang);
    v_date := private.jalali_text(r.start_date, v_lang);
    v_word := case when v_lang = 'en' then case when r.status = 'approved' then 'approved' else 'rejected' end
                   else case when r.status = 'approved' then 'تأیید شد' else 'رد شد' end end;
    perform private.sms_queue(r.company_id, 'employee_decision', r.employee_id, r.id, null,
      case when v_lang = 'en'
        then format('Your %s request (%s) was %s.%s%s', v_kind, v_date, v_word, chr(10), s.site_label)
        else format('درخواست %s شما (%s) %s.%s%s', v_kind, v_date, v_word, chr(10), s.site_label) end,
      array[v_kind, v_date, v_word]);
  end if;
end $$;
revoke all on function private.sms_enqueue_request(uuid) from public, anon, authenticated;

create function private.sms_on_request() returns trigger
    language plpgsql security definer
    set search_path to ''
    as $$
begin
  begin
    perform private.sms_enqueue_request(new.id);
  exception when others then
    raise warning 'sms enqueue failed for request %: % %', new.id, sqlstate, sqlerrm;
  end;
  return null;
end $$;
revoke all on function private.sms_on_request() from public, anon, authenticated;

create function private.sms_on_approval() returns trigger
    language plpgsql security definer
    set search_path to ''
    as $$
begin
  begin
    perform private.sms_enqueue_request(new.request_id);
  exception when others then
    raise warning 'sms enqueue failed for request %: % %', new.request_id, sqlstate, sqlerrm;
  end;
  return null;
end $$;
revoke all on function private.sms_on_approval() from public, anon, authenticated;

create constraint trigger sms_on_request_insert after insert on public.leave_requests
  deferrable initially deferred for each row execute function private.sms_on_request();
create constraint trigger sms_on_request_status after update of status on public.leave_requests
  deferrable initially deferred for each row
  when (old.status is distinct from new.status) execute function private.sms_on_request();
create constraint trigger sms_on_approval_insert after insert on public.leave_request_approvals
  deferrable initially deferred for each row execute function private.sms_on_approval();

-- ── sending (pg_cron → pg_net) ───────────────────────────────────────────────

create function private.sms_mask(p_event text, p_body text, p_args text[]) returns text
    language sql immutable
    set search_path to ''
    as $$
  select case when p_event = 'password_reset' and coalesce(array_length(p_args, 1), 0) >= 1
    then replace(p_body, p_args[1], '••••') else p_body end;
$$;

-- Failures that will not fix themselves fail at once; the rest retry after 1 and 5 minutes.
create function private.sms_fail(p_id uuid, p_error text, p_retry boolean) returns void
    language plpgsql security definer
    set search_path to ''
    as $$
begin
  update public.sms_outbox o
     set status = case when p_retry and o.attempts < 3 then 'queued' else 'failed' end,
         next_attempt_at = now() + case o.attempts when 1 then interval '1 minute' else interval '5 minutes' end,
         error = left(p_error, 500), net_request_id = null, sending_since = null
   where o.id = p_id;
end $$;
revoke all on function private.sms_fail(uuid, text, boolean) from public, anon, authenticated;

create function private.sms_dispatch() returns void
    language plpgsql security definer
    set search_path to ''
    as $$
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
        perform private.sms_fail(o.id, 'no reply from provider', true);
      end if;
      continue;
    end if;
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
    update public.sms_outbox
       set status = 'sending', net_request_id = v_req, sending_since = now(), attempts = attempts + 1,
           body = private.sms_mask(event, body, args),
           args = case when event = 'password_reset' then '{}' else args end
     where id = o.id;
  end loop;
end $$;
revoke all on function private.sms_dispatch() from public, anon, authenticated;

-- ── admin functions (SMS tab) ────────────────────────────────────────────────

create function public.app_sms_settings() returns jsonb
    language plpgsql stable security definer
    set search_path to ''
    as $$
declare v_company uuid := private.require_admin(); v_result jsonb;
begin
  select (to_jsonb(s) - 'api_key' - 'credit_request_id')
         || jsonb_build_object('has_api_key', s.api_key is not null,
                               'credit_pending', s.credit_request_id is not null,
                               'api_key_hint', case when s.api_key is not null then '…' || right(s.api_key, 4) end)
    into v_result from private.sms_settings s where s.company_id = v_company;
  return coalesce(v_result, '{}'::jsonb);
end $$;
revoke all on function public.app_sms_settings() from public, anon;
grant execute on function public.app_sms_settings() to authenticated;

create function public.app_set_sms_settings(p_mode text, p_username text, p_sender_line text,
    p_send_method text, p_body_approver_new integer, p_body_employee_decision integer,
    p_body_password_reset integer, p_notify_approver_new boolean, p_notify_employee_decision boolean,
    p_notify_password_reset boolean, p_site_label text, p_api_key text default null,
    p_clear_api_key boolean default false) returns void
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  v_company uuid := private.require_admin();
  v_before private.sms_settings%rowtype;
  v_after private.sms_settings%rowtype;
begin
  insert into private.sms_settings (company_id) values (v_company) on conflict do nothing;
  select * into v_before from private.sms_settings where company_id = v_company for update;
  update private.sms_settings set
      mode = p_mode,
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
      updated_by = auth.uid(), updated_at = now()
   where company_id = v_company
  returning * into v_after;
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'update_sms_settings', 'sms_settings', v_company,
          to_jsonb(v_before) - 'api_key' - 'credit_request_id',
          (to_jsonb(v_after) - 'api_key' - 'credit_request_id')
            || jsonb_build_object('api_key_changed', v_before.api_key is distinct from v_after.api_key));
end $$;
revoke all on function public.app_set_sms_settings(text, text, text, text, integer, integer, integer, boolean, boolean, boolean, text, text, boolean) from public, anon;
grant execute on function public.app_set_sms_settings(text, text, text, text, integer, integer, integer, boolean, boolean, boolean, text, text, boolean) to authenticated;

create function public.app_sms_test(p_mobile text) returns uuid
    language plpgsql security definer
    set search_path to ''
    as $$
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
  values (v_company, 'test', v_mobile, 'پیام آزمایشی سامانه' || chr(10) || s.site_label, auth.uid())
  returning id into v_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (auth.uid(), 'sms_test', 'sms_outbox', v_id, jsonb_build_object('mode', s.mode));
  return v_id;
end $$;
revoke all on function public.app_sms_test(text) from public, anon;
grant execute on function public.app_sms_test(text) to authenticated;

-- Asks the provider for the balance; the next dispatch run stores the answer.
create function public.app_sms_check_credit() returns void
    language plpgsql security definer
    set search_path to ''
    as $$
declare v_company uuid := private.require_admin(); s private.sms_settings%rowtype;
begin
  select * into s from private.sms_settings where company_id = v_company for update;
  if s.api_key is null then raise exception 'no api key' using errcode = '22023'; end if;
  update private.sms_settings
     set credit_request_id = net.http_get(url := 'https://console.melipayamak.com/api/receive/credit/' || s.api_key,
                                          timeout_milliseconds := 15000),
         credit_error = null
   where company_id = v_company;
end $$;
revoke all on function public.app_sms_check_credit() from public, anon;
grant execute on function public.app_sms_check_credit() to authenticated;

create function public.app_sms_log(p_status text default null, p_event text default null,
    p_limit integer default 50, p_offset integer default 0) returns jsonb
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
        'provider_ref', x.provider_ref, 'created_at', x.created_at, 'sent_at', x.sent_at)
        order by x.created_at desc, x.id), '[]')
      from (select * from scoped order by created_at desc, id limit v_limit offset greatest(coalesce(p_offset, 0), 0)) x
      left join public.profiles p on p.id = x.recipient_id),
    'counts', (select coalesce(jsonb_object_agg(status, n), '{}') from
      (select status, count(*) as n from public.sms_outbox where company_id = v_company
        and created_at > now() - interval '30 days' group by status) c)));
end $$;
revoke all on function public.app_sms_log(text, text, integer, integer) from public, anon;
grant execute on function public.app_sms_log(text, text, integer, integer) to authenticated;

-- Admin password reset with "Text it to the employee". Returns queued | skipped | off.
create function public.app_enqueue_password_sms(p_employee uuid, p_password text) returns text
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  v_company uuid := private.require_admin();
  s private.sms_settings%rowtype;
  e public.profiles%rowtype;
  v_id uuid;
  v_en boolean;
begin
  select * into e from public.profiles where id = p_employee and company_id = v_company;
  if not found then raise exception 'employee not found' using errcode = 'P0002'; end if;
  if char_length(coalesce(p_password, '')) < 6 then raise exception 'invalid password' using errcode = '22023'; end if;
  select * into s from private.sms_settings where company_id = v_company;
  if s.mode is null or s.mode = 'off' or not s.notify_password_reset then return 'off'; end if;
  v_en := e.language_pref = 'en';
  v_id := private.sms_queue(v_company, 'password_reset', e.id, null, null,
    case when v_en then format('Your temporary password: %s%sLogin code: %s%s%s', p_password, chr(10), e.employee_code, chr(10), s.site_label)
         else format('رمز موقت شما: %s%sکد ورود: %s%s%s', p_password, chr(10), e.employee_code, chr(10), s.site_label) end,
    array[p_password, e.employee_code], null, auth.uid());
  return (select status from public.sms_outbox where id = v_id);
end $$;
revoke all on function public.app_enqueue_password_sms(uuid, text) from public, anon;
grant execute on function public.app_enqueue_password_sms(uuid, text) to authenticated;

-- ── schedules (pg_cron lives only in the 'postgres' database) ────────────────
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('bj-sms-dispatch', '30 seconds', 'select private.sms_dispatch()');
    -- 20:50 UTC = 00:20 Asia/Tehran.
    perform cron.schedule('bj-purge-sms-outbox', '50 20 * * *',
      $q$delete from public.sms_outbox where created_at < now() - interval '180 days'$q$);
  end if;
end $$;
