import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { ApprovalStepsCard } from '@/app/[locale]/(app)/manage/approval-steps/ApprovalStepsCard';
import type { ApprovalStepRow } from '@/lib/actions/settings';

const mocks = vi.hoisted(() => ({ update: vi.fn(), enforce: vi.fn(), remove: vi.fn(), refresh: vi.fn() }));
vi.mock('@/lib/actions/settings', () => ({
  updateApprovalStep: mocks.update,
  setApprovalOrderEnforced: mocks.enforce,
  deleteApprovalStep: mocks.remove,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/app/[locale]/(app)/manage/approval-steps/AddApprovalStepDialog', () => ({
  AddApprovalStepDialog: () => null,
}));

const step = (over: Partial<ApprovalStepRow>): ApprovalStepRow =>
  ({ id: 's1', role: 'manager', approverId: null, approverName: null, approverInactive: false,
     managerScope: 'direct', stepOrder: 1, active: true, boxLabel: 'Manager', ...over }) as ApprovalStepRow;
const steps = [step({}), step({ id: 's2', role: 'hr', stepOrder: 2, boxLabel: 'HR' })];

function renderCard(props: Partial<Parameters<typeof ApprovalStepsCard>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ApprovalStepsCard steps={steps} orderEnforced={false} canEnforceOrder {...props} />
    </NextIntlClientProvider>
  );
}
const saveButton = () => screen.getByTestId('approval-steps-save') as HTMLButtonElement;

beforeEach(() => {
  mocks.update.mockResolvedValue({ ok: true });
  mocks.enforce.mockResolvedValue({ ok: true });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('ApprovalStepsCard Save', () => {
  it('writes nothing until Save, which is disabled while nothing differs', () => {
    renderCard();
    expect(saveButton().disabled).toBe(true);

    fireEvent.change(screen.getByTestId('approval-step-order-hr'), { target: { value: '5' } });
    expect(saveButton().disabled).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();

    // Back to the stored value: nothing to save again.
    fireEvent.change(screen.getByTestId('approval-step-order-hr'), { target: { value: '2' } });
    expect(saveButton().disabled).toBe(true);
  });

  it('saves only the changed fields of the changed steps, then the order switch', async () => {
    renderCard();
    fireEvent.change(screen.getByTestId('approval-step-box-label-manager'), { target: { value: ' Line manager ' } });
    fireEvent.click(screen.getByTestId('approval-step-active-hr'));
    fireEvent.click(screen.getByTestId('approval-order-enforced'));
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.enforce).not.toHaveBeenCalled();

    fireEvent.click(saveButton());

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    expect(mocks.update.mock.calls.map((c) => c[0])).toEqual([
      { id: 's1', boxLabel: 'Line manager' },
      { id: 's2', active: false },
    ]);
    expect(mocks.enforce).toHaveBeenCalledWith(true);
  });

  it('stops at the first refusal, shows it and keeps the draft', async () => {
    mocks.update.mockResolvedValueOnce({ ok: false, error: 'approval step order must be between 1 and 99' });
    renderCard();
    fireEvent.change(screen.getByTestId('approval-step-order-manager'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('approval-order-enforced'));
    fireEvent.click(saveButton());

    await waitFor(() => expect(screen.getByTestId('approval-steps-error').textContent).toContain('between 1 and 99'));
    expect(mocks.update).toHaveBeenCalledWith({ id: 's1', stepOrder: 0 });
    expect(mocks.enforce).not.toHaveBeenCalled();
    // The transition ends a tick after the error shows.
    await waitFor(() => expect(saveButton().disabled).toBe(false));
  });

  it('has no Save for a read-only viewer', () => {
    renderCard({ canEdit: false, canEnforceOrder: false });
    expect(screen.queryByTestId('approval-steps-save')).toBeNull();
  });
});
