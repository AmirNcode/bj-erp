import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { approveRequest } from '@/lib/actions/leave/approvals';
import { ApproveDialog, type ApproveOptions } from '@/app/[locale]/(app)/manage/approvals/DecisionDialogs';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), caller: vi.fn() }));
vi.mock('@/lib/auth/context', () => ({ requireCaller: mocks.caller }));
vi.mock('@/lib/cache/invalidate-app', () => ({ invalidateAppCache: vi.fn() }));
vi.mock('@/lib/errors/db-error', () => ({ dbErr: async (error: string) => ({ ok: false, error }) }));
vi.mock('@/app/[locale]/(app)/request/_components/RequestSignature', () => ({
  RequestSignatureFields: ({ onChange, onAuthorizedChange }: { onChange: (v: string) => void; onAuthorizedChange: (v: boolean) => void }) => {
    useEffect(() => { onChange('data:image/png;base64,sig'); onAuthorizedChange(true); }, [onChange, onAuthorizedChange]);
    return null;
  },
}));

const signatureData = 'data:image/png;base64,iVBORw0KGgo' + 'A'.repeat(89);
const labels = {
  approve: 'Approve', approveConfirm: 'Approve this request?',
  approverSignature: { validationSignature: 'Sign', validationAuthorization: 'Authorize' },
} as never;
const hrStep = { stepId: 'hr-step', label: 'hr', name: null, principalName: null, delegated: false, perDiem: true } as const;

function renderDialog(options: ApproveOptions, onApprove = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ApproveDialog id="r1" labels={labels} disabled={false} onApprove={onApprove} options={options} />
    </NextIntlClientProvider>
  );
  fireEvent.click(screen.getByTestId('approve-btn-r1'));
  return onApprove;
}
const base: ApproveOptions = { hasNaturalStep: true, canOverride: false, perDiemNatural: true, perDiemOverride: false, steps: [hrStep] };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.caller.mockResolvedValue({ ok: true, supabase: { rpc: mocks.rpc } });
  mocks.rpc.mockResolvedValue({ data: null, error: null });
});
afterEach(cleanup);

describe('HR step: needs travel booking (FR-70)', () => {
  it('offers the box, unchecked, on a daily errand at the hr step', () => {
    renderDialog({ ...base, travel: { employeeId: 'emp-1', missingFields: [] } });
    const box = screen.getByTestId('travel-booking-r1') as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(screen.getByText('Needs travel booking')).toBeTruthy();
  });

  it('warns about missing traveller details but still approves with the box ticked', () => {
    const onApprove = renderDialog({ ...base, travel: { employeeId: 'emp-1', missingFields: ['national_id'] } });
    expect(screen.queryByTestId('travel-missing-r1')).toBeNull();
    fireEvent.click(screen.getByTestId('travel-booking-r1'));
    const warning = screen.getByTestId('travel-missing-r1');
    expect(warning.textContent).toContain('National ID');
    expect(warning.querySelector('a')?.getAttribute('href')).toBe('/en/manage/employees/emp-1');
    fireEvent.click(screen.getByTestId('approve-confirm-r1'));
    expect(onApprove).toHaveBeenCalledWith(expect.any(String), true, expect.objectContaining({ travelBooking: true }));
  });

  it('sends travelBooking false when left unticked', () => {
    const onApprove = renderDialog({ ...base, travel: { employeeId: 'emp-1', missingFields: [] } });
    fireEvent.click(screen.getByTestId('approve-confirm-r1'));
    expect(onApprove).toHaveBeenCalledWith(expect.any(String), true, expect.objectContaining({ travelBooking: false }));
  });

  it('has no box when the request is not eligible', () => {
    renderDialog({ ...base, travel: null });
    expect(screen.queryByTestId('travel-booking-r1')).toBeNull();
  });
});

describe('approveRequest with travelBooking', () => {
  it('marks the booking after the approval succeeds', async () => {
    expect(await approveRequest('req-1', { signatureData, signatureAuthorized: true, stepId: 'hr-step', travelBooking: true })).toEqual({ ok: true });
    expect(mocks.rpc.mock.calls.map((c) => c[0])).toEqual(['approve_leave_request_v2', 'app_set_travel_booking']);
    expect(mocks.rpc).toHaveBeenLastCalledWith('app_set_travel_booking', { p_request: 'req-1', p_on: true });
  });

  it('does not mark the booking when the approval fails', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'not allowed' } });
    expect(await approveRequest('req-1', { signatureData, signatureAuthorized: true, travelBooking: true })).toEqual({ ok: false, error: 'not allowed' });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('reports a failed mark after a saved approval', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: null, error: { message: 'trip has already ended' } });
    // The approval is saved: report success with a warning, not a failure.
    expect(await approveRequest('req-1', { signatureData, signatureAuthorized: true, travelBooking: true })).toEqual({ ok: true, warning: 'travel booking not saved' });
  });
});
