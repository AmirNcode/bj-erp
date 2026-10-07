import { describe, expect, it } from 'vitest';
import { searchPeople } from '@/components/PersonSearch';

const people = [
  { id: 'a', name: 'حسین صحرائی', personnelNo: '103' },
  { id: 'b', name: 'حسن جعفری', personnelNo: '166' },
  { id: 'c', name: 'Ali Hosseini', personnelNo: '1450' },
  { id: 'd', name: 'رضا', personnelNo: '45' },
  { id: 'e', name: 'حسام', personnelNo: null },
];

describe('searchPeople', () => {
  it('needs two characters', () => {
    expect(searchPeople(people, '1', 5)).toEqual([]);
    expect(searchPeople(people, ' ح ', 5)).toEqual([]);
  });
  it('matches personnel numbers, Persian digits too, sorted low to high', () => {
    expect(searchPeople(people, '45', 5).map((p) => p.id)).toEqual(['d', 'c']);
    expect(searchPeople(people, '۴۵', 5).map((p) => p.id)).toEqual(['d', 'c']);
  });
  it('matches names case-insensitively, sorted by number, no-number last', () => {
    expect(searchPeople(people, 'حس', 5).map((p) => p.id)).toEqual(['a', 'b', 'e']);
    expect(searchPeople(people, 'hoss', 5).map((p) => p.id)).toEqual(['c']);
  });
  it('caps the list', () => {
    expect(searchPeople(people, 'حس', 2)).toHaveLength(2);
  });
});
