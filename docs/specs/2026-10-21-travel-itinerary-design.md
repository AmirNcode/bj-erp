# Structured travel itinerary (flight / company car, hotel stays, export)

**Date:** 2026-10-21 · **Status:** approved by owner 2026-10-21; implemented on `codex/approval-fixes` (unreleased)
**Trigger:** owner: procurement's single free-text note is hard to read; give flight / company car and hotel
their own sections, keep the note for anything else, mobile-friendly, save the itinerary as PDF or JPEG.
**Requirements:** FR-73 (new). Extends FR-70 (`docs/specs/2026-10-20-travel-booking-design.md`).

## 1. What changes for whom

| Who | Today | After |
|---|---|---|
| Procurement (`/procurement/[id]`) | transport radio, two costs, one note | three sections: **Getting there**, **Hotel**, **Other notes**; costs unchanged |
| Traveller (My Requests, Home "Show more") | grey box: transport + note | itinerary card (boarding-pass legs, hotel stays, note) + **Save as PDF** / **Save as image** |
| Finance, HR, approvals | — | unchanged (costs and states are untouched) |

The traveller still sees nothing until procurement marks the booking «رزرو شد» once (`first_done_at`), and
never sees costs. Bookings finished before this release have no itinerary: they keep today's box.

## 2. Procurement form

**Getting there.** Transport choice (Flight / Company car) switches the fields below it.
- **Flight**: an **Outbound** leg and, unless **One way** is ticked, a **Return** leg. Each leg: airline,
  flight no., from, to (all typed text), date (Jalali picker; defaults: outbound = trip start, return = trip
  end), departs, arrives (HH:MM). Then **booking reference** (optional) and **ticket cost (Rials)**.
- **Company car**: every field optional (owner, 2026-10-21): vehicle, plate, driver name, driver mobile,
  pickup place, pickup date + time; a **Return pickup** block (date + time + place) unless **One way**.
  Ticket cost stays fixed at 0 as today.

**Hotel.** One stay by default: hotel name, address, phone, check-in, check-out (defaults: trip start / end),
confirmation no. (optional). A **+ Add another stay** button at the bottom of the section appends the next
stay below a divider; each extra stay has a **Remove** button. **No hotel** (checkbox, day trips) hides the
stays and sets the hotel cost to 0. One **hotel cost (Rials)** for all stays, as today.

**Other notes for the traveller.** Today's note field (≤ 500), relabelled, optional.

**Saving.** "Save" keeps a draft with whatever is filled. «رزرو شد» requires:
- flight: transport, outbound flight no. + date + departs; return the same unless one way; ticket cost;
- company car: transport only;
- hotel: **No hotel**, or every stay has name + check-in + check-out with check-out after check-in;
- hotel cost (0 allowed).

Dates must fall within a week of the trip (start − 7 days … end + 7 days) — a typo guard, not a rule
procurement must think about. Times are free 24-hour HH:MM; an arrival earlier than departure is allowed
(overnight).

## 3. Traveller itinerary card

```
┌───────────────────────────────────────────────┐
│ 09:00            ✈ AC99 · Iran Air      10:20 │   outbound leg
│ Shiraz · 1405/08/02                    Tehran │
├ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┤
│ 16:00            ✈ AC19 · return        17:15 │   return leg (absent if one way)
├───────────────────────────────────────────────┤
│ 🏨 Ritz Carlton · main square · 021…          │   one block per stay
│    1405/08/02 → 1405/08/08 · 6 nights          │
├───────────────────────────────────────────────┤
│ Driver meets you at arrivals.                 │   other notes
│                 [Save as PDF] [Save as image] │
└───────────────────────────────────────────────┘
```

- Company car replaces the legs with one block: vehicle · plate, driver + tap-to-call mobile, pickup
  date/time/place, return pickup. Only the filled fields show.
- Direction follows the locale (RTL in Farsi: departure on the right). Times, flight numbers, phone numbers
  and booking references are wrapped in `<bdi dir="ltr">`.
- Nights = check-out − check-in, computed in the UI.

