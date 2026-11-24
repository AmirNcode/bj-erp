import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

let user: { id: string } | null = { id: 'u1' };
let result: { data: unknown; error: unknown } = { data: { font_step: 2 }, error: null };
const createRealClient = vi.fn();
const createClient = vi.fn();
let view: { status: string } | null = null;
let cachedProfile: { font_step: unknown } | null = { font_step: 3 };
const getCachedProfile = vi.fn(async () => cachedProfile);

function fake() {
  return {
    from: () => ({ select: () => ({ eq: () => ({ single: async () => result }) }) }),
  };
}
vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), cache: <T,>(f: T) => f }));
vi.mock('@/lib/auth/context', () => ({
  getCachedClaims: async () => (user ? { sub: user.id } : null),
  getCachedProfile: (...a: unknown[]) => getCachedProfile(...(a as [])),
}));
vi.mock('@/lib/auth/viewAs', () => ({ getViewAs: async () => view }));
vi.mock('@/lib/supabase/server', () => ({
  createRealClient: (...a: unknown[]) => { createRealClient(...a); return fake(); },
  createClient: (...a: unknown[]) => { createClient(...a); return fake(); },
}));

const { getOwnFontStep } = await import('@/lib/prefs/fontStep.server');
const { FontStepStyle } = await import('@/app/[locale]/(app)/_components/FontStepStyle');

beforeEach(() => {
  user = { id: 'u1' };
  result = { data: { font_step: 2 }, error: null };
  view = { status: 'live' };
  cachedProfile = { font_step: 3 };
  getCachedProfile.mockClear();
  createRealClient.mockClear();
  createClient.mockClear();
});

describe('getOwnFontStep without a live View as', () => {
  it('reads the cached profile and skips the real client', async () => {
    view = null;
    expect(await getOwnFontStep()).toBe(3);
    expect(getCachedProfile).toHaveBeenCalledWith('u1');
    expect(createRealClient).not.toHaveBeenCalled();
  });
  it('falls back to 0 for a missing or invalid value', async () => {
    view = null;
    cachedProfile = { font_step: 9 };
    expect(await getOwnFontStep()).toBe(0);
    cachedProfile = null;
    expect(await getOwnFontStep()).toBe(0);
  });
});

describe('getOwnFontStep', () => {
  it('uses the real client', async () => {
    await getOwnFontStep();
    expect(createRealClient).toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });
  it('returns the saved step', async () => {
    expect(await getOwnFontStep()).toBe(2);
  });
  it('returns 0 on error, out-of-range, or no user', async () => {
    result = { data: null, error: { message: 'x' } };
    expect(await getOwnFontStep()).toBe(0);
    result = { data: { font_step: 7 }, error: null };
    expect(await getOwnFontStep()).toBe(0);
    result = { data: { font_step: 2 }, error: null };
    user = null;
    expect(await getOwnFontStep()).toBe(0);
  });
});

describe('FontStepStyle', () => {
  it('renders exactly the override', () => {
    expect(renderToStaticMarkup(<FontStepStyle step={3} />)).toBe('<style>:root:root{--font-step:3}</style>');
  });
});
