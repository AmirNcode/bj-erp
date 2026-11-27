/** ERP › Sales (CEO feedback §5): one product. Guarded by the module layout; an unknown id is a 404. */

export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getProductHistory, listSalesProducts } from '@/lib/actions/sales';
import { loadSalesBootstrap } from '../../_components/load';
import { HistoryList } from '../../_components/HistoryList';
import { ProductEditor } from '../../_components/ProductEditor';

type Props = { params: Promise<{ locale: string; id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SalesProductPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  if (!UUID.test(id)) notFound();
  const [boot, products, history, t] = await Promise.all([loadSalesBootstrap(), listSalesProducts(), getProductHistory(id), getTranslations('sales')]);
  if (!products.ok) notFound();
  const product = products.data.find((p) => p.id === id);
  if (!product) notFound();
  return (
    <div className="flex flex-col gap-8">
      <ProductEditor key={product.id} product={product} boot={boot} />
      <section className="flex max-w-3xl flex-col gap-3" data-testid="sales-product-history">
        <h3 className="text-sm font-semibold">{t('history.title')}</h3>
        {history.ok ? <HistoryList rows={history.data} entityKind="product" /> : <p role="alert" className="text-sm text-destructive">{history.error}</p>}
      </section>
    </div>
  );
}
