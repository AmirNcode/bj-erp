import { describe, it, expect } from 'vitest';
import { buildHomeBoard } from '@/lib/home/board';

const base = { requests: [], balances: [], team: [], pendingCount: 3 };

describe('buildHomeBoard', () => {
  it('employee: no approvals card', () => {
    expect(buildHomeBoard({ ...base, roles: ['employee'] }).showApprovals).toBe(false);
  });
  it('manager: approvals card with count', () => {
    const b = buildHomeBoard({ ...base, roles: ['manager'] });
    expect(b.showApprovals).toBe(true);
    expect(b.pendingCount).toBe(3);
  });
  it('admin: approvals card', () => {
    expect(buildHomeBoard({ ...base, roles: ['admin'] }).showApprovals).toBe(true);
  });
  it('recent caps at 5', () => {
    const requests = Array.from({ length: 8 }, (_, i) => ({ id: String(i) })) as never[];
    expect(buildHomeBoard({ ...base, roles: ['employee'], requests }).recent).toHaveLength(5);
  });
});
