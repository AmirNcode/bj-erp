/**
 * Responsive columns of the Sales tables (FR-94), Employees style (lib/employees/columns.ts): the
 * table wrapper is a container (`@container`), so columns appear by the width of the content area,
 * never by the viewport, and the table never scrolls sideways. A column hidden at the current width
 * shows in the row's expanded panel instead (`detail` holds the inverse classes).
 *
 * Priority = order of the lists below: the first is always visible, the last hides first.
 * A column appears once the container is wider than the columns before it plus its own width
 * (`CUSTOMER_WIDTHS` / `RECORD_WIDTHS`, measured worst case: 12-digit rial amounts). The number of
 * currency columns (Customers) and custom list fields (Records) varies, so breakpoints are computed
 * per render and snapped up to a 40px step; the step tables below spell every class out in full
 * so Tailwind sees them.
 */

const STEP = 40;
const MIN = 400;
const MAX = 3000;

const SHOW_AT: Record<number, string> = {
  400: 'hidden @min-[400px]:table-cell',
  440: 'hidden @min-[440px]:table-cell',
  480: 'hidden @min-[480px]:table-cell',
  520: 'hidden @min-[520px]:table-cell',
  560: 'hidden @min-[560px]:table-cell',
  600: 'hidden @min-[600px]:table-cell',
  640: 'hidden @min-[640px]:table-cell',
  680: 'hidden @min-[680px]:table-cell',
  720: 'hidden @min-[720px]:table-cell',
  760: 'hidden @min-[760px]:table-cell',
  800: 'hidden @min-[800px]:table-cell',
  840: 'hidden @min-[840px]:table-cell',
  880: 'hidden @min-[880px]:table-cell',
  920: 'hidden @min-[920px]:table-cell',
  960: 'hidden @min-[960px]:table-cell',
  1000: 'hidden @min-[1000px]:table-cell',
  1040: 'hidden @min-[1040px]:table-cell',
  1080: 'hidden @min-[1080px]:table-cell',
  1120: 'hidden @min-[1120px]:table-cell',
  1160: 'hidden @min-[1160px]:table-cell',
  1200: 'hidden @min-[1200px]:table-cell',
  1240: 'hidden @min-[1240px]:table-cell',
  1280: 'hidden @min-[1280px]:table-cell',
  1320: 'hidden @min-[1320px]:table-cell',
  1360: 'hidden @min-[1360px]:table-cell',
  1400: 'hidden @min-[1400px]:table-cell',
  1440: 'hidden @min-[1440px]:table-cell',
  1480: 'hidden @min-[1480px]:table-cell',
  1520: 'hidden @min-[1520px]:table-cell',
  1560: 'hidden @min-[1560px]:table-cell',
  1600: 'hidden @min-[1600px]:table-cell',
  1640: 'hidden @min-[1640px]:table-cell',
  1680: 'hidden @min-[1680px]:table-cell',
  1720: 'hidden @min-[1720px]:table-cell',
  1760: 'hidden @min-[1760px]:table-cell',
  1800: 'hidden @min-[1800px]:table-cell',
  1840: 'hidden @min-[1840px]:table-cell',
  1880: 'hidden @min-[1880px]:table-cell',
  1920: 'hidden @min-[1920px]:table-cell',
  1960: 'hidden @min-[1960px]:table-cell',
  2000: 'hidden @min-[2000px]:table-cell',
  2040: 'hidden @min-[2040px]:table-cell',
  2080: 'hidden @min-[2080px]:table-cell',
  2120: 'hidden @min-[2120px]:table-cell',
  2160: 'hidden @min-[2160px]:table-cell',
  2200: 'hidden @min-[2200px]:table-cell',
  2240: 'hidden @min-[2240px]:table-cell',
  2280: 'hidden @min-[2280px]:table-cell',
  2320: 'hidden @min-[2320px]:table-cell',
  2360: 'hidden @min-[2360px]:table-cell',
  2400: 'hidden @min-[2400px]:table-cell',
  2440: 'hidden @min-[2440px]:table-cell',
  2480: 'hidden @min-[2480px]:table-cell',
  2520: 'hidden @min-[2520px]:table-cell',
  2560: 'hidden @min-[2560px]:table-cell',
  2600: 'hidden @min-[2600px]:table-cell',
  2640: 'hidden @min-[2640px]:table-cell',
  2680: 'hidden @min-[2680px]:table-cell',
  2720: 'hidden @min-[2720px]:table-cell',
  2760: 'hidden @min-[2760px]:table-cell',
  2800: 'hidden @min-[2800px]:table-cell',
  2840: 'hidden @min-[2840px]:table-cell',
  2880: 'hidden @min-[2880px]:table-cell',
  2920: 'hidden @min-[2920px]:table-cell',
  2960: 'hidden @min-[2960px]:table-cell',
  3000: 'hidden @min-[3000px]:table-cell',
};

