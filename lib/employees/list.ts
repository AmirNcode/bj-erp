/**
 * Employees list URL state (Manage › Employees). Pure — no I/O, unit-tested.
 * The page reads `q`, `dept`, `filter` and `page` from the search params and
 * runs the query server-side, 25 rows at a time.
 */

export const EMPLOYEES_PAGE_SIZE = 25;

/** `incomplete`: active people whose personal info (FR-53) lacks a core field; hr/admin only. */
export type EmployeesFilter = 'all' | 'reports' | 'inactive' | 'incomplete';

export type EmployeesQuery = {
  q: string;
  dept: string | null;
  filter: EmployeesFilter;
  /** 1-based. */
  page: number;
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
  return {
    q: one(params.q).trim().slice(0, 80),
    dept: UUID_RE.test(dept) ? dept : null,
    filter,
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
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
  const s = sp.toString();
  return s ? `${base}?${s}` : base;
}
