-- FR-70 (2026-10-21): the traveller sees that an approved trip still waits on
-- procurement.
--
-- Owner: a fully approved errand whose booking is not done should read
-- "approved, travel arrangements pending" on My Requests and Home, not plain
-- "Approved". my_travel_bookings() lists finished bookings only (with
-- procurement's note), so this is a separate add-only function: the ids of the
-- caller's approved requests whose booking is still to book, or must be
-- updated after an approved extension. No costs, no booking details.

create function public.my_travel_pending()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select r.id
    from public.travel_bookings b
    join public.leave_requests r on r.id = b.request_id
   where r.employee_id = auth.uid()
     and r.status = 'approved'
     and private.travel_booking_state(r.status, b) in ('to_book', 'extension');
$$;

revoke all on function public.my_travel_pending() from public, anon;
grant execute on function public.my_travel_pending() to authenticated;
