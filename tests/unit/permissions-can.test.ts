import { describe, expect, it } from 'vitest';
import { can, parsePermsClaim } from '@/lib/permissions/catalog';

describe('can', () => {
  it('edit implies read; absence is none', () => {
    expect(can({ people: 'edit' }, 'people', 'read')).toBe(true);
    expect(can({ people: 'read' }, 'people', 'edit')).toBe(false);
    expect(can({}, 'calendar', 'read')).toBe(false);
    expect(can({ passwords: 'edit' }, 'passwords')).toBe(true); // default level = edit
  });
});

describe('parsePermsClaim', () => {
  it('keeps known keys with valid levels only', () => {
    expect(parsePermsClaim({ people: 'read', bogus: 'edit', calendar: 'edit', passwords: 'edit' }))
      .toEqual({ people: 'read', passwords: 'edit' });
  });
  it('null for a missing or non-object claim', () => {
    expect(parsePermsClaim(undefined)).toBeNull();
    expect(parsePermsClaim(['people'])).toBeNull();
  });
});
