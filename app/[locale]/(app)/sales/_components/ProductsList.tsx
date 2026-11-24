'use client';

/**
 * FR-94 (CEO feedback §5): the Products tab — the company's product families. A product pre-fills
 * the empty cells of an item row when it is picked there. Everyone with Sales reads the list;
 * people who manage Sales settings add and edit.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/EmptyState';
import { saveSalesProduct } from '@/lib/actions/sales';
import { productLabel } from '@/lib/sales/products';
import type { Product } from '@/lib/sales/types';
import { Field, Tag, useSalesFormat } from './parts';

export function ProductsList({ products, canEdit }: { products: Product[]; canEdit: boolean }) {
  const t = useTranslations('sales');
  const f = useSalesFormat();
  const [adding, setAdding] = useState(false);
  return (
    <div className="flex flex-col gap-4" data-testid="sales-products">
      <p className="max-w-3xl text-sm text-muted-foreground">{t('products.intro')}</p>
      {canEdit ? (
        <div>
          <Button size="sm" variant="outline" onClick={() => setAdding(true)} data-testid="sales-product-add">
            <Plus aria-hidden="true" /> {t('products.add')}
          </Button>
        </div>
      ) : null}
      {products.length === 0 ? (
        <EmptyState message={t('products.empty')} />
      ) : (
        <div className="overflow-x-auto border-b border-border">
          <table className="data-table w-full text-sm">
            <thead>
              <tr>
                <th className="text-start">{t('products.code')}</th>
                <th className="text-start">{t('products.name')}</th>
                <th className="text-end tabular-nums">{t('products.columns')}</th>
                <th className="text-end tabular-nums">{t('products.usedOn')}</th>
                <th className="text-start">{t('products.status')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {products.map((p) => (
                <tr key={p.id} className={p.active ? 'whitespace-nowrap' : 'whitespace-nowrap text-muted-foreground'} data-testid={`sales-product-${p.code ?? p.id}`}>
                  <td dir="ltr" className="text-start">{p.code ?? '—'}</td>
                  <td>
                    <Link href={`/${f.locale}/sales/products/${p.id}`} className="font-medium text-primary hover:underline">
                      <bdi>{productLabel(p, f.locale)}</bdi>
                    </Link>
                  </td>
                  <td className="text-end tabular-nums">{f.number(p.fields.length)}</td>
                  <td className="text-end tabular-nums">{f.number(p.used_count)}</td>
                  <td>{p.active ? <Tag tone="good">{t('products.active')}</Tag> : <Tag>{t('products.inactive')}</Tag>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding ? <NewProductDialog onClose={() => setAdding(false)} /> : null}
    </div>
  );
}

function NewProductDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations('sales');
  const f = useSalesFormat();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [nameFa, setNameFa] = useState('');
  const [nameEn, setNameEn] = useState('');
  async function create() {
    setBusy(true);
    try {
      const out = await saveSalesProduct(null, { code: code.trim() || null, name_fa: nameFa, name_en: nameEn, fields: [] });
      if (!out.ok) { toast.error(out.error); return; }
      router.push(`/${f.locale}/sales/products/${out.id}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('products.add')}</DialogTitle>
          <DialogDescription>{t('products.addHint')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Field label={t('products.nameFa')}><Input maxLength={80} value={nameFa} onChange={(e) => setNameFa(e.target.value)} data-testid="sales-product-name-fa" /></Field>
          <Field label={t('products.nameEn')}><Input dir="ltr" maxLength={80} value={nameEn} onChange={(e) => setNameEn(e.target.value)} data-testid="sales-product-name-en" /></Field>
          <Field label={t('products.code')} hint={t('products.codeHint')}><Input dir="ltr" maxLength={40} value={code} onChange={(e) => setCode(e.target.value)} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
          <Button pending={busy} disabled={busy || !(nameFa.trim() || nameEn.trim())} onClick={() => void create()} data-testid="sales-product-create">{t('products.create')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
