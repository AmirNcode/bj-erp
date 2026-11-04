import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import fa from '@/messages/fa.json';

/** Every leaf key path of a messages object (arrays count as leaves). */
function leafKeys(obj: unknown, prefix = ''): string[] {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    leafKeys(v, prefix ? `${prefix}.${k}` : k)
  );
}

describe('messages fa/en parity', () => {
  it.each(['rolesAdmin', 'permissions'] as const)('%s has the same keys in both files', (ns) => {
    expect(leafKeys(fa[ns]).sort()).toEqual(leafKeys(en[ns]).sort());
  });

  it('the two files have the same key set overall, except the English-only admin panel', () => {
    const enShared = leafKeys(en).filter((k) => !k.startsWith('admin.'));
    expect(leafKeys(fa).sort()).toEqual(enShared.sort());
  });

  it('the admin panel is English only (owner, 2026-11-04; lib/admin/locale.ts)', () => {
    expect('admin' in fa).toBe(false);
    expect(leafKeys(en.admin).length).toBeGreaterThan(0);
  });
});
