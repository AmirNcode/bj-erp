import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { gregorianToPersianDateObject } from '@/lib/leave/dateConvert';
import { EditRequestDialog } from '@/app/[locale]/(app)/manage/requests/EditRequestDialog';
import type { ReviewActionRequest } from '@/app/[locale]/(app)/manage/requests/RequestReviewActions';

const mocks = vi.hoisted(() => ({ edit: vi.fn(), refresh: vi.fn() }));
vi.mock('@/lib/actions/leave/edit', () => ({ editRequest: mocks.edit }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/components/PersianDateField', () => ({
  PersianDateField: ({ id, onChange }: { id?: string; onChange: (v: unknown) => void }) => (
    <input id={id} data-testid={id} onChange={(e) => onChange(gregorianToPersianDateObject(e.target.value, 'en'))} />
  ),
}));
vi.mock('@/app/[locale]/(app)/request/_components/RequestSignature', () => ({
  RequestSignatureFields: ({ onChange, onAuthorizedChange }: { onChange: (v: string) => void; onAuthorizedChange: (v: boolean) => void }) => {
    useEffect(() => { onChange('data:image/png;base64,sig'); onAuthorizedChange(true); }, [onChange, onAuthorizedChange]);
    return null;
  },
}));

const window_ = { start: '07:00', end: '15:00' };
const leave: ReviewActionRequest = {
  id: 'r1', employee_id: 'e', kind: 'leave', unit: 'day', status: 'approved', start_date: '2027-03-01', end_date: '2027-03-03',
  start_time: null, end_time: null, day_part: 'full', per_diem_rials: null,
};
const trip: ReviewActionRequest = { ...leave, kind: 'errand', per_diem_rials: 1000000 };
const errand: ReviewActionRequest = { ...leave, kind: 'errand', unit: 'hour', start_date: '2027-03-01', end_date: '2027-03-01', start_time: '09:00:00', end_time: '10:00:00' };

