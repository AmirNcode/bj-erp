import { describe, expect, it } from 'vitest';
import { balanceFigures } from '@/lib/leave/approvalSummary';

const base = { requested_minutes: 1440, balance_minutes: 480 as number | null, pending_other_minutes: 0, balance_rule: 'split' as const };

describe('balanceFigures', () => {
  it('overdraft: balance goes negative, nothing unpaid', () => {
    const f = balanceFigures({ ...base, requested_minutes: 2400, balance_minutes: 960, balance_rule: 'overdraft' });
    expect(f).toMatchObject({ afterMinutes: -1440, overdraftMinutes: 1440, unpaidMinutes: 0 });
  });
  it('strict (balance dropped): paid up to balance, rest unpaid', () => {
    const f = balanceFigures({ ...base, balance_rule: 'strict' });
    expect(f).toMatchObject({ afterMinutes: 0, unpaidMinutes: 960, overdraftMinutes: 0 });
  });
  it('split: same as strict', () => {
    expect(balanceFigures(base)).toMatchObject({ afterMinutes: 0, unpaidMinutes: 960 });
  });
  it('other pending reduces available but not the after figure', () => {
    const f = balanceFigures({ ...base, requested_minutes: 480, balance_minutes: 2400, pending_other_minutes: 1440 });
    expect(f).toMatchObject({ availableMinutes: 960, afterMinutes: 1920, unpaidMinutes: 0 });
  });
  it('negative balance on split: all unpaid, balance unchanged', () => {
    const f = balanceFigures({ ...base, balance_minutes: -240 });
    expect(f).toMatchObject({ afterMinutes: -240, unpaidMinutes: 1440 });
  });
  it('none or missing balance gives null; null rule/pending are tolerated', () => {
    expect(balanceFigures({ ...base, balance_rule: 'none' })).toBeNull();
    expect(balanceFigures({ ...base, balance_rule: null })).toBeNull();
    expect(balanceFigures({ ...base, balance_minutes: null })).toBeNull();
    expect(balanceFigures({ ...base, pending_other_minutes: null })?.otherPendingMinutes).toBe(0);
  });
});
