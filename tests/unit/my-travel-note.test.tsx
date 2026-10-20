import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { MyRequestsList } from '@/app/[locale]/(app)/request/MyRequestsList';
import type { LeaveRequestWithType } from '@/lib/actions/leave/requests';

vi.mock('@/components/RequestProgress', () => ({ RequestProgress: () => null }));
vi.mock('@/app/[locale]/(app)/request/_components/RequestCancelButton', () => ({ RequestCancelButton: () => null }));
vi.mock('@/app/[locale]/(app)/request/_components/RequestSignature', () => ({ RequestSignatureViewer: () => null }));
afterEach(cleanup);

const errand = {
  id: 'e1', status: 'pending', kind: 'errand', errand_location: 'Shiraz', start_date: '2027-03-10', end_date: '2027-03-12',
  day_part: 'full', unit: 'day', start_time: null, end_time: null, requested_minutes: 1440, unpaid_minutes: 0,
  serial_year: 1405, serial_seq: 7, reason: null, decision_note: null, signature_consent_at: null,
  approver_signature_consent_at: null, created_at: '2026-10-13T10:00:00Z', replacement_name: null, leave_types: null,
  per_diem_rials: null, per_diem_by_requester: false,
} as unknown as LeaveRequestWithType;
const labels = new Proxy({}, { get: (_t, k) => (k === 'dayPartLabels' ? { full: 'Full', am: 'AM', pm: 'PM' } : String(k)) }) as never;

describe('My Requests: travel booking note (FR-70)', () => {
  it('shows procurement transport and note on a booked trip, never costs', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <MyRequestsList requests={[errand]} labels={labels} locale="en" hoursPerDay={8}
          travelBookings={{ e1: { transport: 'flight', note: 'IR452 08:00, Hotel Zand' } }} />
      </NextIntlClientProvider>
    );
    const box = screen.getByTestId('travel-note-e1');
    expect(box.textContent).toContain('Transport: Flight');
    expect(box.textContent).toContain("Procurement's note: IR452 08:00, Hotel Zand");
  });
});