function open(request: ReviewActionRequest, units: ('day' | 'hour')[]) {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <EditRequestDialog request={request} units={units} locale="en" workWindow={window_} />
    </NextIntlClientProvider>
  );
  fireEvent.click(screen.getByTestId(`edit-request-${request.id}`));
}
const type = (id: string, value: string) => fireEvent.change(screen.getByTestId(id), { target: { value } });
const submit = () => screen.getByTestId('edit-submit') as HTMLButtonElement;
const reasonField = () => screen.getByLabelText('Reason for the edit');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.edit.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe('EditRequestDialog (FR-91)', () => {
  it('an hourly errand can be moved outside working hours; hourly leave cannot', () => {
    open(errand, ['hour']);
    const opts = (id: string) => Array.from((screen.getByTestId(id) as HTMLSelectElement).options).map((o) => o.value);
    expect(opts('edit-time-r1-from')).toContain('18:00');
    expect(opts('edit-time-r1-to')).toContain('18:00');
    cleanup();
    open({ ...errand, kind: 'leave' }, ['hour']);
    expect(opts('edit-time-r1-from')).not.toContain('18:00');
    expect(opts('edit-time-r1-from')).toContain('07:00');
  });

  it('a daily leave with only the daily key: dates, no switch, no per diem, no times', () => {
    open(leave, ['day']);
    expect(screen.queryByTestId('edit-unit')).toBeNull();
    expect(screen.getByTestId('edit-start-r1')).toBeTruthy();
    expect(screen.getByTestId('edit-end-r1')).toBeTruthy();
    expect(screen.queryByTestId('edit-per-diem')).toBeNull();
    expect(screen.queryByTestId('edit-time-r1_from')).toBeNull();
  });

  it('with both keys a Daily / Hourly switch appears; Hourly shows one date and two time fields, no day part', () => {
    open(leave, ['day', 'hour']);
    const group = screen.getByTestId('edit-unit');
    expect(within(group).getAllByRole('radio').map((b) => b.textContent)).toEqual(['Daily', 'Hourly']);
    fireEvent.click(screen.getByTestId('edit-unit-hour'));
    expect(screen.getByTestId('edit-date-r1')).toBeTruthy();
    expect(screen.queryByTestId('edit-start-r1')).toBeNull();
    expect(screen.getByTestId('edit-time-r1-from')).toBeTruthy();
    expect(screen.getByTestId('edit-time-r1-to')).toBeTruthy();
    expect(screen.queryByTestId('edit-day-part')).toBeNull();
  });

  it('offers the day part only for a single leave day', () => {
    open({ ...leave, end_date: '2027-03-01' }, ['day']);
    expect(screen.getByTestId('edit-day-part')).toBeTruthy();
  });

  it('a daily trip shows the per diem; an hourly errand does not', () => {
    open(trip, ['day']);
    expect((screen.getByTestId('edit-per-diem') as HTMLInputElement).value).toBe('1000000');
    cleanup();
    open(errand, ['hour']);
    expect(screen.queryByTestId('edit-per-diem')).toBeNull();
  });

  it('Save stays disabled until something changed, a reason is written and the signature is in', async () => {
    open(leave, ['day']);
    await waitFor(() => expect(submit().disabled).toBe(true)); // signature is in, nothing changed, no reason
    fireEvent.change(reasonField(), { target: { value: 'Shortened' } });
    expect(submit().disabled).toBe(true); // reason but nothing changed
    type('edit-end-r1', '2027-03-02');
    expect(submit().disabled).toBe(false);
    fireEvent.change(reasonField(), { target: { value: '   ' } });
    expect(submit().disabled).toBe(true);
  });

  it('sends the full target shape for a shortened daily leave', async () => {
    open(leave, ['day']);
    type('edit-end-r1', '2027-03-02');
    fireEvent.change(reasonField(), { target: { value: '  Shortened by one day ' } });
    fireEvent.click(submit());
    await waitFor(() => expect(mocks.edit).toHaveBeenCalledTimes(1));
    expect(mocks.edit).toHaveBeenCalledWith({
      requestId: 'r1', unit: 'day', start: '2027-03-01', end: '2027-03-02', dayPart: 'full', startTime: null, endTime: null,
      perDiemRials: null, reason: 'Shortened by one day', signatureData: 'data:image/png;base64,sig', signatureAuthorized: true,
    });
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  });

  it('sends a daily leave switched to hourly as one date with times and a full day part', async () => {
    open(leave, ['day', 'hour']);
    fireEvent.click(screen.getByTestId('edit-unit-hour'));
    type('edit-date-r1', '2027-03-02');
    fireEvent.change(screen.getByTestId('edit-time-r1-from'), { target: { value: '09:00' } });
    fireEvent.change(screen.getByTestId('edit-time-r1-to'), { target: { value: '11:00' } });
    fireEvent.change(reasonField(), { target: { value: 'Only two hours' } });
    fireEvent.click(submit());
    await waitFor(() => expect(mocks.edit).toHaveBeenCalledTimes(1));
    expect(mocks.edit).toHaveBeenCalledWith({
      requestId: 'r1', unit: 'hour', start: '2027-03-02', end: '2027-03-02', dayPart: 'full', startTime: '09:00', endTime: '11:00',
      perDiemRials: null, reason: 'Only two hours', signatureData: 'data:image/png;base64,sig', signatureAuthorized: true,
    });
  });

  it('sends a changed trip per diem; leaves it null when untouched', async () => {
    open(trip, ['day']);
    type('edit-end-r1', '2027-03-05');
    fireEvent.change(screen.getByTestId('edit-per-diem'), { target: { value: '2,500,000' } });
    fireEvent.change(reasonField(), { target: { value: 'Longer trip' } });
    fireEvent.click(submit());
    await waitFor(() => expect(mocks.edit).toHaveBeenCalledTimes(1));
    expect(mocks.edit.mock.calls[0][0]).toMatchObject({ unit: 'day', end: '2027-03-05', perDiemRials: 2500000 });
  });

  it('an end time not after the start time is refused before sending', async () => {
    open(errand, ['hour']);
    fireEvent.change(screen.getByTestId('edit-time-r1-to'), { target: { value: '08:00' } });
    fireEvent.change(reasonField(), { target: { value: 'Typo' } });
    fireEvent.click(submit());
    expect((await screen.findByRole('alert')).textContent).toBe('The end time must be after the start time.');
    expect(mocks.edit).not.toHaveBeenCalled();
  });

  it('shows the database refusal in the dialog and stays open', async () => {
    mocks.edit.mockResolvedValue({ ok: false, error: 'This change needs more leave than the balance holds.' });
    open(leave, ['day']);
    type('edit-end-r1', '2027-03-09');
    fireEvent.change(reasonField(), { target: { value: 'Longer' } });
    fireEvent.click(submit());
    expect((await screen.findByRole('alert')).textContent).toContain('needs more leave');
    expect(screen.getByTestId('edit-submit')).toBeTruthy();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
