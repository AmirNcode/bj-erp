-- FR-72 (2026-10-21): the requester removes a rejected request from Home.
--
-- Home keeps a request until its return-to-work day; a rejected one can be
-- removed earlier. The removal lives in its own table, not on leave_requests,
-- so it never fires that table's approval-lock and update-scope triggers. The
-- Requests tab ignores it. Rows go with the request or the person (cascade,
-- e2e cleanup included). Written only through app_dismiss_home_request.

create table public.home_dismissed_requests (
  request_id uuid primary key references public.leave_requests(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  dismissed_at timestamptz not null default now()
);
comment on table public.home_dismissed_requests is
  'FR-72: rejected requests the requester removed from Home. Read own rows only; written by app_dismiss_home_request.';
alter table public.home_dismissed_requests enable row level security;
create policy home_dismissed_requests_own_read on public.home_dismissed_requests
  for select to authenticated using (employee_id = auth.uid());
revoke all on public.home_dismissed_requests from public, anon, authenticated;
grant select on public.home_dismissed_requests to authenticated;

create or replace function public.app_dismiss_home_request(p_id uuid)
  returns void language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_status public.leave_status;
begin
  if v_uid is null or not private.is_active(v_uid) then
    raise exception 'not allowed' using errcode = '42501'; end if;
  select employee_id, status into v_owner, v_status from public.leave_requests where id = p_id;
  if v_owner is distinct from v_uid then
    raise exception 'request not found' using errcode = 'P0002'; end if;
  if v_status <> 'rejected' then
    raise exception 'only rejected requests can be removed from Home' using errcode = '22023'; end if;
  insert into public.home_dismissed_requests(request_id, employee_id) values (p_id, v_uid)
    on conflict (request_id) do nothing;
end; $$;
revoke all on function public.app_dismiss_home_request(uuid) from public, anon;
grant execute on function public.app_dismiss_home_request(uuid) to authenticated;

notify pgrst, 'reload schema';
