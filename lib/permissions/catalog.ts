/**
 * FR-55 permission catalog — the TS mirror of private.permission_keys /
 * permission_allows / permission_deps (migrations 20261013200001, 200004, 200007). 19 items:
 * the spec's 16 less `passwords` (password resets are admin-only since 20261013200007,
 * the FR-55 review decision) plus main's absences, finance, personal_info_own (own
 * personal information, an explicit exception to D3) and special_leave. Pure. Drives
 * the role editor, the nav and the edit capabilities. The database is the
 * authority; tests/unit/permissions-catalog.test.ts keeps the two in step.
 */

export type Level = 'read' | 'edit';
export type PermKey =
  | 'people' | 'people_create' | 'role_manager' | 'role_assign'
  | 'personal_info' | 'personal_info_own' | 'clearance' | 'departments' | 'leave_balances'
  | 'leave_accrual' | 'special_leave' | 'leave_requests' | 'calendar' | 'absences' | 'reports'
  | 'finance' | 'approval_steps' | 'work_settings' | 'holidays';
/** RE: read and edit · E: action only · R: read only. */
export type Shape = 'RE' | 'E' | 'R';
export type Perms = Partial<Record<PermKey, Level>>;
export type SectionKey = 'employees' | 'departments' | 'leave' | 'finance' | 'approvalChain' | 'settings';
export type SectionChoice = 'custom' | 'allow' | 'read' | 'none';

export const SECTIONS: { key: SectionKey; items: PermKey[] }[] = [
  { key: 'employees', items: ['people', 'people_create', 'role_manager', 'role_assign', 'personal_info', 'personal_info_own', 'clearance'] },
  { key: 'departments', items: ['departments'] },
  // absences sits after calendar here (both "who is away" views); SQL permission_keys() lists it
  // after reports. Order is display only: the tests compare sets and counts, so keep both as is.
  { key: 'leave', items: ['leave_balances', 'leave_accrual', 'special_leave', 'leave_requests', 'calendar', 'absences', 'reports'] },
  { key: 'finance', items: ['finance'] },
  { key: 'approvalChain', items: ['approval_steps'] },
  { key: 'settings', items: ['work_settings', 'holidays'] },
];

export const SHAPES: Record<PermKey, Shape> = {
  people: 'RE', people_create: 'E', role_manager: 'E', role_assign: 'E',
  personal_info: 'RE', personal_info_own: 'E', clearance: 'RE', departments: 'RE',
  leave_balances: 'RE', leave_accrual: 'E', special_leave: 'E', leave_requests: 'RE',
  calendar: 'R', absences: 'R', reports: 'R', finance: 'R',
  approval_steps: 'RE', work_settings: 'RE', holidays: 'RE',
};

export const ALL_KEYS = SECTIONS.flatMap((s) => s.items);

/** D6. `keyLevel` 'read' = applies at any level; 'edit' = only when the key is edit. */
export const DEPENDENCIES: { key: PermKey; keyLevel: Level; needs: PermKey }[] = [
  { key: 'people_create', keyLevel: 'read', needs: 'people' },
  { key: 'role_manager', keyLevel: 'read', needs: 'people' },
  { key: 'role_manager', keyLevel: 'read', needs: 'leave_balances' },
  { key: 'role_manager', keyLevel: 'read', needs: 'calendar' },
  { key: 'role_assign', keyLevel: 'read', needs: 'people' },
  { key: 'personal_info', keyLevel: 'read', needs: 'people' },
  { key: 'clearance', keyLevel: 'edit', needs: 'people' },
  { key: 'departments', keyLevel: 'read', needs: 'people' },
  { key: 'leave_balances', keyLevel: 'read', needs: 'people' },
  { key: 'leave_accrual', keyLevel: 'read', needs: 'departments' },
  { key: 'leave_requests', keyLevel: 'read', needs: 'people' },
  { key: 'approval_steps', keyLevel: 'read', needs: 'people' },
  { key: 'reports', keyLevel: 'read', needs: 'people' },
  { key: 'reports', keyLevel: 'read', needs: 'leave_balances' },
  { key: 'reports', keyLevel: 'read', needs: 'leave_requests' },
  // The approved-absences board reads leave_requests joined to profiles through RLS.
  { key: 'absences', keyLevel: 'read', needs: 'people' },
  { key: 'absences', keyLevel: 'read', needs: 'leave_requests' },
  { key: 'special_leave', keyLevel: 'read', needs: 'people' },
  { key: 'special_leave', keyLevel: 'read', needs: 'leave_balances' },
];

export function levelValue(l: Level | undefined): 0 | 1 | 2 {
  return l === 'edit' ? 2 : l === 'read' ? 1 : 0;
}