const HIDE_AT: Record<number, string> = {
  400: '@min-[400px]:hidden',
  440: '@min-[440px]:hidden',
  480: '@min-[480px]:hidden',
  520: '@min-[520px]:hidden',
  560: '@min-[560px]:hidden',
  600: '@min-[600px]:hidden',
  640: '@min-[640px]:hidden',
  680: '@min-[680px]:hidden',
  720: '@min-[720px]:hidden',
  760: '@min-[760px]:hidden',
  800: '@min-[800px]:hidden',
  840: '@min-[840px]:hidden',
  880: '@min-[880px]:hidden',
  920: '@min-[920px]:hidden',
  960: '@min-[960px]:hidden',
  1000: '@min-[1000px]:hidden',
  1040: '@min-[1040px]:hidden',
  1080: '@min-[1080px]:hidden',
  1120: '@min-[1120px]:hidden',
  1160: '@min-[1160px]:hidden',
  1200: '@min-[1200px]:hidden',
  1240: '@min-[1240px]:hidden',
  1280: '@min-[1280px]:hidden',
  1320: '@min-[1320px]:hidden',
  1360: '@min-[1360px]:hidden',
  1400: '@min-[1400px]:hidden',
  1440: '@min-[1440px]:hidden',
  1480: '@min-[1480px]:hidden',
  1520: '@min-[1520px]:hidden',
  1560: '@min-[1560px]:hidden',
  1600: '@min-[1600px]:hidden',
  1640: '@min-[1640px]:hidden',
  1680: '@min-[1680px]:hidden',
  1720: '@min-[1720px]:hidden',
  1760: '@min-[1760px]:hidden',
  1800: '@min-[1800px]:hidden',
  1840: '@min-[1840px]:hidden',
  1880: '@min-[1880px]:hidden',
  1920: '@min-[1920px]:hidden',
  1960: '@min-[1960px]:hidden',
  2000: '@min-[2000px]:hidden',
  2040: '@min-[2040px]:hidden',
  2080: '@min-[2080px]:hidden',
  2120: '@min-[2120px]:hidden',
  2160: '@min-[2160px]:hidden',
  2200: '@min-[2200px]:hidden',
  2240: '@min-[2240px]:hidden',
  2280: '@min-[2280px]:hidden',
  2320: '@min-[2320px]:hidden',
  2360: '@min-[2360px]:hidden',
  2400: '@min-[2400px]:hidden',
  2440: '@min-[2440px]:hidden',
  2480: '@min-[2480px]:hidden',
  2520: '@min-[2520px]:hidden',
  2560: '@min-[2560px]:hidden',
  2600: '@min-[2600px]:hidden',
  2640: '@min-[2640px]:hidden',
  2680: '@min-[2680px]:hidden',
  2720: '@min-[2720px]:hidden',
  2760: '@min-[2760px]:hidden',
  2800: '@min-[2800px]:hidden',
  2840: '@min-[2840px]:hidden',
  2880: '@min-[2880px]:hidden',
  2920: '@min-[2920px]:hidden',
  2960: '@min-[2960px]:hidden',
  3000: '@min-[3000px]:hidden',
};

/** The step at or above `px`; above the largest step the column never shows (it stays in the panel). */
function snap(px: number): number {
  return Math.min(MAX + STEP, Math.max(MIN, Math.ceil(px / STEP) * STEP));
}

export type ColumnSet<K extends string> = {
  /** Cell / header classes: hidden until the container reaches the column's breakpoint. */
  show: Record<K, string>;
  /** Detail-panel classes: the inverse, hidden once the column is in the table. */
  detail: Record<K, string>;
  /** Toggle cell and panel row: hidden once every column is in the table. */
  expandHide: string;
};

/** `widths` in priority order: [key, cell width, count]; the always-visible part is `base`. */
function build<K extends string>(base: number, widths: [K, number][]): ColumnSet<K> {
  const show = {} as Record<K, string>;
  const detail = {} as Record<K, string>;
  let cum = base;
  let last = snap(base);
  for (const [key, w] of widths) {
    cum += w;
    last = snap(cum + 30);
    show[key] = SHOW_AT[last] ?? 'hidden';
    detail[key] = HIDE_AT[last] ?? 'hidden';
  }
  return { show, detail, expandHide: HIDE_AT[last] ?? 'hidden' };
}

export type CustomerColumn =
  | 'records' | 'sales' | 'won' | 'winRate' | 'open' | 'lost' | 'lastInquiry' | 'owner'
  | 'quoted' | 'noBid' | 'archived' | 'firstInquiry' | 'nextDeadline' | 'kind';

/** Customers: company + chevron are always there; `sales` / `quoted` hold one column per currency. */
export function customerColumns(salesCurrencies: number, quotedCurrencies: number): ColumnSet<CustomerColumn> {
  const money = 125;
  return build(231 + 48, [
    ['records', 107],
    ['sales', salesCurrencies * money],
    ['won', 68],
    ['winRate', 96],
    ['open', 74],
    ['lost', 72],
    ['lastInquiry', 122],
    ['owner', 150],
    ['quoted', quotedCurrencies * money],
    ['noBid', 82],
    ['archived', 102],
    ['firstInquiry', 126],
    ['nextDeadline', 126],
    ['kind', 90],
  ]);
}

export type RecordColumn = 'buyer' | 'stage' | 'owner' | 'deadline' | 'received' | 'value' | 'client';

/** Records: record no + title + chevron are always there; custom list fields go with `client`. */
export function recordColumns(customFields: number): ColumnSet<RecordColumn> {
  return build(112 + 196 + 48, [
    ['buyer', 142],
    ['stage', 91],
    ['owner', 124],
    ['deadline', 175],
    ['received', 119],
    ['value', 176],
    ['client', 142 + customFields * 140],
  ]);
}
