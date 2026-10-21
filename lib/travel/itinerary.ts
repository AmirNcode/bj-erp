/**
 * FR-73 travel itinerary: what procurement booked, in sections — flight legs or
 * the company car, hotel stays — stored as `travel_bookings.itinerary` (jsonb).
 * Pure, so the form, the traveller card and the unit tests share one model.
 *
 * The wire shape is the stored shape (snake_case, Gregorian ISO dates, 24-hour
 * HH:MM times, empty strings dropped). `private.travel_itinerary_check` in SQL
 * enforces the same rules; `itineraryErrors` mirrors it so the form can point at
 * a field before the round trip.
 */

import type { Transport } from '@/lib/actions/travel';
import { parseRials } from '@/lib/leave/perDiem';

export const LEG_FIELDS = ['airline', 'flight_no', 'from', 'to', 'date', 'departs', 'arrives'] as const;
export const CAR_FIELDS = [
  'vehicle',
  'plate',
  'driver_name',
  'driver_mobile',
  'pickup_place',
  'pickup_date',
  'pickup_time',
  'return_place',
  'return_date',
  'return_time',
] as const;
export const STAY_FIELDS = ['name', 'address', 'phone', 'check_in', 'check_out', 'confirmation'] as const;

export type LegField = (typeof LEG_FIELDS)[number];
export type CarField = (typeof CAR_FIELDS)[number];
export type StayField = (typeof STAY_FIELDS)[number];
export type LegDirection = 'outbound' | 'return';

export type FlightLeg = { leg: LegDirection } & Partial<Record<LegField, string>>;
export type CarDetails = Partial<Record<CarField, string>>;
/** `cost_rials`: procurement only — stripped from the traveller's read (my_travel_itineraries). */
export type HotelStay = Partial<Record<StayField, string>> & { cost_rials?: number };
/** A stay in the form: every text field plus the cost as typed. */
export type StayDraft = Record<StayField, string> & { cost: string };

/** The stored itinerary. */
export type Itinerary = {
  one_way?: boolean;
  booking_ref?: string;
  flights?: FlightLeg[];
  car?: CarDetails;
  no_hotel?: boolean;
  stays?: HotelStay[];
};

/** The form's working copy: every field present, empty string = not filled. */
export type ItineraryDraft = {
  one_way: boolean;
  booking_ref: string;
  outbound: Record<LegField, string>;
  return: Record<LegField, string>;
  car: Record<CarField, string>;
  no_hotel: boolean;
  stays: StayDraft[];
};

export const MAX_STAYS = 10;
export const MAX_TEXT = 100;
export const MAX_ADDRESS = 200;
/** Dates may sit this many days either side of the trip — a typo guard. */
export const DATE_SLACK_DAYS = 7;

const DATE_FIELDS = new Set<string>(['date', 'pickup_date', 'return_date', 'check_in', 'check_out']);
const TIME_FIELDS = new Set<string>(['departs', 'arrives', 'pickup_time', 'return_time']);

const blank = <K extends string>(keys: readonly K[]) =>
  Object.fromEntries(keys.map((k) => [k, ''])) as Record<K, string>;

export const emptyStay = (checkIn = '', checkOut = ''): StayDraft => ({
  ...blank(STAY_FIELDS),
  check_in: checkIn,
  check_out: checkOut,
  cost: '',
});

/** Anything typed in a stay, cost included. */
export const stayFilled = (s: StayDraft) => s.cost.trim() !== '' || STAY_FIELDS.some((k) => s[k].trim() !== '');

/** A new booking: outbound on the trip's first day, return on its last, one stay across it. */
export function emptyDraft(tripStart: string, tripEnd: string): ItineraryDraft {
  return {
    one_way: false,
    booking_ref: '',
    outbound: { ...blank(LEG_FIELDS), date: tripStart },
    return: { ...blank(LEG_FIELDS), date: tripEnd },
    car: { ...blank(CAR_FIELDS), pickup_date: tripStart, return_date: tripEnd },
    no_hotel: false,
    stays: [emptyStay(tripStart, tripEnd)],
  };
}

