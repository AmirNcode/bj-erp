'use client';

import { Suspense, use, useCallback, useState } from 'react';
import { CircleCheck, CircleX } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import {
  getMyRequestOutcomes,
  type RequestOutcome,
  type WatchedRequest,
} from '@/lib/actions/leave/outcomes';
import { cn } from '@/lib/utils';
import { POLL_MS, useVisiblePoll } from './useVisiblePoll';

type Props = {
  /** The requester's pending requests; streamed from the layout, never awaited there. */
  pending: Promise<WatchedRequest[]>;
  pollMs?: number;
};

type Found = RequestOutcome & { label: string; dismissed: boolean };

/**
 * Tells requesters, on any page, when a pending request of theirs is approved
 * (the whole chain signed) or rejected (at any step), with the rejection
 * reason. It polls only while something is pending, and stays until "Show",
 * which opens My Requests with every request listed.
 */
export function RequestOutcomeBanner(props: Props) {
  return (
    <Suspense fallback={null}>
      <OutcomeWatcher {...props} />
    </Suspense>
  );
}

function OutcomeWatcher({ pending, pollMs = POLL_MS }: Props) {
  const t = useTranslations('requestOutcome');
  const router = useRouter();
  const locale = useLocale();
  const watched = use(pending);
  // Kept until dismissed, even after a refresh drops the request from `watched`.
  // Dismissed ones stay in the list (hidden) so they are never polled again.
  const [found, setFound] = useState<Found[]>([]);
  const shown = found.filter((o) => !o.dismissed);

  const seen = new Set(found.map((o) => o.id));
  const toCheck = watched.filter((r) => !seen.has(r.id));
  const idsKey = toCheck.map((r) => r.id).join(',');

  const check = useCallback(async () => {
    const ids = idsKey.split(',');
    const res = await getMyRequestOutcomes(ids);
    if (!res.ok || res.outcomes.length === 0) return;
    const labels = new Map(watched.map((r) => [r.id, r.label]));
    setFound((prev) => [
      ...prev,
      ...res.outcomes
        .filter((o) => !prev.some((p) => p.id === o.id))
        .map((o) => ({ ...o, label: labels.get(o.id) ?? '', dismissed: false })),
    ]);
  }, [idsKey, watched]);
  useVisiblePoll(check, pollMs, idsKey !== '');

  if (shown.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="request-outcome-banner"
      className="sticky top-3 z-30 mb-4 rounded-xl border bg-card p-4 shadow-md"
    >
      <ul className="space-y-3">
        {shown.map((o) => {
          const approved = o.status === 'approved';
          const Icon = approved ? CircleCheck : CircleX;
          return (
            <li key={o.id} className="flex gap-3" data-testid={`request-outcome-${o.id}`}>
              <Icon
                className={cn('mt-0.5 size-5 shrink-0', approved ? 'text-success' : 'text-destructive')}
                aria-hidden
              />
              <div className="min-w-0 text-sm">
                <p className={cn('font-semibold', approved ? 'text-success' : 'text-destructive')}>
                  {t(approved ? 'approved' : 'rejected', { label: o.label })}
                </p>
                {!approved && o.note && (
                  <p className="mt-0.5 text-muted-foreground">{t('reason', { note: o.note })}</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        data-testid="request-outcome-show"
        onClick={() => {
          setFound((prev) => prev.map((o) => ({ ...o, dismissed: true })));
          // The poll that found these already dropped the router cache.
          router.push(`/${locale}/request?all=1`);
        }}
        className="mt-4 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {t('show')}
      </button>
    </div>
  );
}
