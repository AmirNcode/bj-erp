-- FR-84: an approved extension may change the per diem. The print form must keep the
-- originally signed amount, so the read returns what each extension changed.

drop function public.request_errand_extensions(uuid);
create function public.request_errand_extensions(p_id uuid) RETURNS TABLE(old_end_date date, new_end_date date, reason text, status text, evidence text, requested_by_name text, decided_by_name text, decided_at timestamp with time zone, per_diem_before bigint, per_diem_after bigint)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not private.can_read_approval_request(auth.uid(), p_id) then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  return query
    select e.old_end_date, e.new_end_date, e.reason, e.status, e.evidence, q.full_name, d.full_name, e.decided_at,
           e.per_diem_before, e.per_diem_after
      from public.errand_extensions e
      join public.profiles q on q.id = e.requested_by
      left join public.profiles d on d.id = e.decided_by
     where e.request_id = p_id
     order by e.requested_at;
end; $$;
revoke all on function public.request_errand_extensions(uuid) from public, anon;
grant execute on function public.request_errand_extensions(uuid) to authenticated, service_role;
