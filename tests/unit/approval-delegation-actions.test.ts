import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDelegationContext } from '@/lib/actions/approval-delegation';
import { getRequestDelegationPreview } from '@/lib/actions/leave/delegation';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), caller: vi.fn() }));
vi.mock('@/lib/auth/context', () => ({ requireCaller: mocks.caller }));
vi.mock('@/lib/cache/invalidate-app', () => ({ invalidateAppCache: vi.fn() }));
vi.mock('@/lib/errors/db-error', () => ({ dbErr: async (error: string) => ({ ok: false, error }) }));

const preview = {
  bounds: { starts_at: '2026-10-20T03:30:00Z', ends_at: '2026-10-20T07:30:00Z' },
  saved: null, effective: null, temporary: null, temporary_eligible: false,
  temporary_delegate_name: null, can_approve: true, can_delegate: true,
  is_ceo: false, auto_approval_eligible: false, authority_id: null, preview_token: 'token',
  extension: { preserve: true },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.caller.mockResolvedValue({ ok: true, supabase: { rpc: mocks.rpc } });
});

describe('delegation action contracts', () => {
  it('uses only the authorized RPC and normalizes a fresh installation with no executive configuration', async () => {
    mocks.rpc.mockResolvedValue({ data: { principal_id: 'self', executive_settings: {} }, error: null });
    const result = await getDelegationContext();
    expect(mocks.rpc).toHaveBeenCalledWith('app_delegation_context', { p_principal_id: undefined });
    expect(result).toMatchObject({ ok: true, context: { executive_settings: { ceo_id: null, hr_head_id: null, hr_step_ids: [] } } });
  });

  it('passes AM/PM intent to the server and preserves the exact returned window and complete JSON', async () => {
    mocks.rpc.mockResolvedValue({ data: preview, error: null });
    const result = await getRequestDelegationPreview({ start: '2026-10-20', end: '2026-10-20', dayPart: 'am', replacementId: 'cover' });
    expect(mocks.rpc).toHaveBeenCalledWith('app_request_delegation_preview', {
      p_start: '2026-10-20', p_end: '2026-10-20', p_unit: 'day', p_day_part: 'am',
      p_start_time: undefined, p_end_time: undefined, p_replacement_id: 'cover',
    });
    expect(result).toEqual({ ok: true, preview });
  });

  it('rejects malformed or reversed preview bounds instead of rendering an unverified window', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { ...preview, bounds: { starts_at: 'invalid', ends_at: 'invalid' } }, error: null });
    expect(await getRequestDelegationPreview({ start: '2026-10-20', end: '2026-10-20' })).toMatchObject({ ok: false });
    mocks.rpc.mockResolvedValueOnce({ data: { ...preview, bounds: { starts_at: preview.bounds.ends_at, ends_at: preview.bounds.starts_at } }, error: null });
    expect(await getRequestDelegationPreview({ start: '2026-10-20', end: '2026-10-20' })).toMatchObject({ ok: false });
  });

  it('does not turn missing capability flags into assumed eligibility', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...preview, temporary_eligible: undefined }, error: null });
    expect(await getRequestDelegationPreview({ start: '2026-10-20', end: '2026-10-20' })).toMatchObject({ ok: false });
  });

  it('fails before any RPC for an unauthenticated caller', async () => {
    mocks.caller.mockResolvedValue({ ok: false, error: 'not authenticated' });
    expect(await getRequestDelegationPreview({ start: '2026-10-20', end: '2026-10-20' })).toEqual({ ok: false, error: 'not authenticated' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
