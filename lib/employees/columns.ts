/**
 * Responsive columns of the Employees table (FR-92). The table wrapper is a
 * container (`@container`), so columns appear by the width of the content area,
 * not the viewport. A column hidden at the current width shows in the row's
 * expanded panel instead (`DETAIL_HIDE` is the inverse class).
 *
 * Class names are written out in full so Tailwind sees them.
 */
export type EmpColumn =
  | 'last'
  | 'id'
  | 'hire'
  | 'department'
  | 'roles'
  | 'upcoming'
  | 'balance'
  | 'used'
  | 'unpaid'
  | 'edit';

export const COLUMN_SHOW: Record<EmpColumn, string> = {
  last: 'hidden @xl:table-cell',
  upcoming: 'hidden @xl:table-cell',
  edit: 'hidden @xl:table-cell',
  balance: 'hidden @2xl:table-cell',
  id: 'hidden @3xl:table-cell',
  department: 'hidden @4xl:table-cell',
  roles: 'hidden @5xl:table-cell',
  hire: 'hidden @6xl:table-cell',
  used: 'hidden @7xl:table-cell',
  unpaid: 'hidden @7xl:table-cell',
};

export const DETAIL_HIDE: Record<EmpColumn, string> = {
  last: '@xl:hidden',
  upcoming: '@xl:hidden',
  edit: '@xl:hidden',
  balance: '@2xl:hidden',
  id: '@3xl:hidden',
  department: '@4xl:hidden',
  roles: '@5xl:hidden',
  hire: '@6xl:hidden',
  used: '@7xl:hidden',
  unpaid: '@7xl:hidden',
};

/** The toggle and the panel are pointless once every column is visible. */
export const EXPAND_HIDE = '@7xl:hidden';
