import { describe, it, expect } from 'vitest';
import { filterCandidates } from '@/lib/leave/replacement';
import type { ReplacementCandidate } from '@/lib/leave/replacement';

const CANDIDATES: ReplacementCandidate[] = [
  { profileId: '1', fullName: 'Ali Rezaei', employeeCode: 'prod-1042', unavailable: false, unavailableReason: null },
  { profileId: '2', fullName: 'Sara Ahmadi', employeeCode: 'prod-1043', unavailable: true, unavailableReason: 'on leave' },
  { profileId: '3', fullName: 'محمد کریمی', employeeCode: 'prod-1044', unavailable: false, unavailableReason: null },
];

describe('filterCandidates', () => {
  it('returns everyone for an empty or whitespace query', () => {
    expect(filterCandidates(CANDIDATES, '')).toHaveLength(3);
    expect(filterCandidates(CANDIDATES, '   ')).toHaveLength(3);
  });

  it('matches on name, case-insensitively', () => {
    expect(filterCandidates(CANDIDATES, 'ali').map((c) => c.profileId)).toEqual(['1']);
    expect(filterCandidates(CANDIDATES, 'SARA').map((c) => c.profileId)).toEqual(['2']);
  });

  it('matches on employee code', () => {
    expect(filterCandidates(CANDIDATES, '1044').map((c) => c.profileId)).toEqual(['3']);
    expect(filterCandidates(CANDIDATES, 'prod-').map((c) => c.profileId)).toEqual(['1', '2', '3']);
  });

  it('matches Persian names', () => {
    expect(filterCandidates(CANDIDATES, 'کریمی').map((c) => c.profileId)).toEqual(['3']);
  });

  it('keeps unavailable candidates so the UI can explain why', () => {
    const found = filterCandidates(CANDIDATES, 'sara');
    expect(found).toHaveLength(1);
    expect(found[0].unavailable).toBe(true);
    expect(found[0].unavailableReason).toBe('on leave');
  });

  it('returns nothing when nothing matches', () => {
    expect(filterCandidates(CANDIDATES, 'zzz')).toEqual([]);
  });
});
