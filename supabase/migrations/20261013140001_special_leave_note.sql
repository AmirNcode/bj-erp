-- FR-65 amendment (2026-10-13): a bereavement grant («فوت اقوام نزدیک») must
-- carry a note, so HR can tell later why each 3 days was granted. Marriage
-- grants may carry one. The grant RPC gains `p_note`; the old two-argument
-- form is dropped (only the app calls it).

alter table public.special_leave_grants
  add column note text,
  add constraint special_leave_grants_note_len check (note is null or length(note) <= 500);

drop function public.app_grant_special_leave(uuid, text);

create function public.app_grant_special_leave(p_employee_id uuid, p_kind text, p_note text default null) returns uuid
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  v_uid     uuid := auth.uid();
  v_company uuid;
  v_type    uuid;
  v_minutes int;
  v_prev    int;
  v_status  text;
  v_id      uuid;
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
begin
  v_company := private.special_leave_target(v_uid, p_employee_id);
  if p_kind not in ('marriage', 'bereavement') then
    raise exception 'invalid special leave kind' using errcode = '22023';
  end if;
  -- FR-65 amendment: HR records why each bereavement grant was made.
  if p_kind = 'bereavement' and v_note is null then
    raise exception 'a note is required for bereavement leave' using errcode = '22023';
  end if;
  if length(v_note) > 500 then
    raise exception 'special leave note is too long (max 500 characters)' using errcode = '22023';
  end if;

  select id into v_type from public.leave_types
   where company_id = v_company and name_en = 'Annual Leave' and active
   limit 1;
  if v_type is null then
    raise exception 'annual leave type not found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('leave:' || p_employee_id::text, 0));

  if p_kind = 'marriage' then
    if exists (select 1 from public.special_leave_grants
                where employee_id = p_employee_id and kind = 'marriage' and revoked_at is null) then
      raise exception 'marriage leave was already granted' using errcode = '22023';
    end if;
    select marital_status into v_status from public.employee_personal_info where employee_id = p_employee_id;
    if v_status is distinct from 'single' then
      raise exception 'marriage leave needs marital status single' using errcode = '22023';
    end if;
  end if;

  v_minutes := 3 * private.company_minutes_per_day(v_company);
  v_prev := public.current_leave_balance(p_employee_id, v_type);

  insert into public.special_leave_grants (company_id, employee_id, kind, leave_type_id, minutes, prev_marital_status, granted_by, note)
  values (v_company, p_employee_id, p_kind, v_type, v_minutes, v_status, v_uid, v_note)
  returning id into v_id;

  insert into public.leave_ledger (employee_id, leave_type_id, entry_type, delta_minutes, balance_after_minutes, note)
  values (p_employee_id, v_type, 'allocation', v_minutes, v_prev + v_minutes,
          case p_kind when 'marriage' then 'marriage leave (3 days)' else 'bereavement leave (3 days)' end);

  if p_kind = 'marriage' then
    update public.employee_personal_info set marital_status = 'married' where employee_id = p_employee_id;
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (v_uid, 'special_leave.grant', 'special_leave_grants', v_id,
          jsonb_build_object('employee_id', p_employee_id, 'kind', p_kind, 'minutes', v_minutes, 'note', v_note));
  return v_id;
end; $$;

revoke all on function public.app_grant_special_leave(uuid, text, text) from public;
grant execute on function public.app_grant_special_leave(uuid, text, text) to authenticated;
