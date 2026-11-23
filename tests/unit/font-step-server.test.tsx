import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

let user: { id: string } | null = { id: 'u1' };
let result: { data: unknown; error: unknown } = { data: { font_step: 2 }, error: null };
const createRealClient = vi.fn();
const createClient = vi.fn();

function fake() {
  return {
    from: () => ({ select: () => ({ eq: () => ({ single: async () => result }) }) }),
  };
}
vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), cache: <T,>(f: T) => f }));
vi.mock('@/lib/auth/context', () => ({
  getCachedClaims: async () => (user ? { sub: user.id } : null),
}));
vi.mock('@/lib/supabase/server', () => ({
  createRealClient: (...a: unknown[]) => { createRealClient(...a); return fake(); },
  createClient: (...a: unknown[]) => { createClient(...a); return fake(); },
}));

const { getOwnFontStep } = await import('@/lib/prefs/fontStep.server');
const { FontStepStyle } = await import('@/app/[locale]/(app)/_components/FontStepStyle');

beforeEach(() => {
  user = { id: 'u1' };
  result = { data: { font_step: 2 }, error: null };
  createRealClient.mockClear();
  createClient.mockClear();
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
