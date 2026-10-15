'use client';

import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { manageItemsForRoles, tabsForRoles } from '@/lib/nav/tabs';
import type { Perms } from '@/lib/permissions/catalog';

type Props = {
  roles: string[];
  perms: Perms;
  locale: string;
};

export function RoutePrefetcher({ roles, perms, locale }: Props) {
  const router = useRouter();
  const hrefs = useMemo(() => {
    const list = tabsForRoles(roles, perms).map((tab) => tab.href);
    // The side panel's first Manage item (the employees hub) is the usual
    // entry into the group on desktop.
    const firstManage = manageItemsForRoles(roles, perms)[0];
    if (firstManage) list.push(firstManage.href);
    // Profile lives in the side panel footer / mobile bar — still warm it.
    list.push('/profile');
    return list;
  }, [roles, perms]);

  useEffect(() => {
    for (const href of hrefs) {
      router.prefetch(`/${locale}${href}`);
    }
  }, [locale, router, hrefs]);

  return null;
}
