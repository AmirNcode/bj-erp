import { describe, it, expect } from 'vitest';
import {
  employeesHref,
  employeesOrder,
  ilikeTerm,
  nextSort,
  pageRange,
  parseEmployeesQuery,
} from '@/lib/employees/list';

describe('parseEmployeesQuery', () => {
  it('defaults', () => {
    expect(parseEmployeesQuery({}, { isManager: false })).toEqual({
      q: '',
      dept: null,
      filter: 'all',
      page: 1,
      sort: 'last',
      dir: 'asc',
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
  it('reads the sort and falls back on unknown values', () => {
    expect(parseEmployeesQuery({ sort: 'hire', dir: 'desc' }, { isManager: false })).toMatchObject({
      sort: 'hire',
      dir: 'desc',
    });
    expect(parseEmployeesQuery({ sort: 'salary', dir: 'up' }, { isManager: false })).toMatchObject({
      sort: 'last',
      dir: 'asc',
    });
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
    expect(employeesHref('/e', { sort: 'last', dir: 'asc' })).toBe('/e');
  });
  it('keeps the sort next to every other param', () => {
    expect(employeesHref('/e', { sort: 'id', dir: 'desc', q: 'Ali', page: 2 })).toBe(
      '/e?q=Ali&page=2&sort=id&dir=desc'
    );
    // Last name is the default column, so Z→A shows only the direction.
    expect(employeesHref('/e', { sort: 'last', dir: 'desc' })).toBe('/e?dir=desc');
  });
  it('round-trips through the parser', () => {
    const query = { q: 'Ali', dept: null, filter: 'inactive', page: 3, sort: 'hire', dir: 'desc' } as const;
    const params = Object.fromEntries(new URLSearchParams(employeesHref('/e', query).split('?')[1]));
    expect(parseEmployeesQuery(params, { isManager: false })).toEqual(query);
  });
});

describe('nextSort', () => {
  const base = { q: '', dept: null, filter: 'all', page: 4 } as const;
  it('starts ascending on another column and goes back to page 1', () => {
    expect(nextSort({ ...base, sort: 'last', dir: 'desc' }, 'hire')).toEqual({ sort: 'hire', dir: 'asc', page: 1 });
  });
  it('flips on the active column and goes back to page 1', () => {
    expect(nextSort({ ...base, sort: 'id', dir: 'asc' }, 'id')).toEqual({ sort: 'id', dir: 'desc', page: 1 });
    expect(nextSort({ ...base, sort: 'id', dir: 'desc' }, 'id')).toEqual({ sort: 'id', dir: 'asc', page: 1 });
  });
});

describe('employeesOrder', () => {
  const fmt = (sort: 'first' | 'last' | 'id' | 'hire', dir: 'asc' | 'desc') =>
    employeesOrder(sort, dir).map(
      (o) => `${o.column}.${o.ascending ? 'asc' : 'desc'}${o.nullsFirst ? '.nullsfirst' : '.nullslast'}`
    );
  it('Last name: empties end on A→Z, top on Z→A', () => {
    expect(fmt('last', 'asc')).toEqual(['last_name.asc.nullslast', 'first_name.asc.nullslast', 'id.asc.nullslast']);
    expect(fmt('last', 'desc')).toEqual(['last_name.desc.nullsfirst', 'first_name.desc.nullslast', 'id.asc.nullslast']);
  });
  it('First name: ties go to Last name', () => {
    expect(fmt('first', 'desc')).toEqual(['first_name.desc.nullslast', 'last_name.desc.nullslast', 'id.asc.nullslast']);
  });
  it('ID: numbers, then text, empties last both ways', () => {
    for (const dir of ['asc', 'desc'] as const) {
      expect(fmt('id', dir)).toEqual([
        `personnel_sort_key.${dir}.nullslast`,
        `personnel_no.${dir}.nullslast`,
        `last_name.${dir}.nullslast`,
        `first_name.${dir}.nullslast`,
        'id.asc.nullslast',
      ]);
    }
  });
  it('Hire Date: empties last both ways, ties by name', () => {
    expect(fmt('hire', 'desc')).toEqual([
      'hire_date.desc.nullslast',
      'last_name.desc.nullslast',
      'first_name.desc.nullslast',
      'id.asc.nullslast',
    ]);
  });
  it('always ends on id', () => {
    for (const sort of ['first', 'last', 'id', 'hire'] as const) {
      expect(employeesOrder(sort, 'asc').at(-1)?.column).toBe('id');
    }
  });
});
