import { describe, expect, it } from 'vitest';
import {
  draftFromItinerary,
  emptyDraft,
  emptyStay,
  hasItinerary,
  hotelTotal,
  itineraryErrors,
  nights,
  normalizeItinerary,
} from '@/lib/travel/itinerary';

const START = '2026-10-24';
const END = '2026-10-30';

function bookedFlight() {
  const d = emptyDraft(START, END);
  d.outbound = { ...d.outbound, airline: 'Iran Air', flight_no: 'AC99', from: 'Shiraz', to: 'Tehran', departs: '09:00', arrives: '10:20' };
  d.return = { ...d.return, flight_no: 'AC19', departs: '16:00' };
  d.stays[0].name = 'Ritz Carlton';
  d.stays[0].cost = '985';
  return d;
}

describe('emptyDraft', () => {
  it('defaults the legs and the stay to the trip dates', () => {
    const d = emptyDraft(START, END);
    expect(d.outbound.date).toBe(START);
    expect(d.return.date).toBe(END);
    expect(d.car.pickup_date).toBe(START);
    expect(d.car.return_date).toBe(END);
    expect(d.stays).toEqual([emptyStay(START, END)]);
  });
});

describe('normalizeItinerary', () => {
  it('keeps only the chosen transport and drops empty fields', () => {
    const d = bookedFlight();
    d.car.vehicle = 'Samand';
    const it = normalizeItinerary(d, 'flight');
    expect(it.car).toBeUndefined();
    expect(it.flights).toEqual([
      { leg: 'outbound', airline: 'Iran Air', flight_no: 'AC99', from: 'Shiraz', to: 'Tehran', date: START, departs: '09:00', arrives: '10:20' },
      { leg: 'return', flight_no: 'AC19', date: END, departs: '16:00' },
    ]);
    expect(it.stays).toEqual([{ name: 'Ritz Carlton', check_in: START, check_out: END, cost_rials: 985 }]);
  });

  it('drops the return leg on a one-way trip', () => {
    const d = bookedFlight();
    d.one_way = true;
    const it = normalizeItinerary(d, 'flight');
    expect(it.one_way).toBe(true);
    expect(it.flights?.map((f) => f.leg)).toEqual(['outbound']);
  });

  it('drops the car return pickup on a one-way trip', () => {
    const d = emptyDraft(START, END);
    d.one_way = true;
    d.car.driver_name = '  Ali  ';
    const it = normalizeItinerary(d, 'company_car');
    expect(it.car).toEqual({ driver_name: 'Ali', pickup_date: START });
  });

  it('drops stays when there is no hotel, and blank extra stays', () => {
    const d = bookedFlight();
    d.stays.push({ ...emptyStay(), name: '  ' });
    expect(normalizeItinerary(d, 'flight').stays).toHaveLength(1);
    d.no_hotel = true;
    const it = normalizeItinerary(d, 'flight');
    expect(it.no_hotel).toBe(true);
    expect(it.stays).toBeUndefined();
  });

  it('keeps no transport section when none is chosen', () => {
    const it = normalizeItinerary(bookedFlight(), null);
    expect(it.flights).toBeUndefined();
    expect(it.car).toBeUndefined();
  });

  it('round-trips through draftFromItinerary', () => {
    const d = bookedFlight();
    d.stays.push({ ...emptyStay('2026-10-27', END), name: 'Second' });
    const it = normalizeItinerary(d, 'flight');
    expect(normalizeItinerary(draftFromItinerary(it, START, END), 'flight')).toEqual(it);
  });
});

