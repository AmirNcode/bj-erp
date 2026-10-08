import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ALL_KEYS, DEPENDENCIES, SHAPES, allows, applyLevel, applySectionBulk, fullPerms, isWithin,
  sectionSummary,
} from '@/lib/permissions/catalog';

/** Body between $$ ... $$ of a function in the current schema dump, whitespace removed. */
function fnBody(sql: string, name: string): string {
  const header = `CREATE FUNCTION private.${name}()`;
  expect(sql.split(header)).toHaveLength(2); // defined exactly once
  const rest = sql.slice(sql.indexOf(header));
  const start = rest.indexOf('$$') + 2;
  const end = rest.indexOf('$$', start);
  return rest.slice(start, end).replace(/\s+/g, '');
}

describe('catalog matches SQL', () => {
  const sql = readFileSync('supabase/schema.sql', 'utf8');
  it('every key is in permission_keys() and the counts agree', () => {
    const body = fnBody(sql, 'permission_keys');
    for (const k of ALL_KEYS) expect(body).toContain(`'${k}'`);
    expect(body.match(/'[a-z_]+'/g)).toHaveLength(ALL_KEYS.length);
    expect(ALL_KEYS).toHaveLength(16);
  });
  it('dependency rows match permission_deps() both ways', () => {
    const body = fnBody(sql, 'permission_deps');
    for (const d of DEPENDENCIES) expect(body).toContain(`('${d.key}','${d.keyLevel}','${d.needs}')`);
    expect(body.match(/\('[a-z_]+','[a-z]+','[a-z_]+'\)/g)).toHaveLength(DEPENDENCIES.length);
  });
});

describe('shapes', () => {
  it('action items have no read level, read items no edit level', () => {
    expect(allows('passwords', 'read')).toBe(false);
    expect(allows('passwords', 'edit')).toBe(true);
    expect(allows('calendar', 'edit')).toBe(false);
    expect(SHAPES.people).toBe('RE');
  });
});

describe('applyLevel', () => {
  it('raises dependencies to read and reports them', () => {
    const r = applyLevel({}, 'reports', 'read');
    expect(r.perms).toEqual({ reports: 'read', people: 'read', leave_balances: 'read', leave_requests: 'read' });
    expect(r.raised.sort()).toEqual(['leave_balances', 'leave_requests', 'people']);
  });
  it('does not lower an existing higher level', () => {
    expect(applyLevel({ people: 'edit' }, 'passwords', 'edit').perms.people).toBe('edit');
  });
  it('clearance read needs nothing; edit needs people', () => {
    expect(applyLevel({}, 'clearance', 'read').raised).toEqual([]);
    expect(applyLevel({}, 'clearance', 'edit').raised).toEqual(['people']);
  });
  it('chains: accrual raises departments which raises people', () => {
    expect(applyLevel({}, 'leave_accrual', 'edit').raised.sort()).toEqual(['departments', 'people']);
  });
  it('role_manager also needs leave_balances and calendar (D6 amendment)', () => {
    expect(applyLevel({}, 'role_manager', 'edit').raised.sort()).toEqual(['calendar', 'leave_balances', 'people']);
  });
  it('null removes the item only', () => {
    expect(applyLevel({ people: 'read', passwords: 'edit' }, 'passwords', null).perms).toEqual({ people: 'read' });
  });
  it('refuses a level the shape forbids', () => {
    expect(() => applyLevel({}, 'calendar', 'edit')).toThrow();
  });
});

describe('sections', () => {
  it('summary is custom when mixed', () => {
    expect(sectionSummary({ people: 'edit' }, 'employees')).toBe('custom');
    expect(sectionSummary({}, 'employees')).toBe('none');
  });
  it('allow-all sets each item to its highest level', () => {
    const r = applySectionBulk({}, 'leave', 'allow');
    expect(r.perms).toMatchObject({ leave_balances: 'edit', leave_accrual: 'edit', leave_requests: 'edit', calendar: 'read', reports: 'read' });
    expect(sectionSummary(r.perms, 'leave')).toBe('allow');
  });
  it('read-only-all leaves action items off', () => {
    const r = applySectionBulk({}, 'employees', 'read');
    expect(r.perms.people).toBe('read');
    expect(r.perms.passwords).toBeUndefined();
    expect(sectionSummary(r.perms, 'employees')).toBe('read');
  });
  it('none clears the section, keeping others', () => {
    expect(applySectionBulk({ people: 'edit', holidays: 'edit' }, 'employees', 'none').perms).toEqual({ holidays: 'edit' });
  });
});

describe('isWithin / fullPerms', () => {
  it('compares levels per key', () => {
    expect(isWithin({ people: 'read' }, { people: 'edit' })).toBe(true);
    expect(isWithin({ people: 'edit' }, { people: 'read' })).toBe(false);
    expect(isWithin({ passwords: 'edit' }, {})).toBe(false);
  });
  it('fullPerms covers every key at its highest level', () => {
    const f = fullPerms();
    expect(Object.keys(f)).toHaveLength(16);
    expect(f.calendar).toBe('read');
    expect(f.people).toBe('edit');
  });
});
