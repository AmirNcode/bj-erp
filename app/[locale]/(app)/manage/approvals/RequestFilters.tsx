'use client';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { nativeSelectClass } from '@/lib/native-select';
import { approvalHref, type RequestFilters as Filters } from '@/lib/leave/requestFilters';

export function RequestFilters({ filters, locale }: { filters: Filters; locale: string }) {
  const t = useTranslations('review');
  const leave = useTranslations('leave');
  const router = useRouter();
  const [query, setQuery] = useState(filters.query);
  const [pending, startTransition] = useTransition();
  const [lastQuery, setLastQuery] = useState(filters.query);
  if (lastQuery !== filters.query) {
    setLastQuery(filters.query);
    if (query === lastQuery) setQuery(filters.query);
  }
  useEffect(() => {
    if (query === filters.query) return;
    const timer = setTimeout(() => startTransition(() => router.replace(approvalHref(locale, { ...filters, query }), { scroll: false })), 300);
    return () => clearTimeout(timer);
  }, [query, filters, locale, router]);
  const change = (key: 'status' | 'kind', value: string) => startTransition(() =>
    router.replace(approvalHref(locale, { ...filters, query, [key]: value }), { scroll: false }));
  return (
    <div className="mb-5 grid gap-3 sm:grid-cols-3" aria-busy={pending}>
      <div className="space-y-1.5"><Label htmlFor="approval-search">{t('search')}</Label>
        <Input id="approval-search" data-testid="review-search" value={query} onChange={e => setQuery(e.target.value)} placeholder={t('searchPlaceholder')} /></div>
      <div className="space-y-1.5"><Label htmlFor="approval-status">{t('status')}</Label>
        <select id="approval-status" data-testid="review-status" className={nativeSelectClass} value={filters.status} onChange={e => change('status', e.target.value)}>
          <option value="all">{t('all')}</option>
          {(['pending','approved','rejected','cancelled'] as const).map(s => <option key={s} value={s}>{leave(`status.${s}`)}</option>)}
        </select></div>
      <div className="space-y-1.5"><Label htmlFor="approval-kind">{t('kind')}</Label>
        <select id="approval-kind" data-testid="review-kind" className={nativeSelectClass} value={filters.kind} onChange={e => change('kind', e.target.value)}>
          <option value="all">{t('all')}</option><option value="leave">{t('kindLeave')}</option><option value="errand">{t('kindErrand')}</option>
        </select></div>
    </div>
  );
}
