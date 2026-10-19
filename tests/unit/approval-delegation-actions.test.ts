import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getApprovalWorkerHealth, getDelegationContext, setAutoApprovalWindow } from '@/lib/actions/approval-delegation';
import { approvalWindowLabel } from '@/lib/leave/delegation';
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


describe('worker health action', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-18T10:32:00Z')); });
  afterEach(() => { vi.useRealTimers(); });

  it('uses the server-scoped RPC without accepting a caller-supplied principal', async () => {
    const health = { job: { active: false }, overdue: 2, blocked: 1, last_run: null };
    mocks.rpc.mockResolvedValue({ data: health, error: null });
    expect(await getApprovalWorkerHealth()).toEqual({ ok: true,
      health: { ...health, observed_at: '2026-10-18T10:32:00.000Z' } });
    expect(mocks.rpc).toHaveBeenCalledWith('app_approval_worker_health');
  });

  it('surfaces authorization/query errors without inventing a healthy result', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'worker status not allowed' } });
    expect(await getApprovalWorkerHealth()).toEqual({ ok: false, error: 'worker status not allowed' });
  });

  it('rejects malformed counts rather than displaying an unreliable status', async () => {
    mocks.rpc.mockResolvedValue({ data: { overdue: -1, blocked: 0 }, error: null });
    expect(await getApprovalWorkerHealth()).toMatchObject({ ok: false });
  });

  it.each([
    { job: { active: 'true' }, overdue: 0, blocked: 0, last_run: null },
    { job: { active: true }, overdue: 0.5, blocked: 0, last_run: null },
    { job: { active: true }, overdue: 0, blocked: 0, last_run: { finished_at: 'invalid' } },
    { job: { active: true }, overdue: 0, blocked: 0, last_run: {} },
    { overdue: 0, blocked: 0, last_run: null },
  ])('rejects malformed scheduling or execution evidence: %j', async (health) => {
    mocks.rpc.mockResolvedValue({ data: health, error: null });
    expect(await getApprovalWorkerHealth()).toMatchObject({ ok: false });
  });

  it('returns only the status fields the card needs', async () => {
    mocks.rpc.mockResolvedValue({ data: {
      job: { active: true, schedule: '* * * * *', job_id: 12 }, overdue: 0, blocked: 0,
      last_run: { started_at: '2026-10-18T10:30:00Z', finished_at: '2026-10-18T10:30:01Z' },
      internal_metadata: 'omit',
    }, error: null });
    expect(await getApprovalWorkerHealth()).toEqual({ ok: true, health: {
      job: { active: true }, overdue: 0, blocked: 0,
      last_run: { finished_at: '2026-10-18T10:30:01Z' },
      observed_at: '2026-10-18T10:32:00.000Z',
    } });
  });
});


describe('automatic approval window', () => {
  it.each([0, 1441, 2.5, Number.NaN])('rejects %s without calling SQL', async (minutes) => {
    expect(await setAutoApprovalWindow(minutes)).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalledWith('app_set_auto_approval_window', expect.anything());
  });

  it('sends whole minutes to the admin-only RPC and surfaces its refusal', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'admin required' } });
    expect(await setAutoApprovalWindow(2)).toMatchObject({ ok: false });
    expect(mocks.rpc).toHaveBeenCalledWith('app_set_auto_approval_window', { p_minutes: 2 });
  });

  it('defaults the context window to 120 minutes when never configured', async () => {
    mocks.rpc.mockResolvedValue({ data: { principal_id: 'p', executive_settings: {} }, error: null });
    expect(await getDelegationContext()).toMatchObject({ ok: true, context: { auto_approval_minutes: 120 } });
  });

  it('labels whole hours as hours and everything else as minutes', () => {
    const t = (key: string, values: { count: number }) => `${values.count} ${key}`;
    expect(approvalWindowLabel(t, 120)).toBe('2 hours');
    expect(approvalWindowLabel(t, 2)).toBe('2 minutes');
    expect(approvalWindowLabel(t, 90)).toBe('90 minutes');
  });
});
