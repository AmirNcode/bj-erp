import { describe, expect, it } from 'vitest';
import { can, parsePermsClaim } from '@/lib/permissions/catalog';

describe('can', () => {
  it('edit implies read; absence is none', () => {
    expect(can({ people: 'edit' }, 'people', 'read')).toBe(true);
    expect(can({ people: 'read' }, 'people', 'edit')).toBe(false);
    expect(can({}, 'calendar', 'read')).toBe(false);
    expect(can({ people_create: 'edit' }, 'people_create')).toBe(true); // default level = edit
  });
});

describe('parsePermsClaim', () => {
  it('keeps known keys with valid levels only', () => {
    expect(parsePermsClaim({ people: 'read', bogus: 'edit', calendar: 'edit', people_create: 'edit' }))
      .toEqual({ people: 'read', people_create: 'edit' });
    // passwords left the catalog (resets are admin-only, 20261013200007): a stale claim carries nothing.
    expect(parsePermsClaim({ people: 'read', passwords: 'edit' })).toEqual({ people: 'read' });
  });
  it('null for a missing or non-object claim', () => {
    expect(parsePermsClaim(undefined)).toBeNull();
    expect(parsePermsClaim(['people'])).toBeNull();
  });
});