export function allows(key: PermKey, level: Level): boolean {
  const s = SHAPES[key];
  return s === 'RE' || (s === 'E' ? level === 'edit' : level === 'read');
}

const highest = (key: PermKey): Level => (SHAPES[key] === 'R' ? 'read' : 'edit');

/**
 * Set one item (null = Not allowed). The user's explicit choice always wins, in both directions:
 * - raising: raise what the item needs to read, transitively (`raised`);
 * - removing (null): first remove every item that needs it, transitively (`lowered`, the changed
 *   key itself excluded). Lowering edit to read removes nothing: dependencies only need read.
 */
export function applyLevel(
  perms: Perms,
  key: PermKey,
  level: Level | null
): { perms: Perms; raised: PermKey[]; lowered: PermKey[] } {
  if (level && !allows(key, level)) throw new Error(`${key} has no ${level} level`);
  const next: Perms = { ...perms };
  if (level) next[key] = level;
  else delete next[key];
  const lowered: PermKey[] = [];
  if (!level) {
    const queue: PermKey[] = [key];
    while (queue.length) {
      const gone = queue.shift()!;
      for (const d of DEPENDENCIES) {
        if (d.needs !== gone) continue;
        const kl = next[d.key];
        if (!kl || levelValue(kl) < levelValue(d.keyLevel)) continue;
        delete next[d.key];
        if (d.key !== key && !lowered.includes(d.key)) lowered.push(d.key);
        queue.push(d.key);
      }
    }
  }
  const raised: PermKey[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const d of DEPENDENCIES) {
      const kl = next[d.key];
      if (!kl || levelValue(kl) < levelValue(d.keyLevel)) continue;
      if (levelValue(next[d.needs]) >= 1) continue;
      next[d.needs] = 'read';
      raised.push(d.needs);
      changed = true;
    }
  }
  return { perms: next, raised, lowered };
}

export function sectionSummary(perms: Perms, section: SectionKey): SectionChoice {
  const items = SECTIONS.find((s) => s.key === section)!.items;
  if (items.every((k) => !perms[k])) return 'none';
  if (items.every((k) => perms[k] === highest(k))) return 'allow';
  if (items.every((k) => (SHAPES[k] === 'E' ? !perms[k] : perms[k] === 'read'))) return 'read';
  return 'custom';
}

/**
 * Set every item of a section. `raised` = items outside the section raised to satisfy
 * dependencies; `lowered` = items outside the section removed because they needed an item the
 * bulk choice removed. Items inside the section are set explicitly by the choice.
 */
export function applySectionBulk(
  perms: Perms,
  section: SectionKey,
  choice: Exclude<SectionChoice, 'custom'>
): { perms: Perms; raised: PermKey[]; lowered: PermKey[] } {
  const items = SECTIONS.find((s) => s.key === section)!.items;
  let acc: Perms = { ...perms };
  const raised: PermKey[] = [];
  const lowered: PermKey[] = [];
  for (const k of items) {
    const level: Level | null =
      choice === 'none' ? null : choice === 'allow' ? highest(k) : SHAPES[k] === 'E' ? null : 'read';
    const r = applyLevel(acc, k, level);
    acc = r.perms;
    raised.push(...r.raised.filter((x) => !items.includes(x)));
    for (const x of r.lowered) if (!items.includes(x) && !lowered.includes(x)) lowered.push(x);
  }
  return { perms: acc, raised, lowered };
}

/**
 * D4/D5 mirror (`private.can_act_on`'s key loop, `private.role_within`): every level in
 * `rolePerms` ≤ the caller's. One exception: personal_info_own is self-only (FR-63), so on
 * someone else it is covered by personal_info edit — HR keeps a self-service holder, while a
 * caller with no personal-info power (a password helpdesk) still does not.
 */
export function isWithin(rolePerms: Perms, callerPerms: Perms): boolean {
  return (Object.keys(rolePerms) as PermKey[]).every(
    (k) =>
      levelValue(rolePerms[k]) <= levelValue(callerPerms[k]) ||
      (k === 'personal_info_own' && can(callerPerms, 'personal_info'))
  );
}

export function fullPerms(): Perms {
  return Object.fromEntries(ALL_KEYS.map((k) => [k, highest(k)])) as Perms;
}

export function can(perms: Perms, key: PermKey, level: Level = 'edit'): boolean {
  return levelValue(perms[key]) >= levelValue(level);
}

/** The `app_perms` JWT claim, sanitised: unknown keys and impossible levels dropped. */
export function parsePermsClaim(raw: unknown): Perms | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Perms = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if ((ALL_KEYS as string[]).includes(k) && (v === 'read' || v === 'edit') && allows(k as PermKey, v)) {
      out[k as PermKey] = v;
    }
  }
  return out;
}
