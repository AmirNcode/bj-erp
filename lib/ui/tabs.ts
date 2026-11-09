/**
 * Blueprint tabs: underlined text, never a pill. `tabListClass` on the <nav>,
 * `tabClass(on)` on each link. `subTabClass` is the quieter second level
 * (a range or view picker under the tabs).
 */
export const tabListClass = 'flex max-w-full gap-6 overflow-x-auto border-b border-border';

export function tabClass(on: boolean): string {
  return [
    'inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-[3px] text-sm transition-colors',
    on
      ? 'border-primary font-semibold text-foreground'
      : 'border-transparent text-muted-foreground hover:text-foreground',
  ].join(' ');
}

export const subTabListClass = 'flex max-w-full flex-wrap gap-1';

export function subTabClass(on: boolean): string {
  return [
    'inline-flex h-9 items-center whitespace-nowrap rounded-sm px-3 text-[13px] transition-colors sm:h-8',
    on ? 'bg-secondary font-semibold text-primary' : 'text-muted-foreground hover:text-foreground',
  ].join(' ');
}
