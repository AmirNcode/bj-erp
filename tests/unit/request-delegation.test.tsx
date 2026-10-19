import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRequestDelegation } from '@/app/[locale]/(app)/request/_components/useRequestForm';
import { RequestDelegationFields } from '@/app/[locale]/(app)/request/_components/RequestDelegationFields';
import type { DelegationPreviewQuery, RequestDelegationPreview } from '@/lib/leave/delegation';

const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  t: (key: string, params?: Record<string, string>) => `${key}${params ? `:${JSON.stringify(params)}` : ''}`,
}));
vi.mock('next-intl', () => ({ useTranslations: () => mocks.t }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/actions/leave/delegation', () => ({ getRequestDelegationPreview: mocks.preview }));
vi.mock('@/lib/actions/leave/balances', () => ({ getMyBalance: vi.fn() }));
vi.mock('@/lib/actions/leave/requests', () => ({ getReplacementCandidates: vi.fn() }));

const query: DelegationPreviewQuery = { start: '2026-10-20', end: '2026-10-20', unit: 'day', dayPart: 'am', replacementId: null };
const preview: RequestDelegationPreview = {
  bounds: { starts_at: '2026-10-20T03:30:00Z', ends_at: '2026-10-20T07:30:00Z' },
  saved: null, effective: null, temporary: null,
  temporary_eligible: false, temporary_delegate_name: null,
  can_approve: true, can_delegate: false, is_ceo: false,
  auto_approval_eligible: false, authority_id: null, preview_token: 'version-1',
};

beforeEach(() => { mocks.preview.mockReset(); });
afterEach(cleanup);

describe('request delegation preview and consent', () => {
  it('blocks while pending and on a failed preview; a successful no-delegate warning does not block', async () => {
    mocks.preview.mockResolvedValueOnce({ ok: false, error: 'preview failed' });
    const { result } = renderHook(() => useRequestDelegation(query));
    expect(result.current.blocked).toBe(true);
    await waitFor(() => expect(result.current.error).toBe('preview failed'));
    expect(result.current.blocked).toBe(true);
    mocks.preview.mockResolvedValueOnce({ ok: true, preview });
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.preview).toEqual(preview));
    expect(result.current.blocked).toBe(false);
    expect(result.current.problem()).toBeNull();
  });

  it('requires own-request consent only when server eligibility says so and passes complete JSON', async () => {
    const complete = { ...preview, auto_approval_eligible: true, authority_id: 'grant-1', server_extension: { keep: true } };
    mocks.preview.mockResolvedValue({ ok: true, preview: complete });
    const { result } = renderHook(() => useRequestDelegation(query));
    await waitFor(() => expect(result.current.preview).not.toBeNull());
    expect(result.current.problem()).toBe('ownConsentRequired');
    act(() => result.current.setAutoApprovalConsent(true));
    expect(result.current.blocked).toBe(false);
    expect(result.current.submission).toMatchObject({ delegationPreview: complete, autoApprovalConsent: true, temporaryCeoAuthorized: false });
  });

  it('requires separate CEO authorization for the temporary appointment', async () => {
    mocks.preview.mockResolvedValue({ ok: true, preview: { ...preview, is_ceo: true, temporary_eligible: true, temporary_delegate_name: 'Temporary approver' } });
    const { result } = renderHook(() => useRequestDelegation(query));
    await waitFor(() => expect(result.current.preview).not.toBeNull());
    expect(result.current.problem()).toBe('temporaryConsentRequired');
    act(() => result.current.setAutoApprovalConsent(true));
    expect(result.current.problem()).toBe('temporaryConsentRequired');
    act(() => result.current.setTemporaryCeoAuthorized(true));
    expect(result.current.blocked).toBe(false);
  });

  it('drops consent as soon as the absence inputs or preview revision change', async () => {
    mocks.preview.mockResolvedValue({ ok: true, preview: { ...preview, auto_approval_eligible: true } });
    const { result, rerender } = renderHook(({ input }: { input: DelegationPreviewQuery }) => useRequestDelegation(input), { initialProps: { input: query } });
    await waitFor(() => expect(result.current.preview).not.toBeNull());
    act(() => result.current.setAutoApprovalConsent(true));
    expect(result.current.autoApprovalConsent).toBe(true);
    rerender({ input: { ...query, dayPart: 'pm' } });
    expect(result.current.blocked).toBe(true);
    expect(result.current.autoApprovalConsent).toBe(false);
    await waitFor(() => expect(result.current.preview).not.toBeNull());
    act(() => result.current.setAutoApprovalConsent(true));
    act(() => result.current.refresh());
    expect(result.current.autoApprovalConsent).toBe(false);
  });

  it('does not restore an earlier acknowledgment after inputs change A→B→A', async () => {
    mocks.preview.mockResolvedValue({ ok: true, preview: { ...preview, auto_approval_eligible: true } });
    const { result, rerender } = renderHook(({ input }: { input: DelegationPreviewQuery }) => useRequestDelegation(input), { initialProps: { input: query } });
    await waitFor(() => expect(result.current.preview).not.toBeNull());
    act(() => result.current.setAutoApprovalConsent(true));
    rerender({ input: { ...query, dayPart: 'pm' } });
    await waitFor(() => expect(result.current.preview).not.toBeNull());
    rerender({ input: query });
    await waitFor(() => expect(result.current.preview).not.toBeNull());
    expect(result.current.autoApprovalConsent).toBe(false);
    expect(result.current.problem()).toBe('ownConsentRequired');
  });

  it('cannot reuse the earlier preview while refilling a cleared period', async () => {
    mocks.preview.mockResolvedValueOnce({ ok: true, preview: { ...preview, auto_approval_eligible: true } });
    const { result, rerender } = renderHook(({ input }: { input: DelegationPreviewQuery | null }) => useRequestDelegation(input), { initialProps: { input: query as DelegationPreviewQuery | null } });
    await waitFor(() => expect(result.current.preview).not.toBeNull());
    act(() => result.current.setAutoApprovalConsent(true));
    rerender({ input: null });
    mocks.preview.mockImplementationOnce(() => new Promise(() => {}));
    rerender({ input: query });
    expect(result.current.loading).toBe(true);
    expect(result.current.blocked).toBe(true);
    expect(result.current.autoApprovalConsent).toBe(false);
  });

  it('ignores a late response from the previously selected period', async () => {
    let finishOld: (value: unknown) => void = () => {};
    mocks.preview.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
    mocks.preview.mockResolvedValueOnce({ ok: true, preview: { ...preview, preview_token: 'new-period' } });
    const { result, rerender } = renderHook(({ input }: { input: DelegationPreviewQuery }) => useRequestDelegation(input), { initialProps: { input: query } });
    rerender({ input: { ...query, end: '2026-10-21' } });
    await waitFor(() => expect(result.current.preview?.preview_token).toBe('new-period'));
    await act(async () => finishOld({ ok: true, preview }));
    expect(result.current.preview?.preview_token).toBe('new-period');
  });
});

