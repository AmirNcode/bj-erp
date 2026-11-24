'use client';

/**
 * FR-94 (CEO feedback §5): one product — its names, code and the ordered item columns it uses,
 * each with an optional default. Defaults are COPIED onto an item row when the product is picked
 * there (only into empty cells); editing a product never touches rows already saved.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowDown, ArrowUp, ChevronLeft, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { deleteSalesProduct, saveSalesField, saveSalesProduct } from '@/lib/actions/sales';
import { BUILTIN_COLUMNS, isBuiltinColumn } from '@/lib/sales/tree';
import type { Bootstrap, CustomValues, FieldType, Product } from '@/lib/sales/types';
import { ConfirmDialog, CustomFieldInput, Field, NumberInput, Select, useRun, useSalesFormat } from './parts';

type Row = Product['fields'][number];
/** The product's own columns are the built-ins a product can default (not the item "type"). */
const PRODUCT_BUILTINS = BUILTIN_COLUMNS.filter((k) => k !== 'product_type');

export function ProductEditor({ product, boot }: { product: Product; boot: Bootstrap }) {
  const t = useTranslations('sales');
  const f = useSalesFormat();
  const router = useRouter();
  const { run, pending } = useRun();
  const can = boot.caps.settings;
  const library = boot.fields.filter((d) => d.entity === 'item');
  const [nameFa, setNameFa] = useState(product.name_fa);
  const [nameEn, setNameEn] = useState(product.name_en);
  const [code, setCode] = useState(product.code ?? '');
  const [active, setActive] = useState(product.active);
  const [rows, setRows] = useState<Row[]>(product.fields);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newColumn, setNewColumn] = useState(false);

  const def = (key: string) => library.find((d) => d.key === key);
  const label = (key: string) => (isBuiltinColumn(key) ? t(`items.col.${key}`) : def(key) ? f.fieldLabel(def(key)!) : key);
  const available = [
    ...PRODUCT_BUILTINS.filter((k) => !rows.some((r) => r.field === k)).map((k) => ({ key: String(k), label: t(`items.col.${k}`) })),
    ...library.filter((d) => d.active && !rows.some((r) => r.field === d.key)).map((d) => ({ key: d.key, label: f.fieldLabel(d) })),
  ];
  const [pick, setPick] = useState('');
  const setDefault = (field: string, value: Row['default']) =>
    setRows((prev) => prev.map((r) => (r.field === field ? { ...r, default: value } : r)));
  const move = (i: number, by: number) => setRows((prev) => {
    const next = [...prev];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    return next;
  });
  const dirty = nameFa !== product.name_fa || nameEn !== product.name_en || code !== (product.code ?? '')
    || active !== product.active || JSON.stringify(rows) !== JSON.stringify(product.fields);

  const save = () => run(() => saveSalesProduct(product.id, {
    code: code.trim() || null, name_fa: nameFa, name_en: nameEn, active,
    fields: rows.map((r) => ({ field: r.field, default: r.default })),
  }));

  const editor = (r: Row) => {
    if (r.field === 'qty') {
      return <NumberInput value={typeof r.default === 'number' ? r.default : null} ariaLabel={label(r.field)} className="w-28"
        disabled={!can} onChange={(v) => setDefault(r.field, v)} />;
    }
    if (isBuiltinColumn(r.field)) {
      return <Input value={typeof r.default === 'string' ? r.default : ''} maxLength={r.field === 'unit' ? 40 : 200} aria-label={label(r.field)}
        disabled={!can} className="min-w-40" onChange={(e) => setDefault(r.field, e.target.value || null)} />;
    }
    const d = def(r.field);
    if (!d) return <span className="text-muted-foreground">{r.default === null ? '—' : String(r.default)}</span>;
    return (
      <div className="min-w-40">
        <CustomFieldInput def={d} value={(r.default ?? undefined) as CustomValues[string] | undefined} onChange={(v) => setDefault(r.field, v)} />
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-6" data-testid="sales-product">
      <div className="flex flex-col gap-3">
        <Link href={`/${f.locale}/sales/products`} className="inline-flex w-fit items-center gap-1 text-sm text-primary">
          <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden="true" /> {t('products.back')}
        </Link>
        <h2 className="text-lg font-bold"><bdi>{(f.locale === 'fa' ? product.name_fa : product.name_en) || product.name_fa}</bdi></h2>
        {!can ? <p className="text-sm text-muted-foreground">{t('products.readOnly')}</p> : null}
      </div>

      <div className="grid max-w-3xl gap-3 sm:grid-cols-2">
        <Field label={t('products.nameFa')}><Input maxLength={80} value={nameFa} disabled={!can} onChange={(e) => setNameFa(e.target.value)} data-testid="sales-product-name-fa" /></Field>
        <Field label={t('products.nameEn')}><Input dir="ltr" maxLength={80} value={nameEn} disabled={!can} onChange={(e) => setNameEn(e.target.value)} data-testid="sales-product-name-en" /></Field>
        <Field label={t('products.code')} hint={t('products.codeHint')}><Input dir="ltr" maxLength={40} value={code} disabled={!can} onChange={(e) => setCode(e.target.value)} /></Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" className="size-4" checked={active} disabled={!can} onChange={(e) => setActive(e.target.checked)} />
          {t('products.activeHint')}
        </label>
      </div>

      <section className="flex flex-col gap-3">
        <div>
          <h3 className="text-sm font-semibold">{t('products.columnsTitle')}</h3>
          <p className="max-w-3xl text-sm text-muted-foreground">{t('products.columnsHint')}</p>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('products.noColumns')}</p>
        ) : (
          <div className="overflow-x-auto border-b border-border">
            <table className="data-table w-full text-sm" data-testid="sales-product-columns">
              <thead>
                <tr>
                  {can ? <th /> : null}
                  <th className="text-start">{t('products.column')}</th>
                  <th className="text-start">{t('products.default')}</th>
                  {can ? <th /> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r, i) => (
                  <tr key={r.field} data-testid={`sales-product-col-${r.field}`}>
                    {can ? (
                      <td className="whitespace-nowrap">
                        <Button size="icon-sm" variant="ghost" disabled={i === 0} aria-label={t('settings.moveUp')} onClick={() => move(i, -1)}><ArrowUp /></Button>
                        <Button size="icon-sm" variant="ghost" disabled={i === rows.length - 1} aria-label={t('settings.moveDown')} onClick={() => move(i, 1)}><ArrowDown /></Button>
                      </td>
                    ) : null}
                    <td className="font-medium">{label(r.field)}</td>
                    <td>{editor(r)}</td>
                    {can ? (
                      <td className="text-end">
                        <Button size="icon-sm" variant="ghost" className="text-destructive" aria-label={t('products.removeColumn', { name: label(r.field) })}
                          onClick={() => setRows((prev) => prev.filter((x) => x.field !== r.field))}><X /></Button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {can ? (
          <div className="flex flex-wrap items-end gap-2">
            {available.length > 0 ? (
              <>
                <Field label={t('products.addColumn')} className="w-60">
                  <Select value={pick} onChange={setPick} testId="sales-product-pick-column">
                    <option value="">—</option>
                    {available.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                  </Select>
                </Field>
                <Button variant="outline" disabled={!pick} onClick={() => { setRows((prev) => [...prev, { field: pick, default: null }]); setPick(''); }} data-testid="sales-product-add-column">
                  <Plus aria-hidden="true" /> {t('products.addColumnButton')}
                </Button>
              </>
            ) : null}
            <Button variant="ghost" onClick={() => setNewColumn(true)} data-testid="sales-product-new-column">
              <Plus aria-hidden="true" /> {t('products.newColumn')}
            </Button>
          </div>
        ) : null}
      </section>

      {can ? (
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <Button pending={pending} disabled={pending || !dirty || !(nameFa.trim() || nameEn.trim())} onClick={() => void save()} data-testid="sales-product-save">{t('save')}</Button>
          <Button pending={pending} variant="outline" className="text-destructive sm:ms-auto" disabled={pending} onClick={() => setConfirmDelete(true)} data-testid="sales-product-delete">
            {t('products.delete')}
          </Button>
        </div>
      ) : null}
      {product.used_count > 0 ? <p className="text-xs text-muted-foreground">{t('products.usedHint', { count: product.used_count })}</p> : null}

      {confirmDelete ? (
        <ConfirmDialog title={t('products.deleteTitle')} body={t('products.deleteBody')} confirmLabel={t('products.delete')} cancelLabel={t('cancel')} pending={pending}
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => void deleteSalesProduct(product.id).then((out) => {
            if (!out.ok) { toast.error(out.error); setConfirmDelete(false); return; }
            router.push(`/${f.locale}/sales/products`);
          })} />
      ) : null}
      {newColumn ? <NewColumnDialog pending={pending} onClose={() => setNewColumn(false)}
        onCreate={(fa, en, type) => run(() => saveSalesField(null, { entity: 'item', label_fa: fa, label_en: en, type }), () => setNewColumn(false))} /> : null}
    </div>
  );
}

/** A new item column joins the company's library (same rules as Add column on an item table). */
function NewColumnDialog({ pending, onClose, onCreate }: {
  pending: boolean; onClose: () => void; onCreate: (fa: string, en: string, type: FieldType) => Promise<boolean>;
}) {
  const t = useTranslations('sales');
  const [fa, setFa] = useState('');
  const [en, setEn] = useState('');
  const [type, setType] = useState<FieldType>('text');
  return (
    <DialogShell title={t('products.newColumn')} body={t('products.newColumnHint')} onClose={onClose}
      action={<Button pending={pending} disabled={pending || !(fa.trim() || en.trim())} onClick={() => void onCreate(fa.trim(), en.trim(), type)} data-testid="sales-product-column-create">{t('items.createColumn')}</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('settings.labelFa')}><Input maxLength={80} value={fa} onChange={(e) => setFa(e.target.value)} data-testid="sales-product-column-fa" /></Field>
        <Field label={t('settings.labelEn')}><Input dir="ltr" maxLength={80} value={en} onChange={(e) => setEn(e.target.value)} /></Field>
        <Field label={t('settings.fieldType')}>
          <Select value={type} onChange={(v) => setType(v as FieldType)}>
            {(['text', 'number', 'date', 'yes_no'] as const).map((k) => <option key={k} value={k}>{t(`fieldType.${k}`)}</option>)}
          </Select>
        </Field>
      </div>
    </DialogShell>
  );
}

function DialogShell({ title, body, children, action, onClose }: {
  title: string; body: string; children: React.ReactNode; action: React.ReactNode; onClose: () => void;
}) {
  const t = useTranslations('sales');
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('close')}</Button>
          {action}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
