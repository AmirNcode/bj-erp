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
const mgrStep = { stepId: 'mgr-step', stepRole: 'manager', label: 'manager', name: null, principalName: null, delegated: false, perDiem: false } as const;
const hrStep = { stepId: 'hr-step', stepRole: 'hr', label: 'hr', name: null, principalName: null, delegated: false, perDiem: true } as const;
const namedStep = { stepId: 'named-step', stepRole: 'employee', label: 'employee', name: 'Procurement', principalName: 'Pat', delegated: true, perDiem: false } as const;

function renderDialog(options: ApproveOptions, onApprove = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ApproveDialog id="r1" labels={labels} disabled={false} onApprove={onApprove} options={options} />
    </NextIntlClientProvider>
  );
  fireEvent.click(screen.getByTestId('approve-btn-r1'));
  return onApprove;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.caller.mockResolvedValue({ ok: true, supabase: { rpc: mocks.rpc } });
  mocks.rpc.mockResolvedValue({ data: null, error: null });
});
afterEach(cleanup);

const base: ApproveOptions = { hasNaturalStep: true, canOverride: false, perDiemNatural: false, perDiemOverride: false };

describe('ApproveDialog: one signature for several steps (FR-71)', () => {
  it('lists every step and sends all their ids', () => {
    const onApprove = renderDialog({ ...base, steps: [mgrStep, hrStep, namedStep] });
    const list = screen.getByTestId('approve-steps-r1').textContent ?? '';
    expect(list).toContain('Signing as:');
    expect(list).toContain('Procurement · On behalf of Pat');
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByTestId('per-diem-r1')).toBeTruthy();
    fireEvent.click(screen.getByTestId('approve-confirm-r1'));
    expect(onApprove.mock.calls[0][2].stepIds).toEqual(['mgr-step', 'hr-step', 'named-step']);
  });

  it('no per diem field without an HR step', () => {
    renderDialog({ ...base, steps: [mgrStep] });
    expect(screen.queryByTestId('per-diem-r1')).toBeNull();
  });
});

describe('approveRequest (FR-71)', () => {
  it('several steps go in one call', async () => {
    expect(await approveRequest('req-1', { signatureData, signatureAuthorized: true, stepIds: ['mgr-step', 'hr-step'], perDiemRials: 5 })).toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('approve_leave_request_steps', {
      p_id: 'req-1', p_step_ids: ['mgr-step', 'hr-step'], p_signature_data: signatureData,
      p_signature_authorized: true, p_per_diem_rials: 5,
    });
  });

  it('the admin override keeps the single-call path', async () => {
    await approveRequest('req-1', { signatureData, signatureAuthorized: true, override: true, stepIds: [] });
    expect(mocks.rpc.mock.calls[0][0]).toBe('approve_leave_request_v2');
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_override: true, p_step_id: null });
  });
});
