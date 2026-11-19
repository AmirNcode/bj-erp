-- =============================================================================
-- Migration: 20261118100200_test_emp_no_replacement.sql
-- Purpose  : FR-95 follow-up (security review 2026-11-18). 20261118100100 kept test accounts
--            out of the replacement picker only; the write paths (submit_leave_impl,
--            app_change_replacement, a direct insert) check eligibility on their own. A test
--            account named as replacement would get a sign-off card showing a colleague's
--            request. Refuse it where the data is written: the request row and the sign-off row.
-- Depends  : 20261118100100_test_emp_role.sql (private.is_test_account)
-- =============================================================================

create or replace function private.replacement_not_test_account() returns trigger
  language plpgsql security definer set search_path to '' as $$
begin
  if new.replacement_id is not null
     and (tg_op = 'INSERT' or new.replacement_id is distinct from old.replacement_id)
     and private.is_test_account(new.replacement_id) then
    raise exception 'a test account cannot be a replacement' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.replacement_not_test_account() from public, anon;

create trigger leave_requests_replacement_not_test
  before insert or update of replacement_id on public.leave_requests
  for each row execute function private.replacement_not_test_account();

create trigger replacement_signoffs_not_test
  before insert or update of replacement_id on public.leave_request_replacement_signoffs
  for each row execute function private.replacement_not_test_account();
