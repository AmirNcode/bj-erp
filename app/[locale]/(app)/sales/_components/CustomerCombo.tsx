'use client';

/**
 * FR-94 §16.7: the company lookup (buyer / client). Typing filters the existing customers;
 * only a picked or created customer is committed. A name that matches nothing ends the list
 * with "Create …", which opens a confirm that first shows similar existing names.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { addSalesCustomer, findSimilarSalesCustomers } from '@/lib/actions/sales';
import type { CustomerRef, SimilarCustomer } from '@/lib/sales/types';
import { cn } from '@/lib/utils';
import { exactCustomer, filterCustomers } from './customerFilter';
import { Select } from './parts';

type Kind = 'government' | 'contractor' | null;

export function CustomerCombo({ customers, value, onChange, testId, ariaLabel, allowCreate = true }: {
  customers: CustomerRef[];
  value: CustomerRef | null;
  onChange: (c: CustomerRef | null) => void;
  testId?: string;
  ariaLabel?: string;
  /** false: only existing customers can be picked (the merge target). */
  allowCreate?: boolean;
}) {
  const t = useTranslations('sales');
  const id = useId();
  const listId = `${id}-list`;
  const [added, setAdded] = useState<CustomerRef[]>([]);
  const [text, setText] = useState(value?.name ?? '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  // A new committed value from outside (a reset, another draft) replaces the shown text.
  const committed = `${value?.id ?? ''}|${value?.name ?? ''}`;
  const [seen, setSeen] = useState(committed);
  if (seen !== committed) { setSeen(committed); setText(value?.name ?? ''); }

  const all = useMemo(() => {
    const ids = new Set(customers.map((c) => c.id));
    return [...customers, ...added.filter((c) => !ids.has(c.id))];
  }, [customers, added]);
  const typed = text.trim();
  const matches = useMemo(() => filterCustomers(all, text), [all, text]);
  const canCreate = allowCreate && typed !== '' && exactCustomer(all, text) === null;
  const count = matches.length + (canCreate ? 1 : 0);

  const commit = (c: CustomerRef | null) => {
    setText(c?.name ?? '');
    setOpen(false);
    onChange(c);
  };
  const revert = () => { setText(value?.name ?? ''); setOpen(false); };
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
              <bdi>{c.name}</bdi>
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
        <NewCustomerDialog
          name={creating}
          onClose={() => { setCreating(null); setText(value?.name ?? ''); }}
          onPicked={(c) => {
            setAdded((prev) => [...prev, c]);
            setCreating(null);
            commit(c);
          }}
        />
      ) : null}
    </div>
  );
}

/** Confirm a new company: similar names first ("use this one"), then create. */
export function NewCustomerDialog({ name: initialName, onClose, onPicked }: {
  name: string; onClose: () => void; onPicked: (c: CustomerRef) => void;
}) {
  const t = useTranslations('sales');
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [kind, setKind] = useState<'' | 'government' | 'contractor'>('');
  const [similar, setSimilar] = useState<SimilarCustomer[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    findSalesSimilar(initialName).then((rows) => { if (live) setSimilar(rows); });
    return () => { live = false; };
  }, [initialName]);

  async function create() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const result = await addSalesCustomer(name.trim(), (kind || null) as Kind);
      if (!result.ok) { toast.error(result.error); return; }
      const { id, name: saved, kind: k } = result.data;
      onPicked({ id, name: saved, kind: k });
      if (!result.data.existed) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md" data-testid="sales-new-customer">
        <DialogHeader>
          <DialogTitle>{t('customerCombo.newTitle')}</DialogTitle>
          <DialogDescription>{t('customerCombo.newHint')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">{t('customerCombo.name')}</span>
            <Input maxLength={200} value={name} onChange={(e) => setName(e.target.value)} data-testid="sales-new-customer-name" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">{t('field.buyer_kind')}</span>
            <Select value={kind} onChange={(v) => setKind(v as typeof kind)}>
              <option value="">—</option>
              <option value="government">{t('customerKind.government')}</option>
              <option value="contractor">{t('customerKind.contractor')}</option>
            </Select>
          </label>
          {similar.length > 0 ? (
            <div className="flex flex-col gap-1 text-sm" data-testid="sales-new-customer-similar">
              <span className="text-xs font-medium text-muted-foreground">{t('customerCombo.similar')}</span>
              <ul className="flex flex-col divide-y divide-border border-y border-border">
                {similar.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 py-2">
                    <bdi className="min-w-0 break-words">{c.name}</bdi>
                    <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={() => onPicked({ id: c.id, name: c.name, kind: c.kind })}>
                      {t('customerCombo.useThis')}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <DialogFooter className="gap-2 max-sm:flex-col-reverse">
          <Button type="button" variant="outline" className="max-sm:h-11" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
          <Button type="button" className="max-sm:h-11" onClick={create} disabled={busy || !name.trim()} data-testid="sales-new-customer-create">
            {t('customerCombo.createAnyway')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

async function findSalesSimilar(name: string): Promise<SimilarCustomer[]> {
  const result = await findSimilarSalesCustomers(name);
  return result.ok ? result.data : [];
}
