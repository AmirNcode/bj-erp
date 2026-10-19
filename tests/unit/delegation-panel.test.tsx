import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DelegationPanel } from '@/app/[locale]/(app)/settings/roles/_components/DelegationPanel';
import { getDelegationContext, searchDelegates, setAutoApprovalWindow } from '@/lib/actions/approval-delegation';
import type { DelegationContext } from '@/lib/leave/delegation';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string, params?: Record<string, string>) => `${key}${params ? JSON.stringify(params) : ''}` }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/actions/approval-delegation', () => ({
  getDelegationContext: vi.fn(), searchDelegates: vi.fn(),
  setApprovalDelegate: vi.fn(), setExecutiveSettings: vi.fn(), setAutoApprovalWindow: vi.fn(),
}));
afterEach(cleanup);

const initial: DelegationContext = {
  principal_id: 'principal', principal_name: 'Principal',
  is_admin: false, can_delegate: true, can_approve: true,
  saved: { grant_id: 'grant', delegate_id: 'saved', delegate_name: 'Saved person', ceo_authorized: false },
  effective: null,
  executive_settings: { ceo_id: null, hr_head_id: null, hr_step_ids: [] },
  principals: [], hr_steps: [], auto_approval_minutes: 120,
};

describe('delegate selection eligibility', () => {
  it('displays an unreturned saved appointment separately without making it selectable', () => {
    render(<DelegationPanel initial={initial} initialCandidates={[]} locale="en" />);
    const select = screen.getByTestId('saved-approval-delegate') as HTMLSelectElement;
    const saved = Array.from(select.options).find((option) => option.value === 'saved');
    expect(saved?.disabled).toBe(true);
    expect((screen.getByTestId('delegate-save') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText('Saved person').length).toBeGreaterThan(0);
  });

  it('enables a current saved candidate only after the scoped eligibility reader returns it', () => {
    render(<DelegationPanel initial={initial} initialCandidates={[{ profile_id: 'saved', full_name: 'Saved person', employee_code: '999' }]} locale="en" />);
    const select = screen.getByTestId('saved-approval-delegate') as HTMLSelectElement;
    expect(Array.from(select.options).find((option) => option.value === 'saved')?.disabled).toBe(false);
    expect((screen.getByTestId('delegate-save') as HTMLButtonElement).disabled).toBe(false);
  });

  it('does not offer a picker action when the selected principal lacks permission or natural duties', () => {
    render(<DelegationPanel initial={{ ...initial, can_delegate: false }} initialCandidates={[]} locale="en" />);
    expect(screen.getByText('permissionRequired')).toBeTruthy();
    expect((screen.getByTestId('saved-approval-delegate') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByTestId('delegate-save') as HTMLButtonElement).disabled).toBe(true);
  });

  it('initializes empty executive settings without inventing identities or HR steps', () => {
    render(<DelegationPanel initial={{ ...initial, is_admin: true, saved: null }} initialCandidates={[]} locale="fa" />);
    expect((document.getElementById('ceo_id') as HTMLSelectElement).value).toBe('');
    expect((document.getElementById('hr_head_id') as HTMLSelectElement).value).toBe('');
    expect(screen.getByText('noSteps')).toBeTruthy();
  });
});


describe('delegate ownership and live eligibility controls', () => {
  it('shows a principal selector only to the admin', () => {
    render(<DelegationPanel initial={{ ...initial, is_admin: true, principals: [
      { profile_id: 'principal', full_name: 'Principal', employee_code: '999' },
      { profile_id: 'other', full_name: 'Other principal', employee_code: '998' },
    ] }} initialCandidates={[]} locale="en" />);
    const select = screen.getByTestId('delegate-principal') as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.value)).toEqual(['principal', 'other']);
    expect(screen.getByTestId('executive-approval-settings')).toBeTruthy();
  });

  it('self-service holders cannot choose a different principal or edit executive identities', () => {
    render(<DelegationPanel initial={initial} initialCandidates={[]} locale="en" />);
    expect(screen.queryByTestId('delegate-principal')).toBeNull();
    expect(screen.queryByTestId('executive-approval-settings')).toBeNull();
  });

  it('disables a previously selected person when a fresh scoped search no longer returns them', async () => {
    vi.mocked(searchDelegates).mockResolvedValueOnce({ ok: true, candidates: [] });
    render(<DelegationPanel initial={initial} initialCandidates={[{ profile_id: 'saved', full_name: 'Saved person', employee_code: '999' }]} locale="en" />);
    expect((screen.getByTestId('delegate-save') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText('search'), { target: { value: 'Saved person' } });
    fireEvent.click(screen.getByRole('button', { name: 'searchButton' }));
    await waitFor(() => expect((screen.getByTestId('delegate-save') as HTMLButtonElement).disabled).toBe(true));
    expect(searchDelegates).toHaveBeenCalledWith('principal', 'Saved person');
  });

  it('requires a new explicit CEO appointment attestation even for the same saved person', () => {
    render(<DelegationPanel initial={{ ...initial, executive_settings: { ...initial.executive_settings, ceo_id: 'principal' } }} initialCandidates={[{ profile_id: 'saved', full_name: 'Saved person', employee_code: '999' }]} locale="en" />);
    expect((screen.getByTestId('delegate-save') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('delegate-ceo-attestation'));
    expect((screen.getByTestId('delegate-save') as HTMLButtonElement).disabled).toBe(false);
  });
});


describe('admin-adjustable automatic approval window', () => {
  it('is not offered to a non-admin principal', () => {
    render(<DelegationPanel initial={initial} initialCandidates={[]} locale="en" />);
    expect(screen.queryByTestId('auto-approval-window')).toBeNull();
  });

  it('shows the admin the current window in whole hours', () => {
    render(<DelegationPanel initial={{ ...initial, is_admin: true }} initialCandidates={[]} locale="en" />);
    expect(screen.getByTestId('auto-window-current').textContent).toBe(`current${JSON.stringify({ window: 'hours{"count":2}' })}`);
    expect((screen.getByTestId('auto-window-minutes') as HTMLInputElement).value).toBe('120');
    expect((screen.getByTestId('auto-window-save') as HTMLButtonElement).disabled).toBe(true);
  });

  it.each(['0', '1441', '2.5', 'abc', ''])('refuses %j before calling the server', (value) => {
    render(<DelegationPanel initial={{ ...initial, is_admin: true }} initialCandidates={[]} locale="en" />);
    fireEvent.change(screen.getByTestId('auto-window-minutes'), { target: { value } });
    expect((screen.getByTestId('auto-window-save') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('autoWindowInvalid')).toBeTruthy();
  });

  it('saves a valid window in minutes and refreshes the context', async () => {
    vi.mocked(setAutoApprovalWindow).mockResolvedValue({ ok: true });
    vi.mocked(getDelegationContext).mockResolvedValue({ ok: true, context: { ...initial, is_admin: true, auto_approval_minutes: 2 } });
    vi.mocked(searchDelegates).mockResolvedValue({ ok: true, candidates: [] });
    render(<DelegationPanel initial={{ ...initial, is_admin: true }} initialCandidates={[]} locale="en" />);
    fireEvent.change(screen.getByTestId('auto-window-minutes'), { target: { value: '2' } });
    fireEvent.click(screen.getByTestId('auto-window-save'));
    await waitFor(() => expect(setAutoApprovalWindow).toHaveBeenCalledWith(2));
    await waitFor(() => expect(screen.getByTestId('auto-window-current').textContent).toBe(`current${JSON.stringify({ window: 'minutes{"count":2}' })}`));
    expect(screen.getByRole('status').textContent).toBe('saved');
  });

  it('words the CEO attestation with the configured window', () => {
    render(<DelegationPanel initial={{ ...initial, is_admin: true, auto_approval_minutes: 2, executive_settings: { ceo_id: 'principal', hr_head_id: null, hr_step_ids: [] } }}
      initialCandidates={[{ profile_id: 'saved', full_name: 'Saved person', employee_code: '999' }]} locale="en" />);
    expect(screen.getByText(`ceoAttestation${JSON.stringify({ window: 'minutes{"count":2}' })}`)).toBeTruthy();
  });
});
