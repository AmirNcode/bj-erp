/**
 * Manage list — the mobile bottom bar's Manage tab lands here. Holds the same
 * grouped links as the desktop side panel (lib/nav/tabs.ts), so each role sees
 * only what it can reach. The /manage layout already admits admin|manager|hr.
 */

import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCachedUser, getCachedRoles } from '@/lib/auth/context';
import { manageItemsForRoles, settingsItemForRoles, type NavItem } from '@/lib/nav/tabs';
import { Card } from '@/components/ui/card';
import { PageHeader } from '../_components/PageHeader';
import { NAV_ITEM_ICONS } from '../_components/nav-icons';

type Props = { params: Promise<{ locale: string }> };

export default async function ManageIndexPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCachedUser();
  const roles = user ? await getCachedRoles(user.id) : [];
  const t = await getTranslations('nav');
  const items = manageItemsForRoles(roles);
  const settings = settingsItemForRoles(roles);
  const Chevron = locale === 'fa' ? ChevronLeft : ChevronRight;
  // Explicit map, not t(item.labelKey): a dynamic message key has already
  // caused a production-only failure here (docs/MEMORY.md).
  const labels: Record<NavItem['key'], string> = {
    employees: t('employees'),
    departments: t('departments'),
    approvals: t('approvals'),
    requests: t('requests'),
    approvalSteps: t('approvalSteps'),
    reports: t('reports'),
    settings: t('settings'),
  };

  const row = (item: NavItem) => (
    <li key={item.key}>
      <Link
        href={`/${locale}${item.href}`}
        data-testid={`manage-link-${item.key}`}
        className="flex min-h-14 items-center gap-3 px-4 text-sm transition-colors hover:bg-muted/50"
      >
        <span aria-hidden="true" className="text-primary">
          {NAV_ITEM_ICONS[item.key]}
        </span>
        <span className="flex-1 whitespace-nowrap font-medium">{labels[item.key]}</span>
        <Chevron aria-hidden="true" className="size-4 text-muted-foreground" />
      </Link>
    </li>
  );

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <PageHeader title={t('manage')} />
      <Card className="gap-0 overflow-hidden py-0">
        <ul className="divide-y divide-muted">{items.map(row)}</ul>
      </Card>
      {settings && (
        <Card className="gap-0 overflow-hidden py-0">
          <ul>{row(settings)}</ul>
        </Card>
      )}
    </div>
  );
}
