-- FR-96 follow-up: Profile › Mobile for SMS shows the caller's latest texts.
-- app_my_recent_sms returns only rows addressed to the caller (recipient_id = auth.uid()), never
-- skipped or dry_run rows, and always masks a password_reset body. Read-only (stable, no locks), so it
-- also works under View as. public.sms_outbox keeps its admin-only RLS; this function is the only
-- non-admin read path.

create index if not exists sms_outbox_recipient_created_idx
  on public.sms_outbox (recipient_id, created_at desc);

create or replace function public.app_my_recent_sms(p_limit integer default 3) returns jsonb
  language plpgsql stable security definer
  set search_path to ''
  as $$
declare
  v_uid uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 3), 1), 10);
begin
  if v_uid is null or not private.is_active(v_uid) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', x.id, 'event', x.event, 'to_mobile', x.to_mobile,
             'body', private.sms_mask(x.event, x.body, x.args),
             'status', x.status, 'created_at', x.created_at, 'sent_at', x.sent_at)
           order by x.created_at desc, x.id), '[]'::jsonb)
      from (select o.* from public.sms_outbox o
             where o.recipient_id = v_uid
               and o.status in ('queued', 'sending', 'sent', 'failed')
             order by o.created_at desc, o.id
             limit v_limit) x);
end $$;

revoke all on function public.app_my_recent_sms(integer) from public, anon;
grant execute on function public.app_my_recent_sms(integer) to authenticated;
