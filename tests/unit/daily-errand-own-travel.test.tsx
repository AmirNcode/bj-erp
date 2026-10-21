import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { DailyErrandRequestForm } from '@/app/[locale]/(app)/request/daily-errand/DailyErrandRequestForm';
import { WORK_SETTINGS_FALLBACK } from '@/lib/leave/workSettings';

// FR-70 (owner, 2026-10-20): only the Head of HR sees «نیاز به رزرو سفر» on their own
// daily errand form, and the form sends it with the request.
const mocks = vi.hoisted(() => ({ submitDaily: vi.fn() }));
vi.mock('@/lib/actions/leave/requests', () => ({ submitDailyErrandRequest: mocks.submitDaily }));
vi.mock('@/app/[locale]/(app)/request/_components/RequestDelegationFields', () => ({ RequestDelegationFields: () => null }));
vi.mock('@/app/[locale]/(app)/request/_components/RequestSignature', () => ({ RequestSignatureFields: () => null }));
vi.mock('@/app/[locale]/(app)/request/_components/useRequestForm', () => ({
  useRequestDelegation: () => ({ problem: () => null, submission: {} }),
  useSignature: () => ({ data: 'sig', authorized: true, fieldProps: {}, problem: () => null, reset: () => {} }),
  // Skips form validation (no dates picked here): this test is about the travel flag only.
  useRequestSubmit: () => ({ success: '', error: '', isPending: false, submit: (_p: unknown, send: () => unknown) => send() }),
}));

function renderForm(isHrHead: boolean) {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <DailyErrandRequestForm workSettings={WORK_SETTINGS_FALLBACK as never} locale="en" perDiemAllowed={isHrHead} />
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.submitDaily.mockResolvedValue({ ok: true, requestId: 'r1' });
});
afterEach(cleanup);

describe('Daily errand form: Head of HR ticks their own travel booking', () => {
  it('is hidden from everyone else', () => {
    renderForm(false);
    expect(screen.queryByTestId('daily-errand-travel-booking')).toBeNull();
  });

  it('is offered, off by default, to the Head of HR and sent with the request', () => {
    renderForm(true);
    const box = screen.getByTestId('daily-errand-travel-booking') as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(screen.getByText(en.travel.ownTickHint)).toBeTruthy();
    fireEvent.click(box);
    fireEvent.submit(screen.getByTestId('daily-errand-form'));
    expect(mocks.submitDaily).toHaveBeenCalledWith(expect.objectContaining({ travelBooking: true }));
  });
});
