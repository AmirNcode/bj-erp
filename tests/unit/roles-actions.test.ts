import { describe, expect, it } from 'vitest';
import { toRoleRow } from '@/lib/actions/roles-helpers';

describe('toRoleRow', () => {
  it('maps and sanitises permissions', () => {
    expect(
      toRoleRow({
        id: 'r',
        system_key: null,
        kind: 'custom',
        name: 'Helpdesk',
        holders: 2,
        permissions: { people: 'read', passwords: 'edit', junk: 'edit' },
      })
    ).toEqual({
      id: 'r',
      systemKey: null,
      kind: 'custom',
      name: 'Helpdesk',
      holders: 2,
      permissions: { people: 'read', passwords: 'edit' },
    });
  });

  it('falls back to an empty permission set and a custom kind for bad input', () => {
    const row = toRoleRow({ id: 'r', system_key: 'admin', kind: 'weird', name: 'X', holders: 0, permissions: null });
    expect(row.permissions).toEqual({});
    expect(row.kind).toBe('custom');
  });
});
