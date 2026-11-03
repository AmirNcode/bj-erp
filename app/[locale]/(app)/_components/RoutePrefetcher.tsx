'use client';

import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { manageItemsForRoles, tabsForRoles } from '@/lib/nav/tabs';
import type { Perms } from '@/lib/permissions/catalog';

type Props = {
  roles: string[];
  perms: Perms;
  canApprove?: boolean;
  canDelegate?: boolean;
  hasReports?: boolean;
  absencesPage?: boolean;
  timeOff?: boolean;
  locale: string;
};

export function RoutePrefetcher({ roles, perms, locale, canApprove, canDelegate, hasReports, absencesPage, timeOff }: Props) {
  const router = useRouter();
  const hrefs = useMemo(() => {
    const list = tabsForRoles(roles, perms, canApprove, canDelegate, hasReports, absencesPage, timeOff).map((tab) => tab.href);
    // The side panel's first Manage item (the employees hub) is the usual
    // entry into the group on desktop.
    const firstManage = manageItemsForRoles(roles, perms, canApprove, canDelegate, hasReports, absencesPage)[0];
    if (firstManage) list.push(firstManage.href);
    // Profile lives in the side panel footer / mobile bar — still warm it.
    list.push('/profile');
    return list;
  }, [roles, perms, canApprove, canDelegate, hasReports, absencesPage, timeOff]);

  useEffect(() => {
    for (const href of hrefs) {
      router.prefetch(`/${locale}${href}`);
    }
  }, [locale, router, hrefs]);

  return null;
}
