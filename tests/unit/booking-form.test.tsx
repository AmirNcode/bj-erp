import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { BookingForm } from '@/app/[locale]/(app)/procurement/[id]/BookingForm';

const mocks = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn() }));
vi.mock('@/lib/actions/travel', () => ({ saveTravelBooking: mocks.save }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

type Initial = Parameters<typeof BookingForm>[0]['initial'];
const empty: Initial = { transport: null, flightCostRials: null, hotelCostRials: null, note: null, done: false };

function renderForm(initial: Initial = empty) {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <BookingForm requestId="r1" initial={initial} />
    </NextIntlClientProvider>
  );
}
const flight = () => screen.getByLabelText('Ticket cost (Rials)') as HTMLInputElement;
const hotel = () => screen.getByLabelText('Hotel cost (Rials)') as HTMLInputElement;

beforeEach(() => { vi.clearAllMocks(); mocks.save.mockResolvedValue({ ok: true }); });
afterEach(cleanup);

describe('procurement booking form (FR-70)', () => {
  it('marking done needs a transport and both costs', async () => {
    renderForm();
    fireEvent.click(screen.getByTestId('booking-done'));
    expect(screen.getByRole('alert').textContent).toBe('Choose the transport and enter both costs (0 if none).');
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('company car sets the ticket cost to 0 and locks it', () => {
    renderForm();
    fireEvent.change(flight(), { target: { value: '5000000' } });
    fireEvent.click(screen.getByLabelText('Company car'));
    expect(flight().value).toBe('0');
    expect(flight().disabled).toBe(true);
  });

  it('a saved company-car draft with no ticket cost can still be marked done (cost 0)', async () => {
    renderForm({ transport: 'company_car', flightCostRials: null, hotelCostRials: null, note: null, done: false });
    expect(flight().value).toBe('0');
    fireEvent.change(hotel(), { target: { value: '1000000' } });
    fireEvent.click(screen.getByTestId('booking-done'));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ transport: 'company_car', flightCostRials: 0, hotelCostRials: 1_000_000, done: true })));
  });

  it('parses Rials (Persian digits, separators) and marks done', async () => {
    renderForm();
    fireEvent.click(screen.getByLabelText('Flight'));
    fireEvent.change(flight(), { target: { value: '۵٬۰۰۰٬۰۰۰' } });
    fireEvent.change(hotel(), { target: { value: '2,000,000' } });
    fireEvent.change(screen.getByLabelText('Note for the traveller'), { target: { value: 'IR452 08:00, Hotel Zand' } });
    fireEvent.click(screen.getByTestId('booking-done'));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({
      requestId: 'r1', transport: 'flight', flightCostRials: 5_000_000, hotelCostRials: 2_000_000,
      note: 'IR452 08:00, Hotel Zand', done: true,
    }));
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('refuses an invalid amount', () => {
    renderForm();
    fireEvent.click(screen.getByLabelText('Flight'));
    fireEvent.change(flight(), { target: { value: '12.5' } });
    fireEvent.change(hotel(), { target: { value: '0' } });
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
    renderForm({ transport: 'company_car', flightCostRials: 0, hotelCostRials: 2_000_000, note: 'Hotel Zand', done: true });
    expect(screen.queryByTestId('booking-save')).toBeNull();
    fireEvent.click(screen.getByTestId('booking-done'));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ done: true, hotelCostRials: 2_000_000 })));
  });
});
