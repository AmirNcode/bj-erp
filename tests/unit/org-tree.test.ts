import { describe, it, expect } from 'vitest';
import {
  buildOrgIndex,
  chainTo,
  normalizeFaName,
  reportsOf,
  searchPeople,
  type OrgPerson,
} from '@/lib/org/tree';

const p = (id: string, fullName: string, managerId: string | null = null): OrgPerson => ({
  id,
  fullName,
  jobTitle: null,
  departmentId: null,
  departmentNameFa: null,
  departmentNameEn: null,
  managerId,
  isDepartmentManager: false,
});

const people = [
  p('ceo', 'سیروس نورافکن'),
  p('exe', 'حسین صحرائی', 'ceo'),
  p('fin', 'فاطمه فولادی', 'ceo'),
  p('sup', 'علیرضا محبتیان', 'exe'),
  p('w1', 'عادل سجیراتی', 'sup'),
  p('w2', 'پرویز جعفری', 'sup'),
  p('orphan', 'بی‌سرپرست', 'gone'),
];
const index = buildOrgIndex(people);

describe('buildOrgIndex', () => {
  it('treats people whose manager is absent as roots', () => {
    expect(index.roots.map((r) => r.id).sort()).toEqual(['ceo', 'orphan']);
  });

  it('sorts reports by Farsi name', () => {
    expect(reportsOf(index, 'ceo').map((r) => r.id)).toEqual(['exe', 'fin']);
    expect(reportsOf(index, 'sup').map((r) => r.id)).toEqual(['w2', 'w1']); // پ before ع
  });

  it('gives no reports to a leaf or an unknown id', () => {
    expect(reportsOf(index, 'w1')).toEqual([]);
    expect(reportsOf(index, 'nobody')).toEqual([]);
  });
});

describe('chainTo', () => {
  it('lists managers from the top down, excluding the person', () => {
    expect(chainTo(index, 'w1').map((x) => x.id)).toEqual(['ceo', 'exe', 'sup']);
    expect(chainTo(index, 'ceo')).toEqual([]);
  });

  it('stops on a cycle instead of looping', () => {
    const loop = buildOrgIndex([p('a', 'A', 'b'), p('b', 'B', 'a')]);
    expect(chainTo(loop, 'a').map((x) => x.id)).toEqual(['b']);
  });

  it('a cycle with no way to the top still shows up among the roots', () => {
    const loop = buildOrgIndex([p('a', 'A', 'b'), p('b', 'B', 'a'), p('c', 'C')]);
    expect(loop.roots.map((r) => r.id)).toContain('c');
    expect(loop.roots.some((r) => r.id === 'a' || r.id === 'b')).toBe(true);
  });
});

describe('searchPeople', () => {
  it('matches Arabic and Persian yeh/kaf alike', () => {
    expect(searchPeople(index, 'علي').map((x) => x.id)).toEqual(['sup']);
    expect(searchPeople(index, 'فولادي').map((x) => x.id)).toEqual(['fin']);
  });

  it('ignores ZWNJ and extra spaces', () => {
    expect(searchPeople(index, 'بی سرپرست').map((x) => x.id)).toEqual(['orphan']);
    expect(searchPeople(index, '  حسین   صحرائی ').map((x) => x.id)).toEqual(['exe']);
  });

  it('returns nothing for an empty query and honours the limit', () => {
    expect(searchPeople(index, '   ')).toEqual([]);
    expect(searchPeople(index, 'ی', 2)).toHaveLength(2);
  });
});

describe('normalizeFaName', () => {
  it('folds the variants', () => {
    expect(normalizeFaName('علي‌اكبر  ')).toBe('علی اکبر');
  });
});
