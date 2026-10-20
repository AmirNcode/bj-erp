import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { gregorianToPersianDateObject } from '@/lib/leave/dateConvert';
import { ExtendTripDialog } from '@/app/[locale]/(app)/manage/approvals/ExtendTripDialog';
import { ExtensionDecisionCard } from '@/app/[locale]/(app)/manage/approvals/ExtensionDecisionCard';

const mocks = vi.hoisted(() => ({ request: vi.fn(), decide: vi.fn(), refresh: vi.fn() }));
vi.mock('@/lib/actions/travel', () => ({ requestExtension: mocks.request, decideExtension: mocks.decide }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/components/PersianDateField', () => ({
  PersianDateField: ({ id, onChange }: { id?: string; onChange: (v: unknown) => void }) => (
    <input id={id} data-testid="date-input" onChange={(e) => onChange(gregorianToPersianDateObject(e.target.value, 'en'))} />
  ),
}));
vi.mock('@/app/[locale]/(app)/request/_components/RequestSignature', () => ({
  RequestSignatureFields: ({ onChange, onAuthorizedChange }: { onChange: (v: string) => void; onAuthorizedChange: (v: boolean) => void }) => {
    useEffect(() => { onChange('data:image/png;base64,sig'); onAuthorizedChange(true); }, [onChange, onAuthorizedChange]);
    return null;
  },
}));

const wrap = (ui: React.ReactNode) => render(<NextIntlClientProvider locale="en" messages={en}>{ui}</NextIntlClientProvider>);
const trip = { request_id: 'r1', serial_year: 1405, serial_seq: 7, employee_name: 'Sara', errand_location: 'Shiraz',
  start_date: '2027-03-01', end_date: '2027-03-03', pending_extension: false, delegation_uncovered: false };
const ext = { extension_id: 'x1', request_id: 'r1', serial_year: 1405, serial_seq: 7, employee_name: 'Sara',
  errand_location: 'Shiraz', start_date: '2027-03-01', old_end_date: '2027-03-03', new_end_date: '2027-03-05',
  reason: 'More inspections', requested_by_name: 'Manager', per_diem_rials: 600000, delegation_uncovered: false };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.request.mockResolvedValue({ ok: true });
  mocks.decide.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe('ExtendTripDialog (FR-70)', () => {
  const open = () => { wrap(<ExtendTripDialog trip={trip} locale="en" />); fireEvent.click(screen.getByTestId('extend-open-r1')); };

  it('refuses a new end date that is not after the current one', () => {
    open();
    fireEvent.change(screen.getByTestId('date-input'), { target: { value: '2027-03-03' } });
    fireEvent.change(screen.getByLabelText('Reason for the extension'), { target: { value: 'More work' } });
    fireEvent.click(screen.getByTestId('extend-submit-r1'));
    expect(screen.getByRole('alert').textContent).toBe('Choose a date after the current end date.');
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('requires a reason', () => {
    open();
    fireEvent.change(screen.getByTestId('date-input'), { target: { value: '2027-03-05' } });
    fireEvent.change(screen.getByLabelText('Reason for the extension'), { target: { value: '   ' } });
    fireEvent.click(screen.getByTestId('extend-submit-r1'));
    expect(screen.getByRole('alert').textContent).toBe('Write why the trip needs to be extended.');
  });

  it('sends the ISO date and trimmed reason', async () => {
    open();
    fireEvent.change(screen.getByTestId('date-input'), { target: { value: '2027-03-05' } });
    fireEvent.change(screen.getByLabelText('Reason for the extension'), { target: { value: '  More inspections ' } });
    fireEvent.click(screen.getByTestId('extend-submit-r1'));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith({ requestId: 'r1', newEndDate: '2027-03-05', reason: 'More inspections' }));
  });

  it('warns the manager when the trip\'s approval delegation will not cover the extra days', () => {
    wrap(<ExtendTripDialog trip={{ ...trip, delegation_uncovered: true }} locale="en" />);
    fireEvent.click(screen.getByTestId('extend-open-r1'));
    expect(screen.getByTestId('extend-delegation-r1').textContent).toContain('does not cover the extra days');
  });

  it('is disabled while an extension waits for HR', () => {
    wrap(<ExtendTripDialog trip={{ ...trip, pending_extension: true }} locale="en" />);
    expect((screen.getByTestId('extend-open-r1') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('ExtensionDecisionCard (FR-70)', () => {
  it('shows the reason and dates, and approves with signature and per diem', async () => {
    wrap(<ExtensionDecisionCard ext={ext} locale="en" />);
    expect(screen.getByTestId('extension-x1').textContent).toContain('More inspections');
    expect(screen.queryByTestId('extension-delegation-x1')).toBeNull();
    fireEvent.click(screen.getByTestId('extension-approve-open-x1'));
    fireEvent.change(screen.getByLabelText('Per diem (Rials)'), { target: { value: '900,000' } });
    fireEvent.click(screen.getByTestId('extension-approve-x1'));
    await waitFor(() => expect(mocks.decide).toHaveBeenCalledWith({
      extensionId: 'x1', approve: true, signatureData: 'data:image/png;base64,sig', signatureAuthorized: true,
      perDiemRials: 900000, note: '',
    }));
  });

  it('warns when the traveller handed their approvals to someone for this trip', () => {
    wrap(<ExtensionDecisionCard ext={{ ...ext, delegation_uncovered: true }} locale="en" />);
    expect(screen.getByTestId('extension-delegation-x1').textContent).toContain('does not cover the extra days');
  });

  it('rejects with a note', async () => {
    wrap(<ExtensionDecisionCard ext={ext} locale="en" />);
    fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: 'Not justified' } });
    fireEvent.click(screen.getByTestId('extension-reject-x1'));
    await waitFor(() => expect(mocks.decide).toHaveBeenCalledWith(expect.objectContaining({ extensionId: 'x1', approve: false, note: 'Not justified' })));
  });
});
