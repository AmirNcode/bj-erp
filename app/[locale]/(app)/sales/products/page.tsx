/** ERP › Sales (CEO feedback §5): the Products tab. Guarded by the module layout. */

export const dynamic = 'force-dynamic';

import { setRequestLocale } from 'next-intl/server';
import { listSalesProducts } from '@/lib/actions/sales';
import { loadSalesBootstrap } from '../_components/load';
import { ProductsList } from '../_components/ProductsList';

type Props = { params: Promise<{ locale: string }> };

export default async function SalesProductsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [boot, products] = await Promise.all([loadSalesBootstrap(), listSalesProducts()]);
  if (!products.ok) return <p role="alert" className="text-sm text-destructive">{products.error}</p>;
  return <ProductsList products={products.data} canEdit={boot.caps.settings} />;
}
