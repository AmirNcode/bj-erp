'use client';

/**
 * FR-94 §6c: the engineering items table. One row per item of the record
 * (8997-1), each row expands to its parts (8997-1-1), and those expand again.
 * Numbers are assigned by the database on save and never reused. Each level
 * shows the columns engineering chose for this record; a new column joins the
 * company's column library so the same column can be used on other records.
 */

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/EmptyState';
import {
  createItemColumn, deleteProjectNode, saveProjectNode, setProjectColumns, setSalesItemPrice,
} from '@/lib/actions/sales';
import { BUILTIN_COLUMNS, buildTree, columnsForDepth, isBuiltinColumn, pathTo, type TreeNode } from '@/lib/sales/tree';
import type { Bootstrap, CustomValues, FieldDef, FieldType, NodeRow, RecordRow } from '@/lib/sales/types';
import { cn } from '@/lib/utils';
import { ConfirmDialog, CustomFieldInput, Field, NumberInput, Select, useRun, useSalesFormat } from './parts';

type Draft = {
  description: string; product_type: string; size: string; rating: string; qty: number | null; unit: string;
  custom: CustomValues; unit_price: number | null;
};

const draftOf = (n: NodeRow | null): Draft => ({
  description: n?.description ?? '', product_type: n?.product_type ?? '', size: n?.size ?? '', rating: n?.rating ?? '',
  qty: n?.qty ?? null, unit: n?.unit ?? '', custom: { ...(n?.custom ?? {}) }, unit_price: n?.unit_price ?? null,
});

function countUnder(node: TreeNode): number {
  return node.children.reduce((n, c) => n + 1 + countUnder(c), 0);
}

export function ItemsTab({ boot, record, nodes, focusNode, showPrices = true }: {
  boot: Bootstrap; record: RecordRow; nodes: NodeRow[]; focusNode: string | null;
  /** Stage pages: Technical proposal hides the price columns, Pricing shows them. */
  showPrices?: boolean;
}) {
  const t = useTranslations('sales');
  const tree = useMemo(() => buildTree(nodes), [nodes]);
  const [open, setOpen] = useState<Set<string>>(() => new Set(focusNode ? pathTo(nodes, focusNode) : []));
  const toggle = (id: string) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const itemFields = boot.fields.filter((d) => d.entity === 'item');

  return (
    <div className="flex flex-col gap-3" data-testid="sales-items">
      <p className="text-xs text-muted-foreground">{t('items.hint')}</p>
      <Level
        boot={boot} record={record} fields={itemFields} depth={1} parent={null} rows={tree} showPrices={showPrices}
        open={open} toggle={toggle} focusNode={focusNode} expandParent={(id) => setOpen((prev) => new Set(prev).add(id))}
      />
    </div>
  );
}

