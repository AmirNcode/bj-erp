/**
 * Org chart model (FR-44). Pure — no Supabase, no React — so the browsing rules
 * are unit-tested. The page loads every active colleague once
 * (`public.get_org_chart()`, ~140 rows) and navigates in memory.
 *
 * The tree is `profiles.manager_id`: an employee's supervisor if they have one,
 * else their manager (owner decision D7, spec 2026-10-05).
 */

export type OrgPerson = {
  id: string;
  fullName: string;
  jobTitle: string | null;
  departmentId: string | null;
  departmentNameFa: string | null;
  departmentNameEn: string | null;
  /** Null when the person has no manager, or the manager is inactive. */
  managerId: string | null;
  /** Manages a department (`departments.manager_id`). */
  isDepartmentManager: boolean;
};

export type OrgIndex = {
  byId: Map<string, OrgPerson>;
  children: Map<string, OrgPerson[]>;
  /** People with no visible manager — the tops of the chart. */
  roots: OrgPerson[];
};

const byFaName = (a: OrgPerson, b: OrgPerson) => a.fullName.localeCompare(b.fullName, 'fa');

export function buildOrgIndex(people: OrgPerson[]): OrgIndex {
  const byId = new Map(people.map((p) => [p.id, p]));
  const children = new Map<string, OrgPerson[]>();
  const roots: OrgPerson[] = [];

  for (const person of people) {
    const parent = person.managerId && person.managerId !== person.id ? byId.get(person.managerId) : undefined;
    if (!parent) {
      roots.push(person);
      continue;
    }
    const list = children.get(parent.id) ?? [];
    list.push(person);
    children.set(parent.id, list);
  }
  for (const list of children.values()) list.sort(byFaName);

  // A reporting loop (A → B → A) has no way up to a root. The database forbids
  // only the one-step loop, so promote one member of each unreachable group to
  // a root rather than letting them vanish from the chart.
  const reached = new Set<string>();
  const walk = (start: OrgPerson) => {
    const stack = [start];
    while (stack.length > 0) {
      const p = stack.pop()!;
      if (reached.has(p.id)) continue;
      reached.add(p.id);
      stack.push(...(children.get(p.id) ?? []));
    }
  };
  roots.forEach(walk);
  for (const person of people) {
    if (!reached.has(person.id)) {
      roots.push(person);
      walk(person);
    }
  }
  roots.sort(byFaName);

  return { byId, children, roots };
}

/** Direct reports, sorted by Farsi name. */
export function reportsOf(index: OrgIndex, id: string): OrgPerson[] {
  return index.children.get(id) ?? [];
}

/** The managers above `id`, top first, excluding `id`. Cycle-safe. */
export function chainTo(index: OrgIndex, id: string): OrgPerson[] {
  const chain: OrgPerson[] = [];
  const seen = new Set<string>([id]);
  let current = index.byId.get(id);
  while (current?.managerId) {
    const parent = index.byId.get(current.managerId);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    chain.push(parent);
    current = parent;
  }
  return chain.reverse();
}

/**
 * Folds the spellings a Farsi keyboard, an Arabic keyboard and Excel produce
 * for one name: Arabic yeh/kaf, ZWNJ (نیم‌فاصله) vs space, repeated spaces.
 */
export function normalizeFaName(value: string): string {
  return value
    .replace(/ي/g, 'ی')
    .replace(/ى/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/‌/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Name search for the org chart's jump box. */
export function searchPeople(index: OrgIndex, query: string, limit = 8): OrgPerson[] {
  const q = normalizeFaName(query);
  if (!q) return [];
  const out: OrgPerson[] = [];
  for (const person of [...index.byId.values()].sort(byFaName)) {
    if (normalizeFaName(person.fullName).includes(q)) {
      out.push(person);
      if (out.length >= limit) break;
    }
  }
  return out;
}
