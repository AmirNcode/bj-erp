import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import fa from '@/messages/fa.json';
import { TravelTickToggle } from '@/app/[locale]/(app)/manage/requests/TravelTickToggle';
import { ApproveDialog, type ApproveOptions } from '@/app/[locale]/(app)/manage/approvals/DecisionDialogs';

// FR-70 review: the missing traveller fields are joined the locale's way
// (Intl.ListFormat), not with a hard-coded «، ».
const mocks = vi.hoisted(() => ({ set: vi.fn(), missing: vi.fn(), refresh: vi.fn() }));
vi.mock('@/lib/actions/travel', () => ({ setTravelBooking: mocks.set, getTravelMissingFields: mocks.missing }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/app/[locale]/(app)/request/_components/RequestSignature', () => ({ RequestSignatureFields: () => null }));

const FIELDS = ['national_id', 'birth_date', 'mobile'] as const;
const CASES = [
  { locale: 'en', messages: en, list: 'National ID, Date of birth, and Mobile' },
  { locale: 'fa', messages: fa, list: 'تاریخ تولد، و تلفن همراه' },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.set.mockResolvedValue({ ok: true });
  mocks.missing.mockResolvedValue({ ok: true, fields: [...FIELDS] });
});
afterEach(cleanup);

describe.each(CASES)('missing traveller fields in $locale', ({ locale, messages, list }) => {
  it('Requests page switch joins them with the locale list format', async () => {
    render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <TravelTickToggle requestId="r1" employeeId="emp-1" ticked={false} started={false} />
      </NextIntlClientProvider>
    );
    fireEvent.click(screen.getByTestId('travel-tick-r1'));
    await waitFor(() => expect(screen.getByTestId('travel-missing-r1').textContent).toContain(list));
  });

  it('HR approve dialog joins them with the locale list format', () => {
    const options: ApproveOptions = {
      hasNaturalStep: true, canOverride: false, perDiemNatural: true, perDiemOverride: false,
      steps: [{ stepId: 'hr-step', stepRole: 'hr', label: 'hr', name: null, principalName: null, delegated: false, perDiem: true }],
      travel: { employeeId: 'emp-1', missingFields: [...FIELDS] },
    };
    const labels = { approve: 'Approve', approveConfirm: '?', approverSignature: {} } as never;
    render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <ApproveDialog id="r1" labels={labels} disabled={false} onApprove={vi.fn()} options={options} />
      </NextIntlClientProvider>
    );
    fireEvent.click(screen.getByTestId('approve-btn-r1'));
    fireEvent.click(screen.getByTestId('travel-booking-r1'));
    expect(screen.getByTestId('travel-missing-r1').textContent).toContain(list);
  });
});