function fields(view: RequestDelegationPreview, props: { hasReplacement?: boolean; showCover?: boolean } = {}) {
  return <RequestDelegationFields locale="en" idPrefix="daily" {...props} delegation={{
    preview: view, loading: false, error: '', blocked: false,
    autoApprovalConsent: false, temporaryCeoAuthorized: false,
    setAutoApprovalConsent: vi.fn(), setTemporaryCeoAuthorized: vi.fn(), refresh: vi.fn(), problem: () => null,
    submission: { delegationPreview: null, autoApprovalConsent: false, temporaryCeoAuthorized: false },
  }} />;
}

describe('request delegation messages', () => {
  it('separates ordinary work cover from a saved approval delegate', () => {
    const saved = { grant_id: 'grant-1', delegate_id: 'person-1', delegate_name: 'Saved approver', ceo_authorized: false };
    render(fields({ ...preview, saved }, { hasReplacement: true }));
    expect(screen.getByTestId('daily-approval-cover').textContent).toContain('workCoverFallback');
    expect(screen.getByTestId('daily-approval-cover').textContent).toContain('Saved approver');
    expect(screen.queryByTestId('daily-auto-approval-consent')).toBeNull();
  });

  it('shows permissionless approvers the admin contact path and keeps the warning advisory', () => {
    render(fields(preview));
    expect(screen.getByTestId('daily-no-approval-delegate').textContent).toContain('noDelegateWarning');
    expect(screen.getByText('contactAdmin')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('does not give ordinary employees an approval responsibility warning', () => {
    render(fields({ ...preview, can_approve: false, can_delegate: true }));
    expect(screen.queryByTestId('daily-no-approval-delegate')).toBeNull();
  });

  it('shows auto-approval consent on errands without adding cover controls', () => {
    render(fields({ ...preview, auto_approval_eligible: true }, { showCover: false }));
    expect(screen.getByTestId('daily-auto-approval-consent')).toBeTruthy();
    expect(screen.queryByTestId('daily-approval-cover')).toBeNull();
    expect(screen.getByTestId('daily-delegation-bounds').textContent).toContain('bounds');
  });

});
