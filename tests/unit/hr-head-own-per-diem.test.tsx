import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isCallerHrHead } from '@/lib/actions/approval-delegation';
import { submitDailyErrandRequest, submitErrandRequest, type LeaveRequestWithType } from '@/lib/actions/leave/requests';
import { MyRequestsList } from '@/app/[locale]/(app)/request/MyRequestsList';
import en from '@/messages/en.json';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), caller: vi.fn() }));
vi.mock('@/lib/auth/context', () => ({ requireCaller: mocks.caller }));
vi.mock('@/lib/cache/invalidate-app', () => ({ invalidateAppCache: vi.fn() }));
vi.mock('@/lib/errors/db-error', () => ({ dbErr: async (error: string) => ({ ok: false, error }) }));
vi.mock('@/components/RequestProgress', () => ({ RequestProgress: () => null }));
vi.mock('@/app/[locale]/(app)/request/_components/RequestCancelButton', () => ({ RequestCancelButton: () => null }));
vi.mock('@/app/[locale]/(app)/request/_components/RequestSignature', () => ({ RequestSignatureViewer: () => null }));

const signatureData = 'data:image/png;base64,iVBORw0KGgo' + 'A'.repeat(89);
const base = {
  location: 'Bandar Abbas',
  signatureData,
  signatureAuthorized: true,
  autoApprovalConsent: false,
  delegationPreview: { preview_token: 'token' },
  temporaryCeoAuthorized: false,
} as const;
const hourly = { ...base, date: '2027-02-01', startTime: '08:00', endTime: '09:00' };
const daily = { ...base, start: '2027-02-02', end: '2027-02-03' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.caller.mockResolvedValue({ ok: true, supabase: { rpc: mocks.rpc } });
  mocks.rpc.mockResolvedValue({ data: 'request-id', error: null });
});
afterEach(cleanup);

describe('Head of HR own per diem: submit actions', () => {
  it('sends the amount with the daily errand form', async () => {
    expect(await submitDailyErrandRequest({ ...daily, perDiemRials: 1_500_000 })).toEqual({ ok: true, requestId: 'request-id' });
    expect(mocks.rpc).toHaveBeenLastCalledWith('submit_daily_errand_request_v2', expect.objectContaining({ p_per_diem_rials: 1_500_000 }));
    await submitDailyErrandRequest({ ...daily, perDiemRials: 0 });
    expect(mocks.rpc).toHaveBeenLastCalledWith('submit_daily_errand_request_v2', expect.objectContaining({ p_per_diem_rials: 0 }));
  });

  it('omits the parameter when no amount is entered', async () => {
    await submitDailyErrandRequest({ ...daily, perDiemRials: null });
    expect(mocks.rpc.mock.calls[0][1].p_per_diem_rials).toBeUndefined();
  });

  it('never sends a per diem with an hourly errand (daily errands only)', async () => {
    expect(await submitErrandRequest(hourly)).toEqual({ ok: true, requestId: 'request-id' });
    expect(mocks.rpc).toHaveBeenLastCalledWith('submit_errand_request_v2', expect.not.objectContaining({ p_per_diem_rials: expect.anything() }));
  });

  it('refuses negative and fractional amounts before calling the database', async () => {
    expect(await submitDailyErrandRequest({ ...daily, perDiemRials: -1 })).toEqual({ ok: false, error: 'per diem must be 0 or more' });
    expect(await submitDailyErrandRequest({ ...daily, perDiemRials: 1.5 })).toEqual({ ok: false, error: 'per diem must be 0 or more' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('Head of HR ticks their own travel booking (FR-70)', () => {
  it('ticks the new request right after submission', async () => {
    expect(await submitDailyErrandRequest({ ...daily, travelBooking: true })).toEqual({ ok: true, requestId: 'request-id' });
    expect(mocks.rpc).toHaveBeenLastCalledWith('app_set_travel_booking', { p_request: 'request-id', p_on: true });
  });

  it('does not tick when the box is off', async () => {
    await submitDailyErrandRequest({ ...daily, travelBooking: false });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenLastCalledWith('submit_daily_errand_request_v2', expect.anything());
  });

  it('keeps the request and warns when the tick fails', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: 'request-id', error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'not allowed to mark travel booking' } });
    expect(await submitDailyErrandRequest({ ...daily, travelBooking: true }))
      .toEqual({ ok: true, requestId: 'request-id', warning: 'own travel booking not saved' });
  });
});

describe('isCallerHrHead', () => {
  it('is true only when the caller is the designated HR head', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { principal_id: 'me', executive_settings: { hr_head_id: 'me' } }, error: null });
    expect(await isCallerHrHead()).toBe(true);
    mocks.rpc.mockResolvedValueOnce({ data: { principal_id: 'me', executive_settings: { hr_head_id: 'someone' } }, error: null });
    expect(await isCallerHrHead()).toBe(false);
    mocks.rpc.mockResolvedValueOnce({ data: { principal_id: 'me', executive_settings: {} }, error: null });
    expect(await isCallerHrHead()).toBe(false);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'not authenticated' } });
    expect(await isCallerHrHead()).toBe(false);
  });
});

describe('MyRequestsList per diem line', () => {
  const messages = {
    ...en,
    request: { ...en.request, showPrevious: '{count} previous' },
    errand: { ...en.errand, perDiem: 'Per diem (Rials)', perDiemByRequester: 'Entered by requester (Head of HR)' },
  };
  const errand = (id: string, perDiem: number | null, byRequester: boolean) => ({
    id, status: 'pending', kind: 'errand', errand_location: 'Port', per_diem_rials: perDiem,
    per_diem_by_requester: byRequester, start_date: '2027-02-01', end_date: '2027-02-01', day_part: 'full',
    unit: 'hour', start_time: '08:00', end_time: '09:00', requested_minutes: 60, unpaid_minutes: 0,
    serial_year: 1405, serial_seq: 1, reason: null, decision_note: null, signature_consent_at: null,
    approver_signature_consent_at: null, created_at: '2027-01-30T10:00:00Z', replacement_name: null, leave_types: null,
  }) as unknown as LeaveRequestWithType;

  it('shows the amount, and the requester marker only when the Head of HR entered it', () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <MyRequestsList
          requests={[errand('self', 1_500_000, true), errand('hr', 900, false), errand('none', null, false)]}
          locale="en" hoursPerDay={8} showAll
        />
      </NextIntlClientProvider>
    );
    expect(screen.getByTestId('per-diem-self').textContent).toBe('Per diem (Rials): 1,500,000 · Entered by requester (Head of HR)');
    expect(screen.getByTestId('per-diem-hr').textContent).toBe('Per diem (Rials): 900');
    expect(screen.queryByTestId('per-diem-none')).toBeNull();
  });
});