function Level({ boot, record, fields, depth, parent, rows, open, toggle, focusNode, expandParent, showPrices }: {
  boot: Bootstrap; record: RecordRow; fields: FieldDef[]; depth: number; parent: TreeNode | null; rows: TreeNode[]; showPrices: boolean;
  open: Set<string>; toggle: (id: string) => void; focusNode: string | null; expandParent: (id: string) => void;
}) {
  const t = useTranslations('sales');
  const f = useSalesFormat();
  const { run, pending } = useRun();
  const canEdit = boot.caps.items_edit;
  const prices = showPrices && boot.caps.prices && depth === 1;
  const columns = columnsForDepth(record.item_columns, depth).filter((k) => isBuiltinColumn(k) || fields.some((d) => d.key === k));
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(draftOf(null));
  const [removing, setRemoving] = useState<TreeNode | null>(null);
  const [columnDialog, setColumnDialog] = useState(false);

  const label = (key: string) => (isBuiltinColumn(key) ? t(`items.col.${key}`) : f.fieldLabel(fields.find((d) => d.key === key)!));
  const saveColumns = (keys: string[]) => {
    // Store every level's effective columns, so changing one level never resets another.
    const next: Record<string, string[]> = { ...(record.item_columns ?? {}) };
    next[String(depth)] = keys;
    return run(() => setProjectColumns(record.id, next));
  };
  const cell = (n: TreeNode, key: string) => {
    if (key === 'qty') return f.number(n.qty);
    if (isBuiltinColumn(key)) return n[key] ?? '—';
    return f.custom(fields.find((d) => d.key === key)!, n.custom[key]);
  };
  const begin = (n: TreeNode | null) => { setDraft(draftOf(n)); setEditing(n ? n.id : 'new'); };

  async function save(n: TreeNode | null) {
    const patch = {
      description: draft.description || null, product_type: draft.product_type || null, size: draft.size || null,
      rating: draft.rating || null, qty: draft.qty, unit: draft.unit || null, custom: draft.custom,
    };
    await run(async () => {
      const saved = await saveProjectNode(record.id, n?.id ?? null, parent?.id ?? null, patch);
      if (!saved.ok) return saved;
      if (prices && boot.caps.prices_edit && draft.unit_price !== (n?.unit_price ?? null)) {
        return setSalesItemPrice(saved.id, draft.unit_price);
      }
      return saved;
    }, () => { setEditing(null); if (parent) expandParent(parent.id); });
  }

  const editor = (n: TreeNode | null) => (
    <tr className="bg-secondary/40 align-top" data-testid="sales-item-editor">
      <td className="whitespace-nowrap text-muted-foreground" dir="ltr">{n ? n.code : t('items.newNumber')}</td>
      <td><Input autoFocus value={draft.description} maxLength={2000} aria-label={t('items.col.description')} onChange={(e) => setDraft({ ...draft, description: e.target.value })} data-testid="sales-item-description" /></td>
      {columns.map((key) => (
        <td key={key}>
          {key === 'qty' ? (
            <NumberInput value={draft.qty} onChange={(v) => setDraft({ ...draft, qty: v })} ariaLabel={label(key)} className="w-24" />
          ) : isBuiltinColumn(key) ? (
            <Input value={String(draft[key] ?? '')} maxLength={200} aria-label={label(key)} className="min-w-28" onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
          ) : (
            <div className="min-w-32">
              <CustomFieldInput def={fields.find((d) => d.key === key)!} value={draft.custom[key]} onChange={(v) => {
                const custom = { ...draft.custom };
                if (v === null) delete custom[key]; else custom[key] = v;
                setDraft({ ...draft, custom });
              }} />
            </div>
          )}
        </td>
      ))}
      {prices ? (
        <>
          <td>{boot.caps.prices_edit ? <NumberInput value={draft.unit_price} onChange={(v) => setDraft({ ...draft, unit_price: v })} ariaLabel={t('items.unitPrice')} className="w-32" /> : f.number(n?.unit_price)}</td>
          <td />
        </>
      ) : null}
      <td className="whitespace-nowrap text-end">
        <Button size="sm" disabled={pending} onClick={() => void save(n)} data-testid="sales-item-save">{t('save')}</Button>{' '}
        <Button size="sm" variant="outline" disabled={pending} onClick={() => setEditing(null)}>{t('cancel')}</Button>
      </td>
    </tr>
  );

  return (
    <div className={cn('flex flex-col gap-2', depth > 1 && 'border-s-[3px] border-border ps-3')}>
      {rows.length === 0 && editing !== 'new' ? (
        <EmptyState message={depth === 1 ? t('items.empty') : t('items.emptyParts')} />
      ) : (
        <div className="overflow-x-auto border-b border-border">
          <table className="data-table w-full text-sm">
            <thead>
              <tr>
                <th className="text-start">{t('items.col.no')}</th>
                <th className="text-start">{t('items.col.description')}</th>
                {columns.map((key) => (
                  <th key={key} className={cn(key === 'qty' ? 'text-end tabular-nums' : 'text-start')}>
                    <span className="inline-flex items-center gap-1">
                      {label(key)}
                      {canEdit ? (
                        <button type="button" className="text-muted-foreground hover:text-destructive" aria-label={t('items.hideColumn', { name: label(key) })}
                          disabled={pending} onClick={() => void saveColumns(columns.filter((k) => k !== key))}>
                          <X className="size-3" aria-hidden="true" />
                        </button>
                      ) : null}
                    </span>
                  </th>
                ))}
                {prices ? (
                  <>
                    <th className="text-end tabular-nums">{t('items.unitPrice')}</th>
                    <th className="text-end tabular-nums">{t('items.lineTotal')}</th>
                  </>
                ) : null}
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((n) => {
                const isOpen = open.has(n.id);
                const Chevron = isOpen ? ChevronDown : f.locale === 'fa' ? ChevronLeft : ChevronRight;
                return editing === n.id ? (
                  <RowFragment key={n.id}>{editor(n)}</RowFragment>
                ) : (
                  <RowFragment key={n.id}>
                    <tr className={cn('whitespace-nowrap', focusNode === n.id && 'bg-warning-foreground')} data-testid={`sales-item-${n.code}`}>
                      <td>
                        <button type="button" className="inline-flex items-center gap-1 font-semibold tabular-nums" onClick={() => toggle(n.id)}
                          aria-expanded={isOpen} aria-label={t('items.toggle', { code: n.code })}>
                          <Chevron className="size-4 text-muted-foreground" aria-hidden="true" />
                          <bdi dir="ltr">{n.code}</bdi>
                          {n.children.length > 0 ? <span className="text-xs font-normal text-muted-foreground">({f.number(n.children.length)})</span> : null}
                        </button>
                      </td>
                      <td className="max-w-80 truncate whitespace-normal">{n.description ? <bdi>{n.description}</bdi> : <span className="text-muted-foreground">—</span>}</td>
                      {columns.map((key) => <td key={key} className={key === 'qty' ? 'text-end tabular-nums' : undefined}>{cell(n, key)}</td>)}
                      {prices ? (
                        <>
                          <td className="text-end tabular-nums">{f.number(n.unit_price)}</td>
                          <td className="text-end tabular-nums">{typeof n.unit_price === 'number' ? f.number((n.qty ?? 1) * n.unit_price) : '—'}</td>
                        </>
                      ) : null}
                      <td className="text-end">
                        {canEdit || (prices && boot.caps.prices_edit) ? (
                          <Button size="xs" variant="ghost" onClick={() => begin(n)} data-testid={`sales-item-edit-${n.code}`}>{t('action.edit')}</Button>
                        ) : null}
                        {canEdit ? <Button size="xs" variant="ghost" className="text-destructive" onClick={() => setRemoving(n)}>{t('remove')}</Button> : null}
                      </td>
                    </tr>
                    {isOpen ? (
                      <tr className="hover:!bg-transparent">
                        <td colSpan={columns.length + (prices ? 5 : 3)} className="!py-3">
                          <Level boot={boot} record={record} fields={fields} depth={depth + 1} parent={n} rows={n.children} showPrices={showPrices}
                            open={open} toggle={toggle} focusNode={focusNode} expandParent={expandParent} />
                        </td>
                      </tr>
                    ) : null}
                  </RowFragment>
                );
              })}
              {editing === 'new' ? editor(null) : null}
            </tbody>
          </table>
        </div>
      )}
      {canEdit && editing === null ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => begin(null)} data-testid={`sales-item-add-${depth}`}>
            <Plus aria-hidden="true" /> {depth === 1 ? t('items.addRow') : t('items.addPart', { code: parent?.code ?? '' })}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setColumnDialog(true)} data-testid={`sales-item-add-column-${depth}`}>
            <Plus aria-hidden="true" /> {t('items.addColumn')}
          </Button>
        </div>
      ) : null}

      {removing ? (
        <ConfirmDialog
          title={t('items.removeTitle', { code: removing.code })}
          body={countUnder(removing) > 0 ? t('items.removeBodyChildren', { count: countUnder(removing) }) : t('items.removeBody')}
          confirmLabel={t('remove')} cancelLabel={t('cancel')} pending={pending}
          onClose={() => setRemoving(null)}
          onConfirm={() => void run(() => deleteProjectNode(removing.id), () => setRemoving(null))}
        />
      ) : null}
      {columnDialog ? (
        <ColumnDialog fields={fields} shown={columns} canCreate={canEdit} pending={pending}
          onClose={() => setColumnDialog(false)}
          onPick={(key) => void saveColumns([...columns, key]).then((ok) => { if (ok) setColumnDialog(false); })}
          onCreate={(labelFa, labelEn, type) => void run(
            () => createItemColumn(record.id, depth, { ...(record.item_columns ?? {}), [String(depth)]: columns },
              { label_fa: labelFa, label_en: labelEn, type }),
            () => setColumnDialog(false))}
        />
      ) : null}
    </div>
  );
}

