/** ERP › Sales (FR-94): settings and the ledger import, for `sales_settings` holders. */

export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { listSalesRecordNumbers } from '@/lib/actions/sales';
import { loadSalesBootstrap } from '../_components/load';
import { SettingsView } from '../_components/SettingsView';

type Props = { params: Promise<{ locale: string }> };

export default async function SalesSettingsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const boot = await loadSalesBootstrap();
  if (!boot.caps.settings) notFound();
  // The import preview says how many ledger rows already exist here.
  const list = await listSalesRecordNumbers();
  return <SettingsView boot={boot} numbers={list.ok ? list.data : { app: [], ledger: [], inquiry: [] }} />;
}
