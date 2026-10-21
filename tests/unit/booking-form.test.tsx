import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { BookingForm } from '@/app/[locale]/(app)/procurement/[id]/BookingForm';

const mocks = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn() }));
vi.mock('@/lib/actions/travel', () => ({ saveTravelBooking: mocks.save }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

type Initial = Parameters<typeof BookingForm>[0]['initial'];
const empty: Initial = { transport: null, flightCostRials: null, hotelCostRials: null, itinerary: null, note: null, done: false };
const START = '2026-10-24';
const END = '2026-10-30';

function renderForm(initial: Initial = empty) {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <BookingForm requestId="r1" locale="en" tripStart={START} tripEnd={END} initial={initial} />
    </NextIntlClientProvider>
  );
}
const flight = () => screen.getByLabelText('Ticket cost (Rials)') as HTMLInputElement;
const total = () => screen.getByTestId('hotel-total').textContent;
const type = (testId: string, value: string) => fireEvent.change(screen.getByTestId(testId), { target: { value } });
const fillFlights = () => {
  fireEvent.click(screen.getByLabelText('Flight'));
  type('outbound-flight_no', 'AC99');
  type('outbound-departs', '09:00');
  type('return-flight_no', 'AC19');
  type('return-departs', '16:00');
};

beforeEach(() => { vi.clearAllMocks(); mocks.save.mockResolvedValue({ ok: true }); });
afterEach(cleanup);

describe('procurement booking form (FR-70, FR-73)', () => {
  it('marking done needs a transport and both costs', () => {
    renderForm();
    fireEvent.click(screen.getByTestId('itinerary-no-hotel'));
    fireEvent.click(screen.getByTestId('booking-done'));
    expect(screen.getByRole('alert').textContent).toBe('Choose the transport and enter both costs (0 if none).');
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('company car has no ticket cost and saves 0', async () => {
    renderForm();
    fireEvent.click(screen.getByLabelText('Company car'));
    expect(screen.queryByLabelText('Ticket cost (Rials)')).toBeNull();
    expect(screen.getByText('Every field is optional.')).toBeTruthy();
    fireEvent.click(screen.getByTestId('itinerary-no-hotel'));
    fireEvent.click(screen.getByTestId('booking-done'));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      transport: 'company_car', flightCostRials: 0, hotelCostRials: 0, done: true,
    })));
  });

  it('a saved company-car draft can be marked done with only the hotel filled', async () => {
    renderForm({ ...empty, transport: 'company_car', itinerary: { car: { driver_name: 'Ali' } } });
    expect((screen.getByTestId('car-driver_name') as HTMLInputElement).value).toBe('Ali');
    type('stays-0-name', 'Homa');
    type('stays-0-cost', '1000000');
    fireEvent.click(screen.getByTestId('booking-done'));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      transport: 'company_car', flightCostRials: 0, hotelCostRials: 1_000_000, done: true,
      itinerary: {
        car: { driver_name: 'Ali' },
        stays: [{ name: 'Homa', check_in: START, check_out: END, cost_rials: 1_000_000 }],
      },
    })));
  });

  it('saves flights, two stays, Persian-digit costs and the note', async () => {
    renderForm({ ...empty, itinerary: { stays: [
      { name: 'Hotel Zand', check_in: START, check_out: '2026-10-27' },
      { name: 'Homa', check_in: '2026-10-27', check_out: END },
    ] } });
    fillFlights();
    type('outbound-airline', 'Iran Air');
    type('booking_ref', 'X7KQ2P');
    type('stays-0-cost', '1,500,000');
    type('stays-1-cost', '۵۰۰٬۰۰۰');
    expect(total()).toContain('2,000,000');
    fireEvent.change(flight(), { target: { value: '۵٬۰۰۰٬۰۰۰' } });
    fireEvent.change(screen.getByLabelText('Other notes for the traveller'), { target: { value: 'Driver at arrivals' } });
    fireEvent.click(screen.getByTestId('booking-done'));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({
      requestId: 'r1', transport: 'flight', flightCostRials: 5_000_000, hotelCostRials: 2_000_000,
      itinerary: {
        booking_ref: 'X7KQ2P',
        flights: [
          { leg: 'outbound', airline: 'Iran Air', flight_no: 'AC99', date: START, departs: '09:00' },
          { leg: 'return', flight_no: 'AC19', date: END, departs: '16:00' },
        ],
        stays: [
          { name: 'Hotel Zand', check_in: START, check_out: '2026-10-27', cost_rials: 1_500_000 },
          { name: 'Homa', check_in: '2026-10-27', check_out: END, cost_rials: 500_000 },
        ],
      },
      note: 'Driver at arrivals', done: true,
    }));
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('flags the missing flight and hotel fields beside them', () => {
    renderForm();
    fireEvent.click(screen.getByLabelText('Flight'));
    fireEvent.change(flight(), { target: { value: '0' } });
    fireEvent.click(screen.getByTestId('booking-done'));
    expect(screen.getByRole('alert').textContent).toBe('Fix the highlighted fields.');
    expect(screen.getAllByText('Needed to mark it booked.')).toHaveLength(6);
    expect(screen.getByTestId('outbound-flight_no').getAttribute('aria-invalid')).toBe('true');
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('one way drops the return leg', async () => {
    renderForm();
    fillFlights();
    fireEvent.click(screen.getByTestId('itinerary-one-way'));
    expect(screen.queryByTestId('leg-return')).toBeNull();
    fireEvent.click(screen.getByTestId('itinerary-no-hotel'));
    fireEvent.change(flight(), { target: { value: '1' } });
    fireEvent.click(screen.getByTestId('booking-done'));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      itinerary: {
        one_way: true,
        flights: [{ leg: 'outbound', flight_no: 'AC99', date: START, departs: '09:00' }],
        no_hotel: true,
      },
    })));
  });

  it('adds a stay starting where the last ended, and removes it', () => {
    renderForm();
    fireEvent.click(screen.getByTestId('stay-add'));
    expect(screen.getByTestId('stay-1')).toBeTruthy();
    // The first stay already ends on the trip's last day, so the new one has no check-out yet.
    expect((screen.getByTestId('stays-1-check_out').querySelector('input') as HTMLInputElement).value).toBe('');
    expect(screen.getByText('Stay 2')).toBeTruthy();
    fireEvent.click(screen.getByTestId('stay-1-remove'));
    expect(screen.queryByTestId('stay-1')).toBeNull();
  });

  it('no hotel hides the stays and makes the total 0', () => {
    renderForm();
    type('stays-0-cost', '5');
    expect(total()).toContain('5');
    fireEvent.click(screen.getByTestId('itinerary-no-hotel'));
    expect(total()).toContain('0');
    expect(screen.queryByTestId('stay-0')).toBeNull();
  });

  it('carries an old one-stay hotel total into that stay', () => {
    renderForm({ ...empty, transport: 'flight', hotelCostRials: 700, itinerary: { stays: [{ name: 'Zand' }] } });
    expect((screen.getByTestId('stays-0-cost') as HTMLInputElement).value).toBe('700');
  });

  it('refuses an invalid amount', () => {
    renderForm();
    fireEvent.click(screen.getByLabelText('Flight'));
    fireEvent.change(flight(), { target: { value: '12.5' } });
    fireEvent.click(screen.getByTestId('booking-done'));
    expect(screen.getByRole('alert').textContent).toBe('Enter whole Rials, 0 or more.');
  });

  it('saves a draft without marking done', async () => {
    renderForm();
    fireEvent.click(screen.getByLabelText('Flight'));
    fireEvent.click(screen.getByTestId('booking-save'));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      transport: 'flight', flightCostRials: null, hotelCostRials: null, done: false,
    })));
  });

  it('a finished booking only offers saving changes, which keeps it finished', async () => {
    renderForm({
      ...empty, transport: 'company_car', flightCostRials: 0, hotelCostRials: 2_000_000, note: 'Hotel Zand', done: true,
      itinerary: { stays: [{ name: 'Zand', check_in: START, check_out: END, cost_rials: 2_000_000 }] },
    });
    expect(screen.queryByTestId('booking-save')).toBeNull();
    fireEvent.click(screen.getByTestId('booking-done'));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ done: true, hotelCostRials: 2_000_000 })));
  });
});