function RowFragment({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

/** Show an existing column at this level, or add a new one to the company's column library. */
function ColumnDialog({ fields, shown, canCreate, pending, onClose, onPick, onCreate }: {
  fields: FieldDef[]; shown: string[]; canCreate: boolean; pending: boolean; onClose: () => void;
  onPick: (key: string) => void; onCreate: (labelFa: string, labelEn: string, type: FieldType) => void;
}) {
  const t = useTranslations('sales');
  const f = useSalesFormat();
  const available = [
    ...BUILTIN_COLUMNS.filter((k) => !shown.includes(k)).map((k) => ({ key: k as string, label: t(`items.col.${k}`) })),
    ...fields.filter((d) => d.active && !shown.includes(d.key)).map((d) => ({ key: d.key, label: f.fieldLabel(d) })),
  ];
  const [pick, setPick] = useState(available[0]?.key ?? '');
  const [labelFa, setLabelFa] = useState('');
  const [labelEn, setLabelEn] = useState('');
  const [type, setType] = useState<FieldType>('text');
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('items.addColumn')}</DialogTitle>
          <DialogDescription>{t('items.columnIntro')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-5">
          {available.length > 0 ? (
            <div className="flex items-end gap-2">
              <Field label={t('items.existingColumn')} className="flex-1">
                <Select value={pick} onChange={setPick}>
                  {available.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                </Select>
              </Field>
              <Button variant="outline" disabled={pending || !pick} onClick={() => onPick(pick)} data-testid="sales-column-show">{t('items.showColumn')}</Button>
            </div>
          ) : null}
          {canCreate ? (
            <div className="flex flex-col gap-3 border-t border-border pt-4">
              <p className="text-sm font-semibold">{t('items.newColumn')}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('settings.labelFa')}><Input maxLength={80} value={labelFa} onChange={(e) => setLabelFa(e.target.value)} data-testid="sales-column-label-fa" /></Field>
                <Field label={t('settings.labelEn')}><Input dir="ltr" maxLength={80} value={labelEn} onChange={(e) => setLabelEn(e.target.value)} /></Field>
                <Field label={t('settings.fieldType')}>
                  <Select value={type} onChange={(v) => setType(v as FieldType)}>
                    {(['text', 'number', 'date', 'yes_no'] as const).map((k) => <option key={k} value={k}>{t(`fieldType.${k}`)}</option>)}
                  </Select>
                </Field>
              </div>
              <p className="text-xs text-muted-foreground">{t('items.newColumnHint')}</p>
              <div>
                <Button disabled={pending || !(labelFa.trim() || labelEn.trim())} onClick={() => onCreate(labelFa.trim(), labelEn.trim(), type)} data-testid="sales-column-create">
                  {t('items.createColumn')}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
