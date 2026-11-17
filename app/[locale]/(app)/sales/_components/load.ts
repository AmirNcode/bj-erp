/**
 * FR-94: per-request loaders for the Sales pages. `cache()` lets the layout and
 * the page share one bootstrap call. Server-only.
 */

import { cache } from 'react';
import { notFound } from 'next/navigation';
import { getSalesBootstrap } from '@/lib/actions/sales';

/**
 * The caller's caps, stages, fields and people. A caller without the `sales`
 * permission gets a 404: the module must not reveal that it exists.
 */
export const loadSalesBootstrap = cache(async () => {
  const result = await getSalesBootstrap();
  if (!result.ok) notFound();
  return result.data;
});
