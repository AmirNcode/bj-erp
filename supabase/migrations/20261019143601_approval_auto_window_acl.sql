-- 20261019143148 left Supabase's default anon EXECUTE on app_set_auto_approval_window. The body
-- already rejects anon (admin required), but sibling delegation RPCs grant authenticated only.
revoke all on function public.app_set_auto_approval_window(integer) from public, anon, authenticated;
grant execute on function public.app_set_auto_approval_window(integer) to authenticated;
