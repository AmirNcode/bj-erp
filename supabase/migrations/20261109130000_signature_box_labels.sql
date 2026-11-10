-- Form signature boxes from approval steps (spec 2026-11-09-form-signature-boxes-design).
--
-- 1. approval_steps.box_label: the title the admin gives the step's signature box
--    on the printed form. Nullable so the still-running old app can keep inserting
--    steps during a deploy; the app requires it for new steps.
-- 2. leave_request_approvals.box_label: the box title at the moment of signing,
--    so a printed form keeps its title after the step is renamed or removed.
-- 3. Renaming a box is not a change to the approval chain: the authority triggers
--    skip it, so pending requests are not flagged "configuration changed".
-- 4. The print signatures payload carries the box titles and the company's
--    active steps for the request's kind (boxes the request skipped). Runs after
--    20261109120000_replacement_signoff and keeps its replacement fields.

alter table public.approval_steps
  add column box_label text,
  add constraint approval_steps_box_label_len
    check (box_label is null or char_length(btrim(box_label)) between 1 and 60);

comment on column public.approval_steps.box_label is
  'Title of this step''s signature box on the printed request form (admin-edited).';

update public.approval_steps set box_label = case
    when approver_id is not null then 'امور اداری'
    when role = 'manager' and manager_scope = 'department' then 'مدیر واحد'
    when role = 'manager' then 'تصویب کننده'
    when role = 'hr' then 'امور اداری و منابع انسانی'
    when role = 'security' then 'حراست'
    else null end
  where box_label is null;

alter table public.leave_request_approvals
  add column box_label text;

comment on column public.leave_request_approvals.box_label is
  'Signature-box title of the step when this decision was recorded (printed-form history).';

update public.leave_request_approvals a set box_label = s.box_label
  from public.approval_steps s where s.id = a.step_id and a.box_label is null;

create function private.approval_snapshot_box_label() returns trigger
  language plpgsql security definer set search_path to ''
as $$
begin
  if new.step_id is not null and new.box_label is null then
    select s.box_label into new.box_label from public.approval_steps s where s.id = new.step_id;
  end if;
  return new;
end $$;

revoke all on function private.approval_snapshot_box_label() from public;

create trigger approval_snapshot_box_label before insert on public.leave_request_approvals
  for each row execute function private.approval_snapshot_box_label();

-- A box_label-only edit skips the company lock and the configuration_changed flag.
create or replace function private.approval_box_label_only(p_old jsonb, p_new jsonb) returns boolean
  language sql immutable set search_path to ''
as $$ select (p_old - 'box_label' - 'updated_at') = (p_new - 'box_label' - 'updated_at') $$;

CREATE OR REPLACE FUNCTION private.approval_before_authority_mutation() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_company uuid; v_old_company uuid; v_new_company uuid;
begin
  if tg_table_name='profiles' then
    if tg_op='UPDATE' then
      if new.active is not distinct from old.active and new.manager_id is not distinct from old.manager_id
        and new.department_id is not distinct from old.department_id and new.company_id is not distinct from old.company_id then
        return new;
      end if;
    end if;
  end if;
  if tg_table_name='approval_steps' and tg_op='UPDATE'
    and private.approval_box_label_only(to_jsonb(old),to_jsonb(new)) then
    return new;
  end if;
  if tg_op<>'INSERT' then v_old_company:=private.approval_mutation_company(tg_table_name,to_jsonb(old)); end if;
  if tg_op<>'DELETE' then v_new_company:=private.approval_mutation_company(tg_table_name,to_jsonb(new)); end if;
  for v_company in select distinct company from unnest(array[v_old_company,v_new_company]) company
    where company is not null order by company loop
    perform private.approval_lock(v_company);
  end loop;
  if tg_op='DELETE' then return old; else return new; end if;
end; $$;

CREATE OR REPLACE FUNCTION private.approval_after_authority_mutation() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_company uuid; v_old_company uuid; v_new_company uuid;
begin
  if tg_table_name='profiles' then
    if tg_op='UPDATE' then
      if new.active is not distinct from old.active and new.manager_id is not distinct from old.manager_id
        and new.department_id is not distinct from old.department_id and new.company_id is not distinct from old.company_id then
        return new;
      end if;
    end if;
  end if;
  if tg_table_name='approval_steps' and tg_op='UPDATE'
    and private.approval_box_label_only(to_jsonb(old),to_jsonb(new)) then
    return new;
  end if;
  if tg_op<>'INSERT' then v_old_company:=private.approval_mutation_company(tg_table_name,to_jsonb(old)); end if;
  if tg_op<>'DELETE' then v_new_company:=private.approval_mutation_company(tg_table_name,to_jsonb(new)); end if;
  for v_company in select distinct company from unnest(array[v_old_company,v_new_company]) company
    where company is not null order by company loop
    if tg_table_name='approval_steps' then
      update public.approval_request_policy x set configuration_changed=true
        where x.company_id=v_company and exists(select 1 from public.leave_requests r where r.id=x.request_id and r.status='pending');
    end if;
  end loop;
  if tg_op='DELETE' then return old; else return new; end if;
end; $$;

-- Print payload: each approval item gains box_label (the snapshot, else the live
-- step's); 'steps' lists the company's active steps for the request's kind so the
-- form can print a box for a step this request skipped.
CREATE OR REPLACE FUNCTION private.request_data_get_leave_request_signatures(p_id uuid, p_print boolean) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_result jsonb; v_progress jsonb;
begin
  if not (private.can_read_approval_request(auth.uid(),p_id) or
    (p_print and private.can_print_finance_request(auth.uid(),p_id))) then
    raise exception 'request not found' using errcode='P0002'; end if;
  v_progress:=private.request_data_app_request_approval_progress(p_id,p_print);
  select jsonb_build_object('requester_signature_data',r.signature_data,
    'requester_consent_at',r.signature_consent_at,'approver_signature_data',r.approver_signature_data,
    'approver_signature_consent_at',r.approver_signature_consent_at,
    'replacement_status',rs.status,'replacement_signature_data',rs.signature_data,
    'replacement_signature_consent_at',rs.signature_consent_at,
    'approvals',coalesce((select jsonb_agg(item||jsonb_build_object('signature_data',a.signature_data,
      'signature_consent_at',a.signature_consent_at,
      'box_label',coalesce(a.box_label,st.box_label)) order by (item->>'step_order')::integer)
      from jsonb_array_elements(v_progress) item left join public.leave_request_approvals a
        on a.request_id=r.id and (a.step_id=(item->>'step_id')::uuid
          or (a.step_id is null and item->>'step_id' is null and a.step_role::text=item->>'step_role'))
        left join public.approval_steps st on st.id=(item->>'step_id')::uuid),'[]'),
    'steps',coalesce((select jsonb_agg(jsonb_build_object('step_id',s.id,'step_role',s.role,
      'step_order',s.step_order,'manager_scope',s.manager_scope,'named',s.approver_id is not null,
      'box_label',s.box_label) order by s.step_order,s.id)
      from public.approval_steps s
      where s.company_id=r.company_id and s.active and r.kind=any(s.applies_to)),'[]'))
    into v_result from public.leave_requests r
    left join public.leave_request_replacement_signoffs rs on rs.request_id=r.id
    where r.id=p_id;
  return v_result;
end; $$;
