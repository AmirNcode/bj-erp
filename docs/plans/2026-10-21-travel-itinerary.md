# Plan — structured travel itinerary and export (FR-73)

**Spec:** `docs/specs/2026-10-21-travel-itinerary-design.md`.
**Branch:** `codex/approval-fixes` (after the org-chart and "travel pending" changes, still uncommitted).
**Status:** implemented 2026-10-21 (owner: "Proceed to build this out"). Deviations: TS uses the stored snake_case shape directly (no wire mapping); `jspdf` ^4.2.1 (3.x fails `npm audit`); the company car has no ticket-cost field (saved as 0).

## Ground rules

- Migrations up to `20261021120003` are frozen (applied locally). New: `20261021120004_travel_itinerary.sql`.
- Dry-run the migration with `tests/sql/travel-itinerary.sql` inside `begin … rollback` as `supabase_admin`,
  then `./deploy/bj-deploy update local`, `npm run schema:dump`, restart `bj-erp-rest-1`.
- Old app keeps working against the new schema: add-only functions, `app_travel_booking` keeps its signature.
- Check `html-to-image` and `jspdf` APIs with Context7 before using them; pin with `^` like the rest.
- `lib/supabase/types.ts` hand-edited. Every string in `messages/fa.json` + `messages/en.json`.
- Commit only when the owner asks.

## Task 1 — Pure itinerary model (`lib/travel/itinerary.ts`, new)

- Types `Itinerary`, `FlightLeg`, `CarDetails`, `HotelStay` matching spec §5 (camelCase in TS,
  snake_case on the wire via `toWire` / `fromWire`).
- `emptyItinerary(tripStart, tripEnd)`: outbound date = start, return = end, one stay start→end.
- `normalizeItinerary(it)`: trims, drops empty strings/legs, drops the return leg when `oneWay`,
  drops stays when `noHotel`.
- `itineraryErrors(it, transport, done, tripStart, tripEnd)`: mirrors the SQL check (spec §2, §5) and
  returns message keys, so the form can flag fields before the round trip.
- `nights(checkIn, checkOut)`.
- Unit tests `tests/unit/travel-itinerary.test.ts`: defaults, one-way, no hotel, extra stays, done rules
  for flight vs car, date window, HH:MM, check-out before check-in, wire round trip.

## Task 2 — SQL (`20261021120004_travel_itinerary.sql`)

1. `alter table public.travel_bookings add column itinerary jsonb;` + column comment.
2. `private.travel_itinerary_check(p_it jsonb, p_transport text, p_done boolean, p_start date, p_end date)
   returns void` — raises `22023` with a short English reason (mapped in `lib/errors/db-error.ts`) for: not
   an object, unknown key, wrong type, text too long, > 1 leg per direction, > 10 stays, bad date / outside
   the ±7-day window, bad `HH:MM`, check-out ≤ check-in, and the «رزرو شد» requirements.
3. `public.app_save_travel_booking_v2(p_request uuid, p_transport text, p_flight bigint, p_hotel bigint,
   p_itinerary jsonb, p_note text, p_done boolean)`: copy `app_save_travel_booking` from `schema.sql`, call
   the check with the request's dates, write `itinerary`; `no_hotel` → hotel cost must be 0. Audit `after`
   adds `itinerary_keys` (key names only). Grants: `authenticated` only.
4. `create or replace function public.app_travel_booking(p_request uuid)` (copy from `schema.sql`) adding
   `'itinerary', b.itinerary`.
5. `public.my_travel_itineraries()` returning `(request_id, transport, itinerary, traveller_note)`,
   same filter as `my_travel_bookings()`.
- `tests/sql/travel-itinerary.sql` (pattern of `tests/sql/travel-booking.sql`): save draft with partial
  data, «رزرو شد» refused per missing field, one way, no hotel with cost > 0 refused, 11 stays refused,
  unknown key refused, non-procurement refused (`42501`), traveller sees the itinerary only after done,
  old `app_save_travel_booking` leaves `itinerary` as it was.

## Task 3 — Server actions (`lib/actions/travel.ts`)

- `saveTravelBooking` takes `itinerary` and calls `app_save_travel_booking_v2` (client-side
  `normalizeItinerary` first).
- `TravelBookingDetail.itinerary`.
- `getMyTravelBookings` reads `my_travel_itineraries` (fallback: none); `TravelNote` gains `itinerary`.
  Keep the `pending` merge from `my_travel_pending`.

## Task 4 — Procurement form (`app/[locale]/(app)/procurement/[id]/`)

- Split `BookingForm.tsx` into `BookingForm` (state, save, costs) + `TransportSection` (flight legs or car)
  + `HotelSection` (stays, "+ Add another stay", Remove, No hotel) + notes. Dates use `PersianDateField`.
- Layout: one column below `sm`; leg = stacked group on mobile, a 4-column row (`flight no · date ·
  departs · arrives`) with airline/from/to above it on `sm+`. Full-width add button on mobile.
- Field errors from `itineraryErrors` shown inline; server error as today.
- `page.tsx` passes trip start/end and the stored itinerary (or `emptyItinerary`).

## Task 5 — Traveller card (`components/TravelItinerary.tsx`, new)

- Boarding-pass legs, car block, stay blocks, note (spec §3); `<bdi dir="ltr">` on times/codes/phones;
  `tel:` link on the driver mobile; RTL-correct order.
- `RequestDetails.tsx`: itinerary present → `TravelItinerary`; else today's transport + note box.
- Check at 320 / 375 / 768 px and desktop, fa and en.

## Task 6 — Export (`components/TravelItineraryExport.tsx`, new)

- Two secondary buttons, "Save as PDF" / "Save as image" (`ذخیره PDF` / `ذخیره تصویر`).
- On click: `await import('html-to-image')` → JPEG of the card node (white bg, `pixelRatio: 2`, buttons
  excluded via `filter`); PDF: `await import('jspdf')`, A4 portrait, header lines rendered as part of the
  captured node (so Farsi text needs no PDF font), image scaled to page width.
- File names `itinerary-<serial>.jpg|pdf`. Busy state on the clicked button; error line on failure.
- Verify the downloaded JPEG shows Vazirmatn, not a fallback font, on Chrome desktop and Android Chrome.

## Task 7 — Copy, docs, verification

- Strings: section titles, field labels, one way, no hotel, add/remove stay, export buttons, error keys.
- Docs: `docs/REQUIREMENTS.md` FR-73, `docs/DATA_MODEL.md` (itinerary column + functions),
  `docs/PERMISSIONS.md` (new RPCs), `docs/CHANGELOG.md`, `docs/AGENT-LOG.md`.
- Run: `tsc --noEmit`, `npm run lint`, `npm run test:unit`, SQL test, `npm run build`; browser pass on the
  procurement form and the traveller card at mobile and desktop widths, both export buttons.
