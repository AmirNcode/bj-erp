/**
 * Home: one line for a Sales holder (FR-94) whose own deadlines are overdue or
 * inside the warning window. Renders nothing without the `sales` permission (the
 * module is hidden) or when nothing needs attention.
 */

import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { getCachedPermissions } from '@/lib/auth/context';
import { can } from '@/lib/permissions/catalog';
import { getSalesBootstrap, listSalesDeadlines } from '@/lib/actions/sales';
import { todayInAppTz } from '@/lib/appDate';
import { deadlineState } from '@/lib/sales/deadlines';

export async function SalesDeadlinesCard({ locale, userId }: { locale: string; userId: string }) {
  if (!can(await getCachedPermissions(userId), 'sales', 'read')) return null;
  const [boot, rows] = await Promise.all([getSalesBootstrap(), listSalesDeadlines(false)]);
  if (!boot.ok || !rows.ok) return null;
  const today = todayInAppTz();
  const waiting = rows.data.filter(
    (d) => d.responsible_id === boot.data.me && deadlineState(d.due_on, today, boot.data.settings.warn_days) !== 'ok'
  ).length;
  if (waiting === 0) return null;
  const t = await getTranslations('sales');

  return (
    <Link
      href={`/${locale}/sales/deadlines`}
      className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning-foreground p-4 text-warning transition-colors hover:border-warning/50"
      data-testid="home-sales-deadlines"
    >
      <span className="text-sm font-semibold">{t('home.waiting', { count: waiting })}</span>
      <span className="text-xs font-medium">{t('home.open')} ›</span>
    </Link>
  );
}
