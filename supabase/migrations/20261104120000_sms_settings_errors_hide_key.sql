-- PR #17 review F1 (2026-11-04): app_set_sms_settings must never echo the API key.
--
-- A CHECK or NOT NULL violation on private.sms_settings (a sender line of "12", an empty site
-- label, a malformed key) made Postgres attach DETAIL "Failing row contains (…)" with the whole
-- row, the stored api_key included. PostgREST returns that DETAIL to the caller, so anyone holding
-- an admin token could read the write-only key back, and the database log kept it in plain text.
--
-- Same function, same signature and grants (CREATE OR REPLACE keeps the ACL). The update now
-- runs in its own block: a constraint failure is re-raised with the constraint (or column) name
-- only, so lib/errors/db-error.ts still maps it, and no row values leave the database.

CREATE OR REPLACE FUNCTION public.app_set_sms_settings(p_mode text, p_username text, p_sender_line text,
    p_send_method text, p_body_approver_new integer, p_body_employee_decision integer,
    p_body_password_reset integer, p_notify_approver_new boolean, p_notify_employee_decision boolean,
    p_notify_password_reset boolean, p_site_label text, p_api_key text DEFAULT NULL::text,
    p_clear_api_key boolean DEFAULT false) RETURNS void
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
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'update_sms_settings', 'sms_settings', v_company,
          to_jsonb(v_before) - 'api_key' - 'credit_request_id',
          (to_jsonb(v_after) - 'api_key' - 'credit_request_id')
            || jsonb_build_object('api_key_changed', v_before.api_key is distinct from v_after.api_key));
end $$;
