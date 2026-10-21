import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { SettleForm } from '@/app/[locale]/(app)/procurement/[id]/SettleForm';

const mocks = vi.hoisted(() => ({ settle: vi.fn(), refresh: vi.fn() }));
vi.mock('@/lib/actions/travel', () => ({ settleTravelBooking: mocks.settle }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

const renderForm = () => render(<NextIntlClientProvider locale="en" messages={en}><SettleForm requestId="r1" /></NextIntlClientProvider>);
beforeEach(() => { vi.clearAllMocks(); mocks.settle.mockResolvedValue({ ok: true }); });
afterEach(cleanup);

describe('settle a cancelled booking (FR-70)', () => {
  it('"Nothing was booked" settles with 0', async () => {
    renderForm();
    fireEvent.click(screen.getByTestId('settle-nothing'));
    await waitFor(() => expect(mocks.settle).toHaveBeenCalledWith({ requestId: 'r1', lostRials: 0, note: '' }));
  });

  it('records the amount lost with a note', async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText('Amount lost (Rials)'), { target: { value: '400,000' } });
    fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: 'Hotel kept one night' } });
    fireEvent.click(screen.getByTestId('settle-submit'));
    await waitFor(() => expect(mocks.settle).toHaveBeenCalledWith({ requestId: 'r1', lostRials: 400000, note: 'Hotel kept one night' }));
  });

  it('needs an amount', () => {
    renderForm();
    fireEvent.click(screen.getByTestId('settle-submit'));
    expect(screen.getByRole('alert').textContent).toBe('Enter whole Rials, 0 or more.');
    expect(mocks.settle).not.toHaveBeenCalled();
  });
});
