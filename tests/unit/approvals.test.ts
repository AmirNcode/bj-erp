import { describe, it, expect } from 'vitest';
import { filterApprovable } from '@/lib/leave/approvals';

const rows = [
  { id: 'a', employee_manager_id: 'mgr-1' },
  { id: 'b', employee_manager_id: 'mgr-2' },
  { id: 'c', employee_manager_id: null },
];

describe('filterApprovable', () => {
  it('admin sees every pending row', () => {
    expect(filterApprovable(rows, 'mgr-1', true).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('manager sees only their own reports', () => {
    expect(filterApprovable(rows, 'mgr-1', false).map((r) => r.id)).toEqual(['a']);
  });

  it('manager with no reports sees nothing', () => {
    expect(filterApprovable(rows, 'mgr-9', false)).toEqual([]);
  });

  it('does not treat a null manager_id as a match for a real id', () => {
    expect(filterApprovable(rows, 'mgr-2', false).map((r) => r.id)).toEqual(['b']);
  });
});