/** The form's starting point: the stored itinerary over the defaults. */
export function draftFromItinerary(it: Itinerary | null, tripStart: string, tripEnd: string): ItineraryDraft {
  const d = emptyDraft(tripStart, tripEnd);
  if (!it) return d;
  const leg = (dir: LegDirection) => it.flights?.find((f) => f.leg === dir);
  const out = leg('outbound');
  const ret = leg('return');
  return {
    one_way: !!it.one_way,
    booking_ref: it.booking_ref ?? '',
    outbound: out ? { ...blank(LEG_FIELDS), ...pick(out, LEG_FIELDS) } : d.outbound,
    return: ret ? { ...blank(LEG_FIELDS), ...pick(ret, LEG_FIELDS) } : d.return,
    car: it.car ? { ...blank(CAR_FIELDS), ...pick(it.car, CAR_FIELDS) } : d.car,
    no_hotel: !!it.no_hotel,
    stays: it.stays?.length
      ? it.stays.map((s) => ({
          ...blank(STAY_FIELDS),
          ...pick(s, STAY_FIELDS),
          cost: typeof s.cost_rials === 'number' ? String(s.cost_rials) : '',
        }))
      : d.stays,
  };
}

function pick<K extends string>(obj: Partial<Record<K, string>>, keys: readonly K[]): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {};
  for (const k of keys) if (typeof obj[k] === 'string') out[k] = obj[k];
  return out;
}

function trimmed<K extends string>(obj: Record<K, string>, keys: readonly K[]): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {};
  for (const k of keys) {
    const v = obj[k].trim();
    if (v) out[k] = v;
  }
  return out;
}

const isEmpty = (o: object) => Object.keys(o).length === 0;

/**
 * The draft as stored: trimmed, empty fields and blocks dropped, only the
 * chosen transport's section kept, no return leg on a one-way trip, no stays
 * when there is no hotel.
 */
export function normalizeItinerary(d: ItineraryDraft, transport: Transport | null): Itinerary {
  const it: Itinerary = {};
  if (d.one_way) it.one_way = true;
  if (transport === 'flight') {
    const ref = d.booking_ref.trim();
    if (ref) it.booking_ref = ref;
    const flights: FlightLeg[] = [];
    const out = trimmed(d.outbound, LEG_FIELDS);
    if (!isEmpty(out)) flights.push({ leg: 'outbound', ...out });
    if (!d.one_way) {
      const ret = trimmed(d.return, LEG_FIELDS);
      if (!isEmpty(ret)) flights.push({ leg: 'return', ...ret });
    }
    if (flights.length) it.flights = flights;
  } else if (transport === 'company_car') {
    const keys = d.one_way ? CAR_FIELDS.filter((k) => !k.startsWith('return_')) : CAR_FIELDS;
    const car = trimmed(d.car, keys);
    if (!isEmpty(car)) it.car = car;
  }
  if (d.no_hotel) {
    it.no_hotel = true;
  } else {
    const stays = d.stays.filter(stayFilled).map((s) => {
      const stay: HotelStay = trimmed(s, STAY_FIELDS);
      // An unparseable cost stays NaN so itineraryErrors flags it; the form never sends it.
      if (s.cost.trim()) stay.cost_rials = parseRials(s.cost);
      return stay;
    });
    if (stays.length) it.stays = stays;
  }
  return it;
}

export type ItineraryErrorKey =
  | 'required'
  | 'tooLong'
  | 'badDate'
  | 'dateOutsideTrip'
  | 'badTime'
  | 'checkOutBeforeIn'
  | 'tooManyStays'
  | 'badCost';

/** `path` names the field: `outbound.flight_no`, `car.pickup_time`, `stays.1.check_in`, `stays`. */
export type ItineraryError = { path: string; key: ItineraryErrorKey };

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const addDays = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

