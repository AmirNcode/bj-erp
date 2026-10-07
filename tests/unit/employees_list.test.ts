import { describe, it, expect } from 'vitest';
import { employeesHref, ilikeTerm, pageRange, parseEmployeesQuery } from '@/lib/employees/list';

describe('parseEmployeesQuery', () => {
  it('defaults', () => {
    expect(parseEmployeesQuery({}, { isManager: false })).toEqual({
      q: '',
      dept: null,
      filter: 'all',
      page: 1,
    });
  });
  it('honours reports only for managers', () => {
    expect(parseEmployeesQuery({ filter: 'reports' }, { isManager: true }).filter).toBe('reports');
    expect(parseEmployeesQuery({ filter: 'reports' }, { isManager: false }).filter).toBe('all');
    expect(parseEmployeesQuery({ filter: 'inactive' }, { isManager: false }).filter).toBe('inactive');
    expect(parseEmployeesQuery({ filter: 'bogus' }, { isManager: true }).filter).toBe('all');
    expect(parseEmployeesQuery({ filter: 'incomplete' }, { isManager: true }).filter).toBe('all');
    expect(
      parseEmployeesQuery({ filter: 'incomplete' }, { isManager: false, canSeePersonalInfo: true }).filter
    ).toBe('incomplete');
  });
  it('rejects a non-uuid department and a bad page', () => {
    const q = parseEmployeesQuery({ dept: "x' or 1=1", page: '-3' }, { isManager: false });
    expect(q.dept).toBeNull();
    expect(q.page).toBe(1);
    expect(
      parseEmployeesQuery({ dept: '00000000-0000-0000-0000-0000000000d1', page: '4' }, { isManager: false })
    ).toMatchObject({ dept: '00000000-0000-0000-0000-0000000000d1', page: 4 });
  });
  it('trims the search and takes the first of repeated params', () => {
    expect(parseEmployeesQuery({ q: ['  رضا ', 'x'] }, { isManager: false }).q).toBe('رضا');
  });
});

describe('ilikeTerm', () => {
  it('wraps the term and strips PostgREST grammar characters', () => {
    expect(ilikeTerm('Ali')).toBe('%Ali%');
    expect(ilikeTerm('a,b(c)*%')).toBe('%a b c%');
    expect(ilikeTerm(' , ')).toBeNull();
  });
});

describe('pageRange', () => {
  it('is 25 rows per page, zero-based inclusive', () => {
    expect(pageRange(1)).toEqual({ from: 0, to: 24 });
    expect(pageRange(3)).toEqual({ from: 50, to: 74 });
  });
});

describe('employeesHref', () => {
  it('drops defaults', () => {
    expect(employeesHref('/fa/manage/employees', { q: '', filter: 'all', page: 1 })).toBe(
      '/fa/manage/employees'
    );
    expect(employeesHref('/fa/manage/employees', { q: 'Ali', filter: 'reports', page: 2 })).toBe(
      '/fa/manage/employees?q=Ali&filter=reports&page=2'
    );
  });
});
