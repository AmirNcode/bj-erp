import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ALL_KEYS, DEPENDENCIES, SECTIONS, SHAPES, allows, applyLevel, applySectionBulk, fullPerms, isWithin,
  parsePermsClaim, sectionSummary,
} from '@/lib/permissions/catalog';

/** Body between $$ ... $$ of a function in the current schema dump, whitespace removed. */
function fnBody(sql: string, name: string, args = ''): string {
  const header = `CREATE FUNCTION private.${name}(${args})`;
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
    expect(ALL_KEYS).toHaveLength(20);
  });
  it('dependency rows match permission_deps() both ways', () => {
    const body = fnBody(sql, 'permission_deps');
    for (const d of DEPENDENCIES) expect(body).toContain(`('${d.key}','${d.keyLevel}','${d.needs}')`);
    expect(body.match(/\('[a-z_]+','[a-z]+','[a-z_]+'\)/g)).toHaveLength(DEPENDENCIES.length);
  });
  it('shapes match permission_allows(): its three key lists are the E, R and RE items', () => {
    const body = fnBody(sql, 'permission_allows', 'p_key text, p_level text');
    // when p_key in (...) then <level rule>, in that order: edit only, read only, both.
    const lists = [...body.matchAll(/whenp_keyin\(([^)]*)\)then([^w]*?)(?=when|else)/g)].map((m) => ({
      keys: (m[1].match(/'([a-z_]+)'/g) ?? []).map((q) => q.slice(1, -1)).sort(),
      rule: m[2],
    }));
    const shapeOf = (rule: string) =>
      rule === "p_level='edit'" ? 'E' : rule === "p_level='read'" ? 'R' : rule === "p_levelin('read','edit')" ? 'RE' : rule;
    const fromSql = Object.fromEntries(lists.flatMap((l) => l.keys.map((k) => [k, shapeOf(l.rule)])));
    expect(lists).toHaveLength(3);
    expect(fromSql).toEqual(SHAPES);
  });
});

describe('shapes', () => {
  it('action items have no read level, read items no edit level', () => {
    expect(allows('passwords', 'read')).toBe(false);
    expect(allows('passwords', 'edit')).toBe(true);
    expect(allows('calendar', 'edit')).toBe(false);
    expect(SHAPES.people).toBe('RE');
  });
  it('main-era items: absences and finance read only, the two switches action only', () => {
    expect(SHAPES.absences).toBe('R');
    expect(SHAPES.finance).toBe('R');
    expect(SHAPES.personal_info_own).toBe('E');
    expect(SHAPES.special_leave).toBe('E');
    expect(allows('finance', 'edit')).toBe(false);
    expect(allows('special_leave', 'read')).toBe(false);
  });
});

describe('section layout', () => {
  const items = (key: string) => SECTIONS.find((s) => s.key === key)!.items;
  it('finance has its own section, right after leave', () => {
    expect(SECTIONS.map((s) => s.key)).toEqual(['employees', 'departments', 'leave', 'finance', 'approvalChain', 'settings']);
    expect(items('finance')).toEqual(['finance']);
  });
  it('own personal information sits right after personal information', () => {
    const e = items('employees');
    expect(e[e.indexOf('personal_info') + 1]).toBe('personal_info_own');
  });
  it('leave: special leave after accrual, absences after calendar', () => {
    expect(items('leave')).toEqual([
      'leave_balances', 'leave_accrual', 'special_leave', 'leave_requests', 'calendar', 'absences', 'reports',
    ]);
  });
  it('the claim parser keeps the new keys', () => {
    expect(parsePermsClaim({ absences: 'read', finance: 'read', personal_info_own: 'edit', special_leave: 'edit' })).toEqual({
      absences: 'read', finance: 'read', personal_info_own: 'edit', special_leave: 'edit',
    });
    expect(parsePermsClaim({ finance: 'edit', special_leave: 'read' })).toEqual({});
  });
});

describe('new dependencies (D6)', () => {
  it('absences raises people and the request archive; finance and own personal info stand alone', () => {
    expect(applyLevel({}, 'absences', 'read').raised.sort()).toEqual(['leave_requests', 'people']);
    expect(applyLevel({}, 'finance', 'read').raised).toEqual([]);
    expect(applyLevel({}, 'personal_info_own', 'edit').raised).toEqual([]);
  });
  it('special leave raises people and leave balances', () => {
    expect(applyLevel({}, 'special_leave', 'edit').raised.sort()).toEqual(['leave_balances', 'people']);
  });
  it('removing the request archive removes absences', () => {
    const r = applyLevel({ people: 'read', leave_requests: 'read', absences: 'read' }, 'leave_requests', null);
    expect(r.perms).toEqual({ people: 'read' });
    expect(r.lowered).toEqual(['absences']);
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

describe('cascade down', () => {
  it('removing people removes all transitive dependents', () => {
    const r = applyLevel({ people: 'read', departments: 'edit', leave_accrual: 'edit', passwords: 'edit' }, 'people', null);
    expect(r.perms).toEqual({});
    expect(r.lowered.sort()).toEqual(['departments', 'leave_accrual', 'passwords']);
    expect(r.raised).toEqual([]);
  });
  it('single row: people cannot stay when departments needs it', () => {
    const r = applyLevel({ departments: 'read', people: 'read' }, 'people', null);
    expect(r.perms).toEqual({});
    expect(r.lowered).toEqual(['departments']);
  });
  it('lowering clearance edit to read keeps people, lowers nothing', () => {
    const r = applyLevel({ people: 'read', clearance: 'edit' }, 'clearance', 'read');
    expect(r.perms).toEqual({ people: 'read', clearance: 'read' });
    expect(r.lowered).toEqual([]);
  });
  it('edit-only dependency does not cascade when dependent is at read', () => {
    const r = applyLevel({ people: 'read', clearance: 'read' }, 'people', null);
    expect(r.perms).toEqual({ clearance: 'read' });
    expect(r.lowered).toEqual([]);
  });
});

describe('sections', () => {
  it('bulk none on employees cascades to departments outside the section', () => {
    const r = applySectionBulk({ departments: 'read', people: 'read' }, 'employees', 'none');
    expect(r.perms).toEqual({});
    expect(r.lowered).toEqual(['departments']);
    expect(sectionSummary(r.perms, 'employees')).toBe('none');
  });
  it('out-of-section raise is reported', () => {
    const r = applySectionBulk({}, 'departments', 'allow');
    expect(r.raised).toEqual(['people']);
    expect(r.lowered).toEqual([]);
  });
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
  it('personal_info edit covers the self-only personal_info_own (I1); nothing else does', () => {
    expect(isWithin({ personal_info_own: 'edit' }, { people: 'edit', personal_info: 'edit' })).toBe(true);
    expect(isWithin({ personal_info_own: 'edit' }, { personal_info_own: 'edit' })).toBe(true);
    expect(isWithin({ personal_info_own: 'edit' }, { people: 'read', personal_info: 'read' })).toBe(false);
    expect(isWithin({ personal_info_own: 'edit' }, { people: 'read', passwords: 'edit' })).toBe(false);
    // The exception is for personal_info_own only.
    expect(isWithin({ personal_info: 'edit' }, { personal_info_own: 'edit' })).toBe(false);
  });
  it('fullPerms covers every key at its highest level', () => {
    const f = fullPerms();
    expect(Object.keys(f)).toHaveLength(20);
    expect(f.calendar).toBe('read');
    expect(f.finance).toBe('read');
    expect(f.special_leave).toBe('edit');
    expect(f.people).toBe('edit');
  });
});
