'use client';

import { useCallback, useEffect, useState } from 'react';
import { BellRing } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { getPendingApprovalIds } from '@/lib/actions/leave/approvals';
import { refreshRoute } from '@/lib/actions/refresh';
import { usePathname } from '@/i18n/navigation';
import { POLL_MS, useVisiblePoll } from './useVisiblePoll';

type Props = {
  /** Ids of the queue as the server rendered it. */
  currentIds: string[];
  pollMs?: number;
};

/**
 * Approvers otherwise see queue changes only after a manual refresh. This
 * re-checks the queue every minute while the page is visible, and again when
 * the app comes back to the foreground.
 *
 * - A new request offers a refresh (the banner) rather than refreshing: it
 *   should be noticed, and an approver may be mid-decision.
 * - A request that left the queue (cancelled by the requester, or decided by
 *   another approver) refreshes silently, so nobody tries to sign it. The
 *   lists derive their rows from the server, so this keeps other rows' open
 *   dialogs.
 */
export function NewRequestsBanner({ currentIds, pollMs = POLL_MS }: Props) {
  const t = useTranslations('refresh');
  const router = useRouter();
  const locale = useLocale();
  const pathname = usePathname();
  // The queue as last polled, tagged with the render it was compared against.
  // Any new server render (refresh, decision) makes it stale: a request just
  // decided here is still in it and must not count as new.
  const idsKey = currentIds.join(',');
  const [result, setResult] = useState<{ ids: string[]; basis: string } | null>(null);
  const polled = result && result.basis === idsKey ? result.ids : null;

  const shown = new Set(currentIds);
  const newCount = polled ? polled.filter((id) => !shown.has(id)).length : 0;
  const polledSet = polled ? new Set(polled) : null;
  const goneKey = polledSet ? currentIds.filter((id) => !polledSet.has(id)).join(',') : '';

  useEffect(() => {
    if (goneKey) router.refresh();
  }, [goneKey, router]);

  const check = useCallback(async () => {
    const res = await getPendingApprovalIds();
    if (res.ok) setResult({ ids: res.ids, basis: idsKey });
  }, [idsKey]);
  useVisiblePoll(check, pollMs);

  if (newCount === 0) return null;

  return (
    <div role="status" aria-live="polite" className="sticky top-3 z-30 mb-4">
      <button
        type="button"
        data-testid="new-requests-banner"
        onClick={async () => {
          setResult(null);
          const target = `/${locale}/manage/approvals`;
          // The approvals page may sit in this browser's 5-minute router cache
          // without the new rows; the server action's revalidation drops it.
          await refreshRoute(target);
          if (pathname === '/manage/approvals') router.refresh();
          else router.push(target);
        }}
        className="flex w-full items-center gap-3 rounded-xl bg-primary px-4 py-3 text-start text-sm font-semibold text-primary-foreground shadow-md transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <BellRing className="size-5 shrink-0" aria-hidden />
        <span className="flex-1">{t('newRequests', { count: newCount })}</span>
        <span className="rounded-md bg-primary-foreground/15 px-3 py-1">{t('show')}</span>
      </button>
    </div>
  );
}
