/** ERP › Sales (CEO feedback §5): one product. Guarded by the module layout; an unknown id is a 404. */

export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { listSalesProducts } from '@/lib/actions/sales';
import { loadSalesBootstrap } from '../../_components/load';
import { ProductEditor } from '../../_components/ProductEditor';

type Props = { params: Promise<{ locale: string; id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SalesProductPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  if (!UUID.test(id)) notFound();
  const [boot, products] = await Promise.all([loadSalesBootstrap(), listSalesProducts()]);
  if (!products.ok) notFound();
  const product = products.data.find((p) => p.id === id);
  if (!product) notFound();
  return <ProductEditor key={product.id} product={product} boot={boot} />;
}
