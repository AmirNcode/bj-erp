import { beforeEach, describe, expect, it, vi } from 'vitest';

const update = vi.fn();
const set = vi.fn();
let outcome: { data: unknown; error: unknown };

vi.mock('@/lib/auth/context', () => ({
  requireCaller: async () => ({
    ok: true,
    user: { id: 'me' },
    supabase: {
      from: () => ({
        update: (p: unknown) => {
          update(p);
          return { eq: () => ({ select: async () => outcome }) };
        },
      }),
    },
  }),
}));
vi.mock('@/lib/cache/invalidate-app', () => ({ invalidateAppCache: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ set, get: () => undefined }) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

const { updateMyPrefs } = await import('@/lib/actions/profile');

beforeEach(() => {
  update.mockClear();
  set.mockClear();
  outcome = { data: [{ id: 'me' }], error: null };
});

describe('updateMyPrefs', () => {
  it('sends font_step alone', async () => {
    expect(await updateMyPrefs({ fontStep: 2 })).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith({ font_step: 2 });
    expect(set).not.toHaveBeenCalled();
  });
  it('rejects an invalid step without writing', async () => {
    const r = await updateMyPrefs({ fontStep: 9 as never });
    expect(r.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
  it('sends both and sets the locale cookie', async () => {
    await updateMyPrefs({ languagePref: 'en', fontStep: 1 });
    expect(update).toHaveBeenCalledWith({ language_pref: 'en', font_step: 1 });
    expect(set).toHaveBeenCalled();
  });
  it('maps a read-only transaction failure (25006) to a db error', async () => {
    outcome = { data: null, error: { message: 'cannot execute UPDATE in a read-only transaction', code: '25006' } };
    const r = await updateMyPrefs({ fontStep: 3 });
    expect(r.ok).toBe(false);
  });
});
