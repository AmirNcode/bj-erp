'use client';

/**
 * FR-94 §16.7: the company lookup (buyer / client). Typing filters the existing customers;
 * only a picked or created customer is committed. A name that matches nothing ends the list
 * with "Create …" (callers with the `customers` cap), which opens the full customer form.
 */

import { useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { customerLabel } from '@/lib/sales/customerLabel';
import type { CustomerRef } from '@/lib/sales/types';
import { cn } from '@/lib/utils';
import { useViewAs } from '../../_components/ViewAsContext';
import { CustomerForm } from './CustomerForm';
import { exactCustomer, filterCustomers } from './customerFilter';
import { Tag } from './parts';

export function CustomerCombo({ customers, value, onChange, testId, ariaLabel, allowCreate = false }: {
  customers: CustomerRef[];
  value: CustomerRef | null;
  onChange: (c: CustomerRef | null) => void;
  testId?: string;
  ariaLabel?: string;
  /** true (callers pass `boot.caps.customers`): the list ends with "Create …". Default: pick only. */
  allowCreate?: boolean;
}) {
  const t = useTranslations('sales');
  const locale = useLocale();
  const router = useRouter();
  const viewAs = useViewAs();
  const id = useId();
  const listId = `${id}-list`;
  const [added, setAdded] = useState<CustomerRef[]>([]);
  const label = (c: CustomerRef | null) => customerLabel(c, locale);
  const [text, setText] = useState(label(value));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  // A new committed value from outside (a reset, another draft) replaces the shown text.
  const committed = `${value?.id ?? ''}|${label(value)}`;
  const [seen, setSeen] = useState(committed);
  if (seen !== committed) { setSeen(committed); setText(label(value)); }

  const all = useMemo(() => {
    const ids = new Set(customers.map((c) => c.id));
    return [...customers, ...added.filter((c) => !ids.has(c.id))];
  }, [customers, added]);
  const typed = text.trim();
  const matches = useMemo(() => filterCustomers(all, text), [all, text]);
  const canCreate = allowCreate && viewAs === null && typed !== '' && exactCustomer(all, text) === null;
  const count = matches.length + (canCreate ? 1 : 0);

  const commit = (c: CustomerRef | null) => {
    setText(label(c));
    setOpen(false);
    onChange(c);
  };
  const revert = () => { setText(label(value)); setOpen(false); };
  const pickAt = (i: number) => {
    if (i < matches.length) commit(matches[i]);
    else if (canCreate) { setOpen(false); setCreating(typed); }
  };

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) { setOpen(true); setActive(0); } else setActive((a) => Math.min(a + 1, count - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && count > 0) { e.preventDefault(); pickAt(active); }
      else if (open) e.preventDefault();
    } else if (e.key === 'Escape') {
      if (open) { e.preventDefault(); e.stopPropagation(); revert(); }
    }
  }

  function onBlur(e: React.FocusEvent) {
    if (wrap.current?.contains(e.relatedTarget as Node | null)) return;
    if (creating !== null) return;
    if (text.trim() === '') { if (value) onChange(null); setOpen(false); return; }
    const exact = exactCustomer(all, text);
    if (exact) { if (exact.id !== value?.id) commit(exact); else revert(); return; }
    revert();
  }

  const optionId = (i: number) => `${id}-opt-${i}`;

  return (
    <div ref={wrap} className="relative" onBlur={onBlur}>
      <Input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && count > 0 ? optionId(Math.min(active, count - 1)) : undefined}
        aria-label={ariaLabel}
        autoComplete="off"
        maxLength={200}
        value={text}
        placeholder={t('customerCombo.placeholder')}
        data-testid={testId}
        onChange={(e) => { setText(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-50 mt-1 max-h-60 overflow-y-auto border border-border bg-popover text-sm text-popover-foreground"
        >
          {matches.map((c, i) => (
            <li
              key={c.id}
              id={optionId(i)}
              role="option"
              aria-selected={c.id === value?.id}
              className={cn('cursor-pointer px-3 py-2', i === active && 'bg-accent text-accent-foreground')}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pickAt(i)}
            >
              <span className="flex items-center gap-2">
                <bdi>{label(c)}</bdi>
                {c.incomplete ? <Tag tone="warn">{t('customerProfile.incomplete')}</Tag> : null}
              </span>
            </li>
          ))}
          {canCreate ? (
            <li
              id={optionId(matches.length)}
              role="option"
              aria-selected={false}
              className={cn('cursor-pointer border-t border-border px-3 py-2 font-medium text-primary', matches.length === active && 'bg-accent')}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(matches.length)}
              onClick={() => pickAt(matches.length)}
              data-testid="sales-combo-create"
            >
              {t('customerCombo.create', { name: typed })}
            </li>
          ) : null}
          {count === 0 ? <li role="presentation" className="px-3 py-2 text-muted-foreground">{t('customerCombo.noMatch')}</li> : null}
        </ul>
      ) : null}
      {creating !== null ? (
        <CustomerForm
          customerId={null}
          initialName={creating}
          customers={all}
          onClose={() => { setCreating(null); setText(label(value)); }}
          onUse={(c) => { setCreating(null); commit(c); }}
          onSaved={(p) => {
            const ref: CustomerRef = { id: p.id, name: p.name, name_en: p.name_en, kind: p.kind, incomplete: p.missing.length > 0 };
            setAdded((prev) => [...prev, ref]);
            setCreating(null);
            commit(ref);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Resolve a picked customer id for a CustomerCombo value. A customer created from the picker is not in
 * `boot.customers` until the page refreshes; remembering it keeps the field's text in the meantime.
 */
export function useCustomerRefs(customers: CustomerRef[]) {
  const [extra, setExtra] = useState<CustomerRef[]>([]);
  const byId = (id: string | null | undefined): CustomerRef | null =>
    id ? (customers.find((c) => c.id === id) ?? extra.find((c) => c.id === id) ?? null) : null;
  const remember = (c: CustomerRef | null) => {
    if (c && !customers.some((x) => x.id === c.id)) setExtra((prev) => [...prev.filter((x) => x.id !== c.id), c]);
  };
  return { byId, remember };
}