**Mobile (≥ 320 px).** The leg row stays three columns (time · flight · time) — it fits at 320 px with the
22 px time; city/date wrap under each time. Hotel and car blocks are single column. On the procurement form
every grid collapses to one column below `sm`; a leg becomes a stacked group headed "Outbound" / "Return";
the export buttons and "+ Add another stay" are full width on mobile.

## 4. Export (PDF / JPEG)

Both buttons render the same itinerary card (without the buttons) on a white background at 2× scale.
- **Save as image** → `itinerary-<serial>.jpg` (e.g. `itinerary-1405-0011.jpg`).
- **Save as PDF** → `itinerary-<serial>.pdf`: one A4 portrait page with the traveller's name, tracking no.,
  trip dates and the card image.
- Client-side only (no server rendering, nothing uploaded). Libraries: `html-to-image` (DOM → JPEG) and
  `jspdf` (image → PDF), loaded with `import()` on click so they stay out of the page bundle. Vazirmatn must
  be embedded in the image (same-origin font, verified in the browser before merge).
- Costs never appear (the card has none).

## 5. Data

- `travel_bookings.itinerary jsonb` (nullable; NULL = booking from before FR-73). Gregorian ISO dates, per
  convention 1. Shape (all strings trimmed; empty → absent):

```json
{
  "one_way": false,
  "booking_ref": "X7KQ2P",
  "flights": [
    { "leg": "outbound", "airline": "Iran Air", "flight_no": "AC99", "from": "Shiraz", "to": "Tehran",
      "date": "2026-10-24", "departs": "09:00", "arrives": "10:20" }
  ],
  "car": { "vehicle": "", "plate": "", "driver_name": "", "driver_mobile": "",
           "pickup_place": "", "pickup_date": "", "pickup_time": "",
           "return_place": "", "return_date": "", "return_time": "" },
  "no_hotel": false,
  "stays": [
    { "name": "Ritz Carlton", "address": "", "phone": "", "check_in": "2026-10-24",
      "check_out": "2026-10-30", "confirmation": "" }
  ]
}
```

- Validated in SQL by `private.travel_itinerary_check(p_itinerary, p_transport, p_done, p_start, p_end)`:
  known keys only, text ≤ 100 chars (address ≤ 200), at most 2 legs (one per direction) and 10 stays,
  valid dates in the window, `HH:MM` times, plus the «رزرو شد» rules in §2. Errors use SQLSTATE `22023`.
- **New** `public.app_save_travel_booking_v2(p_request, p_transport, p_flight, p_hotel, p_itinerary, p_note,
  p_done)`: today's checks + the itinerary check; audit row adds `itinerary` keys present (not values).
  `app_save_travel_booking` stays for the old app during the release (it leaves `itinerary` untouched).
- `public.app_travel_booking(p_request)` (jsonb) adds an `itinerary` key — same signature, old app ignores it.
- **New** `public.my_travel_itineraries()` → `(request_id, transport, itinerary, traveller_note)`, same rows
  as `my_travel_bookings()` (own, approved, `first_done_at` set). The old function stays until the next
  release.
- Personal-data scope: the itinerary holds no traveller personal data beyond what procurement types (driver
  mobile, hotel phone). Same visibility as the note: procurement for the booking, and the traveller.

## 5a. Amendment 2026-10-21: a cost per hotel stay

Owner: each stay has its own **hotel cost (Rials)**; under the stays the form shows the **total**, which is
what finance gets. Stays carry `cost_rials` (whole Rials, jsonb number); `hotel_cost_rials` stays the column
finance reads and must equal the stays' sum (0 with No hotel). «رزرو شد» needs a cost on every stay. The
traveller's read strips the costs (`private.travel_itinerary_without_costs`). A booking saved before this with
one stay and a hotel cost opens with that cost in the stay. Migration `20261021120005_travel_stay_costs.sql`.

## 6. Out of scope

Pick-lists for airlines/airports (owner: typed in), multi-city flights (more than outbound + return),
sharing the itinerary by link, showing the itinerary to HR or the approvers.

## 7. Open questions

None — owner answers 2026-10-21: one way is an option; several stays via "+"; company-car fields optional;
airline and airports typed in; mobile-friendly; PDF and JPEG export.
