'use client';

import { Ban, CircleCheck, Eye } from 'lucide-react';
import { ToggleGroup, Tooltip } from 'radix-ui';

import { cn } from '@/lib/utils';

export type TriValue = 'edit' | 'read' | 'none';

const SEGMENTS = [
  { value: 'edit', Icon: CircleCheck, on: 'data-[state=on]:text-primary' },
  { value: 'read', Icon: Eye, on: 'data-[state=on]:text-foreground' },
  { value: 'none', Icon: Ban, on: 'data-[state=on]:text-muted-foreground' },
] as const;

const itemClass =
  'inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors ' +
  'data-[state=on]:bg-card data-[state=on]:shadow-sm disabled:pointer-events-none disabled:opacity-35 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * Allowed / Read only / Not allowed. `shape` says which levels the item has: 'E' (action) has no
 * read-only level, 'R' (view-only) has no allowed level; those segments are disabled with a hint.
 */
export function TriStateToggle({
  value,
  onChange,
  shape,
  labels,
  name,
  testId,
}: {
  value: TriValue;
  onChange: (v: TriValue) => void;
  shape: 'RE' | 'E' | 'R';
  labels: { edit: string; read: string; none: string; noRead: string; noEdit: string };
  name: string;
  testId?: string;
}) {
  return (
    <Tooltip.Provider delayDuration={150}>
      <ToggleGroup.Root
        type="single"
        value={value}
        onValueChange={(v) => v && v !== value && onChange(v as TriValue)}
        aria-label={name}
        data-testid={testId}
        className="inline-flex shrink-0 gap-0.5 self-start rounded-[10px] bg-muted p-[3px]"
      >
        {SEGMENTS.map(({ value: seg, Icon, on }) => {
          const hint = seg === 'read' && shape === 'E' ? labels.noRead : seg === 'edit' && shape === 'R' ? labels.noEdit : null;
          const item = (
            <ToggleGroup.Item
              value={seg}
              disabled={hint !== null}
              aria-label={labels[seg]}
              title={hint === null ? labels[seg] : undefined}
              data-testid={testId ? `${testId}-${seg}` : undefined}
              className={cn(itemClass, on)}
            >
              <Icon size={18} aria-hidden="true" />
            </ToggleGroup.Item>
          );
          if (hint === null) return <span key={seg} className="inline-flex">{item}</span>;
          return (
            <Tooltip.Root key={seg}>
              {/* tabIndex span: a disabled button cannot take focus or hover, so it hosts the tooltip */}
              <Tooltip.Trigger asChild>
                <span tabIndex={0} aria-label={hint} className="inline-flex cursor-not-allowed rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {item}
                </span>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content
                  sideOffset={6}
                  className="z-50 max-w-60 rounded-md bg-foreground px-2.5 py-1.5 text-xs text-background"
                >
                  {hint}
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          );
        })}
      </ToggleGroup.Root>
    </Tooltip.Provider>
  );
}
