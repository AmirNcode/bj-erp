import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), del: vi.fn(), requireCaller: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ delete: mocks.del }) }));
vi.mock('@/lib/supabase/server', () => ({ createRealClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/auth/context', () => ({ requireCaller: mocks.requireCaller }));

import { endViewAs } from '@/lib/actions/view-as';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireCaller.mockResolvedValue({ ok: true });
});

describe('endViewAs', () => {
  it('deletes the cookie when the rpc fails', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'boom' } });
    await endViewAs();
    expect(mocks.rpc).toHaveBeenCalledWith('app_view_as_end');
    expect(mocks.del).toHaveBeenCalledWith({ name: 'bj-view-as', path: '/' });
  });

  it('asks only for a signed-in caller, never the admin role (the view resolves to the target)', async () => {
    mocks.rpc.mockResolvedValue({ error: null });
    await endViewAs();
    expect(mocks.requireCaller).toHaveBeenCalledWith();
  });

  it('signed out: skips the rpc but still deletes the cookie', async () => {
    mocks.requireCaller.mockResolvedValue({ ok: false, error: 'not authenticated' });
    await endViewAs();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.del).toHaveBeenCalledWith({ name: 'bj-view-as', path: '/' });
  });
});
