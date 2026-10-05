'use client';

import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { manageItemsForRoles, tabsForRoles } from '@/lib/nav/tabs';

type Props = {
  roles: string[];
  locale: string;
};

export function RoutePrefetcher({ roles, locale }: Props) {
  const router = useRouter();
  const hrefs = useMemo(() => {
    const list = tabsForRoles(roles).map((tab) => tab.href);
    // The side panel's first Manage item (the employees hub) is the usual
    // entry into the group on desktop.
    const firstManage = manageItemsForRoles(roles)[0];
    if (firstManage) list.push(firstManage.href);
    // Profile lives in the side panel footer / mobile bar — still warm it.
    list.push('/profile');
    return list;
  }, [roles]);

  useEffect(() => {
    for (const href of hrefs) {
      router.prefetch(`/${locale}${href}`);
    }
  }, [locale, router, hrefs]);

  return null;
}
