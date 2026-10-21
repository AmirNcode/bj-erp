import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { RequestsReview } from '@/app/[locale]/(app)/manage/requests/RequestsReview';
import type { ReviewRequestRow } from '@/lib/actions/leave/review';

vi.mock('@/app/[locale]/(app)/manage/requests/TravelTickToggle', () => ({ TravelTickToggle: ({ requestId }: { requestId: string }) => <span data-testid={`tick-${requestId}`} /> }));
vi.mock('@/app/[locale]/(app)/request/_components/RequestCancelButton', () => ({ RequestCancelButton: ({ requestId }: { requestId: string }) => <span data-testid={`cancel-${requestId}`} /> }));
afterEach(cleanup);

const row = (id: string, over: Partial<ReviewRequestRow> = {}): ReviewRequestRow => ({
  id, employee_id: 'e', kind: 'errand', unit: 'day', status: 'approved', employee_name: 'Sara', personnel_no: null,
  department_name_fa: null, department_name_en: null, leave_type_name_fa: null, leave_type_name_en: null,
  start_date: '2099-03-01', end_date: '2099-03-02', start_time: null, end_time: null, day_part: 'full',
  requested_minutes: 960, serial_year: 1405, serial_seq: 1, signature_consent_at: null, approver_signature_consent_at: null,
  created_at: '2026-10-01T00:00:00Z', ...over,
});

describe('Requests page: travel trips (FR-70)', () => {
  it('HR can cancel a ticked travel trip from the row; other rows get no cancel', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <RequestsReview requests={[row('t1'), row('p1')]} locale="en" hoursPerDay={8} travelTicks={{ t1: { started: true } }} />
      </NextIntlClientProvider>
    );
    expect(screen.getByTestId('cancel-t1')).toBeTruthy();
    expect(screen.queryByTestId('cancel-p1')).toBeNull();
    expect(screen.getByTestId('tick-t1')).toBeTruthy();
    expect(screen.getByTestId('tick-p1')).toBeTruthy();
  });

  it('on the viewer\'s own request there is neither switch nor cancel', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <RequestsReview requests={[row('own', { employee_id: 'me' }), row('other')]} locale="en" hoursPerDay={8}
          travelTicks={{ own: { started: true }, other: { started: true } }} viewerId="me" />
      </NextIntlClientProvider>
    );
    expect(screen.queryByTestId('tick-own')).toBeNull();
    expect(screen.queryByTestId('cancel-own')).toBeNull();
    expect(screen.getByTestId('tick-other')).toBeTruthy();
    expect(screen.getByTestId('cancel-other')).toBeTruthy();
  });

  it('without tick rights there is neither switch nor cancel', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <RequestsReview requests={[row('t1')]} locale="en" hoursPerDay={8} travelTicks={null} />
      </NextIntlClientProvider>
    );
    expect(screen.queryByTestId('cancel-t1')).toBeNull();
    expect(screen.queryByTestId('tick-t1')).toBeNull();
  });
});
