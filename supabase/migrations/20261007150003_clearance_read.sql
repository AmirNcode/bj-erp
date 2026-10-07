-- FR-54 clearance form: read RPCs.
-- A signer may read a form (RLS, can_read_separation) but not the profiles named on
-- it: profiles_select admits only the same team, and get_org_chart lists active
-- people only, so a deactivated leaver's name would vanish. These two return the
-- names alongside the form, for exactly the forms the caller may read. Signature
-- images are never included; the viewer reads one through RLS on demand.

-- Every form the caller may read, newest first. awaiting_me = the caller can sign
-- something on it right now (mirrors app_sign_separation_row / _finance).
create function public.app_list_separations()
    returns table (
      id uuid, employee_id uuid, employee_name text, personnel_no text,
      department_name_fa text, department_name_en text,
      status text, reason text, last_working_day date, deactivated_at timestamptz,
      created_at timestamptz, rows_total integer, rows_signed integer, awaiting_me boolean)
    language sql stable security definer
    set search_path to ''
    as $$
  select s.id, s.employee_id, p.full_name, p.personnel_no, d.name_fa, d.name_en,
         s.status, s.reason, s.last_working_day, s.deactivated_at, s.created_at,
         (select count(*)::int from public.separation_signoffs o where o.separation_id = s.id),
         (select count(*)::int from public.separation_signoffs o where o.separation_id = s.id and o.signed_at is not null),
         s.employee_id <> auth.uid() and (
           (s.status = 'in_progress' and exists (
              select 1 from public.separation_signoffs o
               where o.separation_id = s.id and o.signed_at is null
                 and ((not o.is_hr and o.signer_id = auth.uid())
                      or (o.is_hr and (private.has_role(auth.uid(), 'hr') or private.is_admin(auth.uid()))))))
           or (s.status = 'awaiting_finance' and private.has_role(auth.uid(), 'finance')))
    from public.separations s
    join public.profiles p on p.id = s.employee_id
    left join public.departments d on d.id = p.department_id
   where private.can_read_separation(auth.uid(), s.id)
   order by s.created_at desc
   limit 500;
$$;

-- One form with every name resolved, or 'clearance form not found'.
create function public.app_get_separation(p_id uuid)
    returns jsonb
    language plpgsql stable security definer
    set search_path to ''
    as $$
declare
  v jsonb;
begin
  if not private.can_read_separation(auth.uid(), p_id) then
    raise exception 'clearance form not found' using errcode = 'P0002';
  end if;
  select jsonb_build_object(
           'id', s.id, 'status', s.status, 'reason', s.reason,
           'last_working_day', s.last_working_day, 'hire_date', s.hire_date,
           'father_name', s.father_name, 'birth_cert_no', s.birth_cert_no, 'note', s.note,
           'settlement_date', s.settlement_date, 'finance_note', s.finance_note,
           'finance_signed_at', s.finance_signed_at, 'finance_signed_by_name', fs.full_name,
           'deactivated_at', s.deactivated_at, 'created_at', s.created_at,
           'created_by_name', cb.full_name, 'cancelled_at', s.cancelled_at,
           'employee', jsonb_build_object(
             'id', p.id, 'name', p.full_name, 'personnel_no', p.personnel_no,
             'department_id', p.department_id, 'department_name_fa', d.name_fa,
             'department_name_en', d.name_en, 'active', p.active),
           'rows', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', o.id, 'is_hr', o.is_hr, 'name_fa', o.name_fa, 'name_en', o.name_en,
                      'department_id', o.department_id, 'signer_id', o.signer_id,
                      'signer_name', sp.full_name, 'sort_order', o.sort_order,
                      'signed_by', o.signed_by, 'signed_by_name', sb.full_name,
                      'signed_at', o.signed_at, 'note', o.note)
                    order by o.is_hr desc, o.sort_order)
               from public.separation_signoffs o
               left join public.profiles sp on sp.id = o.signer_id
               left join public.profiles sb on sb.id = o.signed_by
              where o.separation_id = s.id), '[]'::jsonb))
    into v
    from public.separations s
    join public.profiles p on p.id = s.employee_id
    left join public.departments d on d.id = p.department_id
    left join public.profiles fs on fs.id = s.finance_signed_by
    left join public.profiles cb on cb.id = s.created_by
   where s.id = p_id;
  return v;
end; $$;

revoke all on function public.app_list_separations() from public, anon;
grant execute on function public.app_list_separations() to authenticated;
revoke all on function public.app_get_separation(uuid) from public, anon;
grant execute on function public.app_get_separation(uuid) to authenticated;
