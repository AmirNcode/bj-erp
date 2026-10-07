-- Unpaid Leave was seeded with is_paid = true (supabase/seed.sql). submit_leave_impl
-- and approve_leave_request mark a non-balance request fully unpaid only when
-- `not is_paid`, so every unpaid-leave request stored unpaid_minutes = 0 and the
-- reports counted it as paid time. Found in the 2026-10-06 pre-pilot review.
--
-- 1. Correct the type. The app has no leave-type editor (FR-8), so the seeded
--    names identify it. On a fresh install this matches nothing: install.sh runs
--    migrations before the seed, and the seed itself is corrected in the same change.
update public.leave_types
   set is_paid = false
 where affects_balance = false
   and is_paid = true
   and (name_en = 'Unpaid Leave' or name_fa = 'مرخصی بدون حقوق');

-- 2. Backfill existing requests of any unpaid, non-balance type with the value
--    submit/approve would have stored. Such a type writes no ledger rows, so no
--    balance changes. The approval audit rows keep their original snapshot.
update public.leave_requests r
   set unpaid_minutes = r.requested_minutes
  from public.leave_types lt
 where lt.id = r.leave_type_id
   and r.kind = 'leave'
   and lt.is_paid = false
   and lt.affects_balance = false
   and r.unpaid_minutes <> r.requested_minutes;
