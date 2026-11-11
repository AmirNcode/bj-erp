import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getMySavedSignature = vi.fn();
vi.mock('@/lib/actions/signature', () => ({
  getMySavedSignature: (...args: unknown[]) => getMySavedSignature(...args),
}));

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lwQG8QAAAABJRU5ErkJggg==';
const saved = { ok: true, signature: { signatureData: PNG } };

// The cache is module-level: a fresh module per test.
async function load() {
  vi.resetModules();
  return import('@/lib/signature/useSavedSignature');
}

beforeEach(() => getMySavedSignature.mockReset());
afterEach(cleanup);

describe('useSavedSignature cache', () => {
  it('an ok:false result resolves null, and the next signature box asks again', async () => {
    const { useSavedSignature } = await load();
    getMySavedSignature.mockResolvedValueOnce({ ok: false, error: 'nope' }).mockResolvedValueOnce(saved);

    const first = renderHook(() => useSavedSignature());
    await waitFor(() => expect(first.result.current).toBeNull());
    expect(getMySavedSignature).toHaveBeenCalledTimes(1);

    const second = renderHook(() => useSavedSignature());
    await waitFor(() => expect(second.result.current).toBe(PNG));
    expect(getMySavedSignature).toHaveBeenCalledTimes(2);
  });

  it('a thrown call (a stale Server Action) also resolves null and is not cached', async () => {
    const { useSavedSignature } = await load();
    getMySavedSignature.mockRejectedValueOnce(new Error('Failed to find Server Action')).mockResolvedValueOnce(saved);

    const first = renderHook(() => useSavedSignature());
    await waitFor(() => expect(first.result.current).toBeNull());

    const second = renderHook(() => useSavedSignature());
    await waitFor(() => expect(second.result.current).toBe(PNG));
    expect(getMySavedSignature).toHaveBeenCalledTimes(2);
  });

  it('a successful answer is cached: one call for several boxes', async () => {
    const { useSavedSignature } = await load();
    getMySavedSignature.mockResolvedValue(saved);

    const a = renderHook(() => useSavedSignature());
    const b = renderHook(() => useSavedSignature());
    await waitFor(() => expect(a.result.current).toBe(PNG));
    await waitFor(() => expect(b.result.current).toBe(PNG));
    const c = renderHook(() => useSavedSignature());
    await waitFor(() => expect(c.result.current).toBe(PNG));
    expect(getMySavedSignature).toHaveBeenCalledTimes(1);
  });

  it('"no saved signature" is an answer too and is cached', async () => {
    const { useSavedSignature } = await load();
    getMySavedSignature.mockResolvedValue({ ok: true, signature: null });

    const a = renderHook(() => useSavedSignature());
    await waitFor(() => expect(a.result.current).toBeNull());
    const b = renderHook(() => useSavedSignature());
    await waitFor(() => expect(b.result.current).toBeNull());
    expect(getMySavedSignature).toHaveBeenCalledTimes(1);
  });

  it('clearSavedSignatureCache forces a refetch', async () => {
    const { useSavedSignature, clearSavedSignatureCache } = await load();
    getMySavedSignature.mockResolvedValueOnce({ ok: true, signature: null }).mockResolvedValueOnce(saved);

    const a = renderHook(() => useSavedSignature());
    await waitFor(() => expect(a.result.current).toBeNull());
    clearSavedSignatureCache();
    const b = renderHook(() => useSavedSignature());
    await waitFor(() => expect(b.result.current).toBe(PNG));
    expect(getMySavedSignature).toHaveBeenCalledTimes(2);
  });

  it('a disabled hook does not fetch', async () => {
    const { useSavedSignature } = await load();
    const a = renderHook(() => useSavedSignature(false));
    expect(a.result.current).toBeNull();
    expect(getMySavedSignature).not.toHaveBeenCalled();
  });
});
