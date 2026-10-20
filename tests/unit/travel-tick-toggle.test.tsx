import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { TravelTickToggle } from '@/app/[locale]/(app)/manage/requests/TravelTickToggle';

const mocks = vi.hoisted(() => ({ set: vi.fn(), missing: vi.fn(), refresh: vi.fn() }));
vi.mock('@/lib/actions/travel', () => ({ setTravelBooking: mocks.set, getTravelMissingFields: mocks.missing }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

function renderToggle(props: { ticked: boolean; started: boolean }) {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TravelTickToggle requestId="r1" employeeId="emp-1" {...props} />
    </NextIntlClientProvider>
  );
  return screen.getByTestId('travel-tick-r1') as HTMLInputElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.set.mockResolvedValue({ ok: true });
  mocks.missing.mockResolvedValue({ ok: true, fields: [] });
});
afterEach(cleanup);

describe('Requests page travel-booking switch (FR-70)', () => {
  it('ticks an approved trip and shows missing traveller details afterwards', async () => {
    mocks.missing.mockResolvedValue({ ok: true, fields: ['birth_date', 'mobile'] });
    const box = renderToggle({ ticked: false, started: false });
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    await waitFor(() => expect(screen.getByTestId('travel-missing-r1').textContent).toContain('Date of birth'));
    expect(mocks.set).toHaveBeenCalledWith('r1', true);
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('unticks without asking for missing details', async () => {
    const box = renderToggle({ ticked: true, started: false });
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    await waitFor(() => expect(mocks.set).toHaveBeenCalledWith('r1', false));
    expect(mocks.missing).not.toHaveBeenCalled();
  });

  it('is locked once procurement has started', () => {
    const box = renderToggle({ ticked: true, started: true });
    expect(box.disabled).toBe(true);
    expect(screen.getByText('Procurement has started booking. Cancel the trip instead.')).toBeTruthy();
  });

  it('shows the error and keeps the old state when saving fails', async () => {
    mocks.set.mockResolvedValue({ ok: false, error: 'This trip has already ended.' });
    const box = renderToggle({ ticked: false, started: false });
    fireEvent.click(box);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('This trip has already ended.'));
    expect(box.checked).toBe(false);
  });
});
