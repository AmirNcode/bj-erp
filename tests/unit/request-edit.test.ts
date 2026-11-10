import { describe, expect, it } from 'vitest';
import { editKeyFor, editableUnits, type EditKey } from '@/lib/leave/requestEdit';

const ALL: EditKey[] = ['edit_leave_daily', 'edit_leave_hourly', 'edit_errand_daily', 'edit_errand_hourly', 'edit_requests_own'];
const viewer = (keys: EditKey[]) => ({ id: 'v', keys });
const row = (over: Partial<{ kind: 'leave' | 'errand'; unit: 'day' | 'hour'; status: string; employee_id: string }> = {}) =>
  ({ kind: 'leave' as const, unit: 'day' as const, status: 'approved', employee_id: 'e', ...over });

describe('editKeyFor', () => {
  it('names the key of each request type', () => {
    expect(editKeyFor({ kind: 'leave', unit: 'day' })).toBe('edit_leave_daily');
    expect(editKeyFor({ kind: 'leave', unit: 'hour' })).toBe('edit_leave_hourly');
    expect(editKeyFor({ kind: 'errand', unit: 'day' })).toBe('edit_errand_daily');
    expect(editKeyFor({ kind: 'errand', unit: 'hour' })).toBe('edit_errand_hourly');
  });
});

describe('editableUnits (FR-91)', () => {
  it('offers nothing on a request that is not approved', () => {
    for (const status of ['pending', 'rejected', 'cancelled']) {
      expect(editableUnits(row({ status }), viewer(ALL))).toEqual([]);
    }
  });
  it('refuses the viewer\'s own request without edit_requests_own, allows it with', () => {
    const own = row({ employee_id: 'v' });
    expect(editableUnits(own, viewer(['edit_leave_daily', 'edit_leave_hourly']))).toEqual([]);
    expect(editableUnits(own, viewer(['edit_leave_daily', 'edit_requests_own']))).toEqual(['day']);
  });
  it('edit_requests_own alone edits nothing', () => {
    expect(editableUnits(row({ employee_id: 'v' }), viewer(['edit_requests_own']))).toEqual([]);
  });
  it('all five keys on an own daily leave: both units, current first', () => {
    expect(editableUnits(row({ employee_id: 'v' }), viewer(ALL))).toEqual(['day', 'hour']);
  });
  it('only the daily key on a daily leave: daily only', () => {
    expect(editableUnits(row(), viewer(['edit_leave_daily']))).toEqual(['day']);
  });
  it('both leave keys on an hourly leave: hourly first', () => {
    expect(editableUnits(row({ unit: 'hour' }), viewer(['edit_leave_daily', 'edit_leave_hourly']))).toEqual(['hour', 'day']);
  });
  it('the other unit alone does not open the current type', () => {
    expect(editableUnits(row({ unit: 'hour' }), viewer(['edit_leave_daily']))).toEqual([]);
  });
  it('leave keys do not cover an errand, and the families never mix', () => {
    expect(editableUnits(row({ kind: 'errand' }), viewer(['edit_leave_daily', 'edit_leave_hourly']))).toEqual([]);
    expect(editableUnits(row({ kind: 'errand' }), viewer(['edit_errand_daily', 'edit_leave_hourly']))).toEqual(['day']);
    expect(editableUnits(row({ kind: 'errand', unit: 'hour' }), viewer(['edit_errand_hourly', 'edit_errand_daily']))).toEqual(['hour', 'day']);
  });
});