function validDate(iso: string): boolean {
  if (!DATE_RE.test(iso)) return false;
  const t = Date.parse(`${iso}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === iso;
}

/**
 * What stops a save (draft) or «رزرو شد» (`done`). Mirrors
 * `private.travel_itinerary_check`; the database has the last word.
 */
export function itineraryErrors(
  it: Itinerary,
  transport: Transport | null,
  done: boolean,
  tripStart: string,
  tripEnd: string
): ItineraryError[] {
  const errors: ItineraryError[] = [];
  const lo = addDays(tripStart, -DATE_SLACK_DAYS);
  const hi = addDays(tripEnd, DATE_SLACK_DAYS);

  const checkFields = (prefix: string, obj: Partial<Record<string, string>>) => {
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v !== 'string') continue;
      const path = `${prefix}.${k}`;
      if (v.length > (k === 'address' ? MAX_ADDRESS : MAX_TEXT)) errors.push({ path, key: 'tooLong' });
      if (DATE_FIELDS.has(k)) {
        if (!validDate(v)) errors.push({ path, key: 'badDate' });
        else if (v < lo || v > hi) errors.push({ path, key: 'dateOutsideTrip' });
      }
      if (TIME_FIELDS.has(k) && !TIME_RE.test(v)) errors.push({ path, key: 'badTime' });
    }
  };

  if (it.booking_ref && it.booking_ref.length > MAX_TEXT) errors.push({ path: 'booking_ref', key: 'tooLong' });
  for (const f of it.flights ?? []) {
    const { leg, ...rest } = f;
    checkFields(leg, rest);
  }
  if (it.car) checkFields('car', it.car);
  const stays = it.stays ?? [];
  if (stays.length > MAX_STAYS) errors.push({ path: 'stays', key: 'tooManyStays' });
  stays.forEach((s, i) => {
    checkFields(`stays.${i}`, pick(s, STAY_FIELDS));
    if (s.cost_rials !== undefined && !(Number.isSafeInteger(s.cost_rials) && s.cost_rials >= 0)) {
      errors.push({ path: `stays.${i}.cost`, key: 'badCost' });
    }
    if (s.check_in && s.check_out && validDate(s.check_in) && validDate(s.check_out) && s.check_out <= s.check_in) {
      errors.push({ path: `stays.${i}.check_out`, key: 'checkOutBeforeIn' });
    }
  });

  if (done) {
    if (transport === 'flight') {
      const legs: LegDirection[] = it.one_way ? ['outbound'] : ['outbound', 'return'];
      for (const dir of legs) {
        const f = it.flights?.find((x) => x.leg === dir);
        for (const k of ['flight_no', 'date', 'departs'] as const) {
          if (!f?.[k]) errors.push({ path: `${dir}.${k}`, key: 'required' });
        }
      }
    }
    if (!it.no_hotel) {
      if (stays.length === 0) errors.push({ path: 'stays.0.name', key: 'required' });
      stays.forEach((s, i) => {
        for (const k of ['name', 'check_in', 'check_out'] as const) {
          if (!s[k]) errors.push({ path: `stays.${i}.${k}`, key: 'required' });
        }
        if (s.cost_rials === undefined) errors.push({ path: `stays.${i}.cost`, key: 'required' });
      });
    }
  }
  return errors;
}

/**
 * The hotel cost finance sees (`travel_bookings.hotel_cost_rials`): 0 with no
 * hotel, else the sum of the stays' costs; null while no stay has one.
 */
export function hotelTotal(it: Itinerary): number | null {
  if (it.no_hotel) return 0;
  const costs = (it.stays ?? []).map((s) => s.cost_rials).filter((c): c is number => c !== undefined);
  return costs.length ? costs.reduce((a, b) => a + b, 0) : null;
}

/** Nights between check-in and check-out; null when either is missing. */
export function nights(checkIn?: string, checkOut?: string): number | null {
  if (!checkIn || !checkOut || !validDate(checkIn) || !validDate(checkOut)) return null;
  return Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000);
}

/** Anything worth showing the traveller beyond the note. */
export function hasItinerary(it: Itinerary | null | undefined): it is Itinerary {
  return !!it && !!(it.flights?.length || (it.car && !isEmpty(it.car)) || it.stays?.length || it.no_hotel);
}
