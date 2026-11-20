'use client';

/**
 * FR-94 (CEO feedback §5.3): the Type cell of an item row is a product picked from the list
 * (owner rule: known values are picked, not typed). "Other…" keeps a one-off free-text type.
 */

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { productLabel } from '@/lib/sales/products';
import type { Product } from '@/lib/sales/types';
import { Select, useSalesFormat, useSalesProducts } from './parts';

const OTHER = '__other';

export function ProductPicker({ productId, productType, onPick, onOther }: {
  productId: string | null;
  productType: string;
  /** A product was chosen: the caller copies its defaults into the empty cells. */
  onPick: (product: Product) => void;
  /** None / Other: the product link is cleared, `type` is the typed one-off text. */
  onOther: (type: string) => void;
}) {
  const t = useTranslations('sales');
  const f = useSalesFormat();
  const products = useSalesProducts();
  const [other, setOther] = useState(productId === null && productType !== '');
  const [query, setQuery] = useState('');
  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products
      .filter((p) => p.id === productId || (p.active && (q === '' || `${p.code ?? ''} ${p.name_fa} ${p.name_en}`.toLowerCase().includes(q))))
      .sort((a, b) => a.position - b.position);
  }, [products, productId, query]);
  const value = productId ?? (other ? OTHER : '');
  return (
    <div className="flex min-w-40 flex-col gap-1" data-testid="sales-product-picker">
      {products.length > 10 ? (
        <Input value={query} aria-label={t('items.productSearch')} placeholder={t('items.productSearch')} onChange={(e) => setQuery(e.target.value)} />
      ) : null}
      <Select
        value={value}
        ariaLabel={t('items.col.product_type')}
        testId="sales-product-select"
        onChange={(v) => {
          if (v === '') { setOther(false); onOther(''); return; }
          if (v === OTHER) { setOther(true); onOther(productType); return; }
          const p = products.find((x) => x.id === v);
          if (p) { setOther(false); onPick(p); }
        }}
      >
        <option value="">—</option>
        {options.map((p) => (
          <option key={p.id} value={p.id}>{p.code ? `${p.code} · ` : ''}{productLabel(p, f.locale)}{p.active ? '' : ` (${t('products.inactive')})`}</option>
        ))}
        <option value={OTHER}>{t('items.productOther')}</option>
      </Select>
      {value === OTHER ? (
        <Input value={productType} maxLength={200} aria-label={t('items.col.product_type')} onChange={(e) => onOther(e.target.value)} data-testid="sales-product-other" />
      ) : null}
    </div>
  );
}
