'use client';

import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { tabsForRoles } from '@/lib/nav/tabs';

type Props = {
  roles: string[];
  locale: string;
};

export function RoutePrefetcher({ roles, locale }: Props) {
  const router = useRouter();
  const tabs = useMemo(() => tabsForRoles(roles), [roles]);

  useEffect(() => {
    for (const tab of tabs) {
      router.prefetch(`/${locale}${tab.href}`);
    }
  }, [locale, router, tabs]);

  return null;
}
