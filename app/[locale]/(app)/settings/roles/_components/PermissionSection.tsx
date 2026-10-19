'use client';

import { Check, ChevronDown, TriangleAlert } from 'lucide-react';
import { Collapsible, DropdownMenu, ToggleGroup } from 'radix-ui';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TriStateToggle, type TriValue } from '@/components/ui/tri-state-toggle';
import {
  SECTIONS,
  SHAPES,
  applyLevel,
  applySectionBulk,
  sectionSummary,
  type Perms,
  type PermKey,
  type SectionChoice,
  type SectionKey,
} from '@/lib/permissions/catalog';

/** Why a row changed on its own: another item needed it (raised) or it needed a removed item (lowered). */
export type PermNote = { kind: 'raised' | 'lowered'; by: PermKey };

const BULK_CHOICES = ['allow', 'read', 'none'] as const;

export function PermissionSection({
  section,
  perms,
  onChange,
  notes,
  t,
  defaultOpen,
}: {
  section: SectionKey;
  perms: Perms;
  onChange: (perms: Perms, raised: PermKey[], lowered: PermKey[]) => void;
  /** Rows changed by a dependency, keyed by the row; `by` may be an item of another section. */
  notes: Partial<Record<PermKey, PermNote>>;
  t: {
    title: string;
    /** Labels for all 16 keys: a note can name an item from another section. */
    items: Record<PermKey, { label: string; description: string }>;
    levels: { edit: string; read: string; none: string; noRead: string; noEdit: string; yes: string; no: string };
    summary: Record<SectionChoice, string>;
    raisedBy: (byLabel: string) => string;
    loweredBy: (byLabel: string) => string;
    sensitive: string;
  };
  defaultOpen?: boolean;
}) {
  const items = SECTIONS.find((s) => s.key === section)!.items;
  const summary = sectionSummary(perms, section);

  const setRow = (key: PermKey, v: TriValue) => {
    const r = applyLevel(perms, key, v === 'none' ? null : v);
    onChange(r.perms, r.raised, r.lowered);
  };
  const setBulk = (choice: (typeof BULK_CHOICES)[number]) => {
    const r = applySectionBulk(perms, section, choice);
    onChange(r.perms, r.raised, r.lowered);
  };

  return (
    <Collapsible.Root defaultOpen={defaultOpen} className="rounded-xl border bg-card" data-testid={`perm-block-${section}`}>
      <div className="flex items-center gap-3 px-4 py-3">
        <Collapsible.Trigger className="group flex min-h-10 min-w-0 flex-1 items-center gap-3 rounded-md text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {/* The wrapper mirrors the whole rotated chevron in RTL (a closed section points inline-end). */}
          <span className="inline-flex rtl:-scale-x-100">
            <ChevronDown className="size-4 transition-transform group-data-[state=closed]:-rotate-90" aria-hidden="true" />
          </span>
          <span className="truncate font-semibold">{t.title}</span>
          <Badge variant="secondary" data-testid={`perm-section-count-${section}`}>{items.length}</Badge>
        </Collapsible.Trigger>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button variant="outline" size="sm" className="h-10 shrink-0" data-testid={`perm-section-${section}`}>
              {t.summary[summary]}
              <ChevronDown aria-hidden="true" />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              className="z-50 min-w-40 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
            >
              {BULK_CHOICES.map((choice) => (
                <DropdownMenu.Item
                  key={choice}
                  onSelect={() => setBulk(choice)}
                  data-testid={`perm-section-${section}-${choice}`}
                  className="flex min-h-10 cursor-pointer items-center justify-between gap-3 rounded-md px-3 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                >
                  {t.summary[choice]}
                  {summary === choice && <Check className="size-4" aria-hidden="true" />}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      <Collapsible.Content>
        {items.map((k) => {
          const note = notes[k];
          const level = perms[k];
          return (
            <div
              key={k}
              className="flex flex-col gap-2 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              data-testid={`perm-row-${k}`}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {t.items[k].label}
                  {SHAPES[k] !== 'R' && (
                    <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400" data-testid={`perm-sensitive-${k}`}>
                      <TriangleAlert className="size-4" aria-hidden="true" />
                      {t.sensitive}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">{t.items[k].description}</div>
                {note && (
                  <div className="mt-1 text-xs text-primary">
                    {note.kind === 'raised'
                      ? t.raisedBy(t.items[note.by]?.label ?? '')
                      : t.loweredBy(t.items[note.by]?.label ?? '')}
                  </div>
                )}
              </div>
              {k === 'approval_delegate' ? (
                <ToggleGroup.Root
                  type="single"
                  value={level === 'edit' ? 'edit' : 'none'}
                  onValueChange={(v) => { if (v === 'edit' || v === 'none') setRow(k, v); }}
                  aria-label={t.items[k].label}
                  data-testid={`perm-${k}`}
                  className="inline-flex shrink-0 self-start rounded-lg bg-muted p-1"
                >
                  {(['edit', 'none'] as const).map((v) => (
                    <ToggleGroup.Item key={v} value={v} data-testid={`perm-${k}-${v}`} className="min-h-10 min-w-16 rounded-md px-3 text-sm data-[state=on]:bg-card data-[state=on]:font-semibold data-[state=on]:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {v === 'edit' ? t.levels.yes : t.levels.no}
                    </ToggleGroup.Item>
                  ))}
                </ToggleGroup.Root>
              ) : <TriStateToggle
                value={level ?? 'none'}
                onChange={(v) => setRow(k, v)}
                shape={SHAPES[k]}
                labels={t.levels}
                name={t.items[k].label}
                testId={`perm-${k}`}
              />}
            </div>
          );
        })}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
