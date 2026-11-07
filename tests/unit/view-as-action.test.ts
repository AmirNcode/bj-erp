import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), del: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ delete: mocks.del }) }));
vi.mock('@/lib/supabase/server', () => ({ createRealClient: async () => ({ rpc: mocks.rpc }) }));

import { endViewAs } from '@/lib/actions/view-as';

beforeEach(() => vi.clearAllMocks());

describe('endViewAs', () => {
  it('deletes the cookie when the rpc fails', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'boom' } });
    await endViewAs();
    expect(mocks.rpc).toHaveBeenCalledWith('app_view_as_end');
    expect(mocks.del).toHaveBeenCalledWith({ name: 'bj-view-as', path: '/' });
  });
});
