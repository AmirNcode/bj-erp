import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { RequestsReview } from '@/app/[locale]/(app)/manage/requests/RequestsReview';
import type { ReviewRequestRow } from '@/lib/actions/leave/review';
import type { EditKey } from '@/lib/leave/requestEdit';

vi.mock('@/app/[locale]/(app)/manage/requests/TravelTickToggle', () => ({ TravelTickToggle: ({ requestId }: { requestId: string }) => <span data-testid={`tick-${requestId}`} /> }));
vi.mock('@/app/[locale]/(app)/manage/requests/EditRequestDialog', () => ({
  EditRequestDialog: ({ request, units }: { request: { id: string }; units: string[] }) => <span data-testid={`edit-${request.id}`} data-units={units.join(',')} />,
}));
vi.mock('@/app/[locale]/(app)/request/_components/RequestCancelButton', () => ({ RequestCancelButton: ({ requestId }: { requestId: string }) => <span data-testid={`cancel-${requestId}`} /> }));
afterEach(cleanup);

const row = (id: string, over: Partial<ReviewRequestRow> = {}): ReviewRequestRow => ({
  id, employee_id: 'e', kind: 'errand', unit: 'day', status: 'approved', employee_name: 'Sara', personnel_no: null,
  department_name_fa: null, department_name_en: null, leave_type_name_fa: null, leave_type_name_en: null,
  start_date: '2099-03-01', end_date: '2099-03-02', start_time: null, end_time: null, day_part: 'full',
  requested_minutes: 960, serial_year: 1405, serial_seq: 1, signature_consent_at: null, approver_signature_consent_at: null,
  created_at: '2026-10-01T00:00:00Z', ...over,
});

describe('Requests page: Edit (FR-91)', () => {
  const page = (rows: ReviewRequestRow[], editKeys?: EditKey[], viewerId = 'hr') =>
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <RequestsReview requests={rows} locale="en" hoursPerDay={8} viewerId={viewerId} editKeys={editKeys} />
      </NextIntlClientProvider>
    );

  it('offers Edit on an approved daily leave to a holder of edit_leave_daily', () => {
    page([row('a', { kind: 'leave' })], ['edit_leave_daily']);
    expect(screen.getByTestId('edit-a').getAttribute('data-units')).toBe('day');
  });

  it('offers the other unit only to a holder of both keys', () => {
    page([row('a', { kind: 'leave' })], ['edit_leave_daily', 'edit_leave_hourly']);
    expect(screen.getByTestId('edit-a').getAttribute('data-units')).toBe('day,hour');
  });

  it('offers nothing with no keys, or when the prop is omitted', () => {
    page([row('a', { kind: 'leave' })], []);
    expect(screen.queryByTestId('edit-a')).toBeNull();
    cleanup();
    page([row('a', { kind: 'leave' })]);
    expect(screen.queryByTestId('edit-a')).toBeNull();
  });

  it('does not offer a leave key on a trip, nor Edit on a pending row', () => {
    page([row('trip'), row('p', { kind: 'leave', status: 'pending' })], ['edit_leave_daily']);
    expect(screen.queryByTestId('edit-trip')).toBeNull();
    expect(screen.queryByTestId('edit-p')).toBeNull();
  });

  it('the viewer\'s own request needs edit_requests_own too', () => {
    page([row('own', { kind: 'leave', employee_id: 'hr' })], ['edit_leave_daily']);
    expect(screen.queryByTestId('edit-own')).toBeNull();
    cleanup();
    page([row('own', { kind: 'leave', employee_id: 'hr' })], ['edit_leave_daily', 'edit_requests_own']);
    expect(screen.getByTestId('edit-own')).toBeTruthy();
  });
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
