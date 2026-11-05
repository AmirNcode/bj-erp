/**
 * Employees list URL state (Manage › Employees). Pure — no I/O, unit-tested.
 * The page reads `q`, `dept`, `filter`, `page`, `sort` and `dir` from the search
 * params and runs the query server-side, 25 rows at a time.
 */

export const EMPLOYEES_PAGE_SIZE = 25;

/** `incomplete`: active people whose personal info (FR-53) lacks a core field; hr/admin only. */
export type EmployeesFilter = 'all' | 'reports' | 'inactive' | 'incomplete';

/** FR-83: the sortable columns. `id` is the ID column (`personnel_no`), not the row's uuid. */
export type EmployeesSort = 'first' | 'last' | 'id' | 'hire';
export type SortDir = 'asc' | 'desc';

export const EMPLOYEES_SORTS: EmployeesSort[] = ['first', 'last', 'id', 'hire'];

export type EmployeesQuery = {
  q: string;
  dept: string | null;
  filter: EmployeesFilter;
  /** 1-based. */
  page: number;
  sort: EmployeesSort;
  dir: SortDir;
};

type Params = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parses the search params. `reports` is only honoured for managers and
 * `incomplete` for personal-info readers; anything unknown falls back to the
 * default, so a hand-edited URL never errors.
 */
export function parseEmployeesQuery(
  params: Params,
  opts: { isManager: boolean; canSeePersonalInfo?: boolean }
): EmployeesQuery {
  const rawFilter = one(params.filter);
  const filter: EmployeesFilter =
    rawFilter === 'inactive' ||
    (rawFilter === 'reports' && opts.isManager) ||
    (rawFilter === 'incomplete' && opts.canSeePersonalInfo)
      ? rawFilter
      : 'all';
  const dept = one(params.dept);
  const page = Number.parseInt(one(params.page), 10);
  const rawSort = one(params.sort) as EmployeesSort;
  return {
    q: one(params.q).trim().slice(0, 80),
    dept: UUID_RE.test(dept) ? dept : null,
    filter,
    page: Number.isFinite(page) && page > 0 ? page : 1,
    sort: EMPLOYEES_SORTS.includes(rawSort) ? rawSort : 'last',
    dir: one(params.dir) === 'desc' ? 'desc' : 'asc',
  };
}

/** What a header click asks for: ascending on a new column, flipped on the active one, page 1. */
export function nextSort(query: EmployeesQuery, sort: EmployeesSort) {
  const dir: SortDir = query.sort === sort && query.dir === 'asc' ? 'desc' : 'asc';
  return { sort, dir, page: 1 };
}

export type OrderTerm = { column: string; ascending: boolean; nullsFirst: boolean };

/**
 * The query's order (FR-83). The other name breaks ties, so people with a blank
 * Last name read alphabetically, and `id` always comes last so paging is stable.
 * `personnel_sort_key` is a computed field: numbers sort as numbers, text IDs come
 * after them. Empties go last, except that Last name Z→A lists them first: that is
 * how Amir and HR find the names still to fix.
 */
export function employeesOrder(sort: EmployeesSort, dir: SortDir): OrderTerm[] {
  const term = (column: string, nullsFirst = false): OrderTerm => ({
    column,
    ascending: dir === 'asc',
    nullsFirst,
  });
  const keys: Record<EmployeesSort, OrderTerm[]> = {
    last: [term('last_name', dir === 'desc'), term('first_name')],
    first: [term('first_name'), term('last_name')],
    id: [term('personnel_sort_key'), term('personnel_no'), term('last_name'), term('first_name')],
    hire: [term('hire_date'), term('last_name'), term('first_name')],
  };
  return [...keys[sort], { column: 'id', ascending: true, nullsFirst: false }];
}

/**
 * The search term made safe for a PostgREST `or=(…ilike.*term*)` filter:
 * characters with meaning in that grammar (`,()*%\` and quotes) are dropped.
 * Returns null when nothing searchable is left.
 */
export function ilikeTerm(q: string): string | null {
  const cleaned = q.replace(/[,()*%\\"':]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned ? `%${cleaned}%` : null;
}

/** Zero-based inclusive row range for `.range(from, to)`. */
export function pageRange(page: number, size = EMPLOYEES_PAGE_SIZE): { from: number; to: number } {
  const from = (Math.max(page, 1) - 1) * size;
  return { from, to: from + size - 1 };
}

/** Builds the list URL's query string, dropping defaults so URLs stay short. */
export function employeesHref(base: string, query: Partial<EmployeesQuery>): string {
  const sp = new URLSearchParams();
  if (query.q) sp.set('q', query.q);
  if (query.dept) sp.set('dept', query.dept);
  if (query.filter && query.filter !== 'all') sp.set('filter', query.filter);
  if (query.page && query.page > 1) sp.set('page', String(query.page));
  if (query.sort && query.sort !== 'last') sp.set('sort', query.sort);
  if (query.dir && query.dir !== 'asc') sp.set('dir', query.dir);
  const s = sp.toString();
  return s ? `${base}?${s}` : base;
}