describe('itineraryErrors', () => {
  it('accepts a complete flight booking', () => {
    expect(itineraryErrors(normalizeItinerary(bookedFlight(), 'flight'), 'flight', true, START, END)).toEqual([]);
  });

  it('lets a draft through with missing fields', () => {
    const it = normalizeItinerary(emptyDraft(START, END), 'flight');
    expect(itineraryErrors(it, 'flight', false, START, END)).toEqual([]);
  });

  it('requires flight no., date and departure on each leg when booked', () => {
    const d = bookedFlight();
    d.return.flight_no = '';
    d.return.departs = '';
    const errs = itineraryErrors(normalizeItinerary(d, 'flight'), 'flight', true, START, END);
    expect(errs).toEqual([
      { path: 'return.flight_no', key: 'required' },
      { path: 'return.departs', key: 'required' },
    ]);
  });

  it('needs only the outbound leg one way', () => {
    const d = bookedFlight();
    d.one_way = true;
    d.return.flight_no = '';
    expect(itineraryErrors(normalizeItinerary(d, 'flight'), 'flight', true, START, END)).toEqual([]);
  });

  it('needs nothing for a company car but the hotel', () => {
    const d = emptyDraft(START, END);
    d.no_hotel = true;
    expect(itineraryErrors(normalizeItinerary(d, 'company_car'), 'company_car', true, START, END)).toEqual([]);
  });

  it('requires each stay to be complete when booked', () => {
    const d = bookedFlight();
    d.stays.push(emptyStay('2026-10-27', ''));
    const errs = itineraryErrors(normalizeItinerary(d, 'flight'), 'flight', true, START, END);
    expect(errs).toEqual([
      { path: 'stays.1.name', key: 'required' },
      { path: 'stays.1.check_out', key: 'required' },
      { path: 'stays.1.cost', key: 'required' },
    ]);
  });

  it('flags an unreadable stay cost, and totals the stays for finance', () => {
    const d = bookedFlight();
    d.stays.push({ ...emptyStay('2026-10-27', END), name: 'Second', cost: '۲٬۰۰۰' });
    expect(hotelTotal(normalizeItinerary(d, 'flight'))).toBe(2985);
    d.stays[1].cost = '12.5';
    expect(itineraryErrors(normalizeItinerary(d, 'flight'), 'flight', false, START, END)).toEqual([
      { path: 'stays.1.cost', key: 'badCost' },
    ]);
    d.no_hotel = true;
    expect(hotelTotal(normalizeItinerary(d, 'flight'))).toBe(0);
    expect(hotelTotal(normalizeItinerary(emptyDraft(START, END), 'flight'))).toBeNull();
  });

  it('flags dates outside the trip window, bad times, and check-out before check-in', () => {
    const d = bookedFlight();
    d.outbound.date = '2026-10-16';
    d.outbound.departs = '25:00';
    d.stays[0].check_out = START;
    const errs = itineraryErrors(normalizeItinerary(d, 'flight'), 'flight', false, START, END);
    expect(errs).toEqual([
      { path: 'outbound.date', key: 'dateOutsideTrip' },
      { path: 'outbound.departs', key: 'badTime' },
      { path: 'stays.0.check_out', key: 'checkOutBeforeIn' },
    ]);
  });

  it('accepts dates up to a week either side', () => {
    const d = bookedFlight();
    d.outbound.date = '2026-10-17';
    d.return.date = '2026-11-06';
    expect(itineraryErrors(normalizeItinerary(d, 'flight'), 'flight', true, START, END)).toEqual([]);
  });

  it('caps text length and the number of stays', () => {
    const d = bookedFlight();
    d.outbound.airline = 'x'.repeat(101);
    d.stays[0].address = 'y'.repeat(200);
    d.stays = [...d.stays, ...Array.from({ length: 10 }, () => ({ ...emptyStay(START, END), name: 'H', cost: '1' }))];
    const errs = itineraryErrors(normalizeItinerary(d, 'flight'), 'flight', false, START, END);
    expect(errs).toEqual([
      { path: 'outbound.airline', key: 'tooLong' },
      { path: 'stays', key: 'tooManyStays' },
    ]);
  });
});

describe('nights / hasItinerary', () => {
  it('counts nights', () => {
    expect(nights(START, END)).toBe(6);
    expect(nights(START, undefined)).toBeNull();
  });

  it('treats an empty itinerary as none', () => {
    expect(hasItinerary(null)).toBe(false);
    expect(hasItinerary({})).toBe(false);
    expect(hasItinerary({ one_way: true })).toBe(false);
    expect(hasItinerary({ no_hotel: true })).toBe(true);
  });
});
