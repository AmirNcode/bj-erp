'use client';

import { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import { refreshRoute } from '@/lib/actions/refresh';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

function formatTime(date: Date, locale: string) {
  return new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

type Props = {
  initialUpdatedAt?: string;
};

export function PageRefreshButton({ initialUpdatedAt }: Props) {
  const t = useTranslations('refresh');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [updatedAt, setUpdatedAt] = useState(() =>
    initialUpdatedAt ? new Date(initialUpdatedAt) : new Date()
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const updatedLabel = useMemo(
    () => t('updated', { time: formatTime(updatedAt, locale) }),
    [locale, t, updatedAt]
  );

  const handleRefresh = async () => {
    if (isRefreshing) return;

    setIsRefreshing(true);
    try {
      const result = await refreshRoute(pathname);
      setUpdatedAt(result.ok ? new Date(result.refreshedAt) : new Date());
      router.refresh();
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <Button
      type="button"
      variant="secondary"
      size="xs"
      data-testid="page-refresh-button"
      onClick={handleRefresh}
      disabled={isRefreshing}
      className="h-8 rounded-full border border-primary/15 bg-card px-3 text-xs font-medium text-muted-foreground shadow-sm hover:bg-primary/10 hover:text-primary"
    >
      <RefreshCw
        aria-hidden="true"
        className={cn('size-3.5', isRefreshing && 'animate-spin')}
      />
      {isRefreshing ? t('pending') : updatedLabel}
    </Button>
  );
}
