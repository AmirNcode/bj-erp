'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BellRing } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { getPendingApprovalIds } from '@/lib/actions/leave/approvals';

/** How often an open, visible page re-checks the queue. */
export const NEW_REQUESTS_POLL_MS = 60_000;

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
export function NewRequestsBanner({ currentIds, pollMs = NEW_REQUESTS_POLL_MS }: Props) {
  const t = useTranslations('refresh');
  const router = useRouter();
  // The queue as last polled, tagged with the render it was compared against.
  // Any new server render (refresh, decision) makes it stale: a request just
  // decided here is still in it and must not count as new.
  const idsKey = currentIds.join(',');
  const [result, setResult] = useState<{ ids: string[]; basis: string } | null>(null);
  const polled = result && result.basis === idsKey ? result.ids : null;
  const inFlight = useRef(false);

  const shown = new Set(currentIds);
  const newCount = polled ? polled.filter((id) => !shown.has(id)).length : 0;
  const polledSet = polled ? new Set(polled) : null;
  const goneKey = polledSet ? currentIds.filter((id) => !polledSet.has(id)).join(',') : '';

  useEffect(() => {
    if (goneKey) router.refresh();
  }, [goneKey, router]);

  const check = useCallback(async () => {
    if (document.visibilityState !== 'visible' || inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await getPendingApprovalIds();
      if (res.ok) setResult({ ids: res.ids, basis: idsKey });
    } catch {
      // Offline or a deploy in progress: the next tick tries again.
    } finally {
      inFlight.current = false;
    }
  }, [idsKey]);

  useEffect(() => {
    const timer = window.setInterval(check, pollMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, [check, pollMs]);

  if (newCount === 0) return null;

  return (
    <div role="status" aria-live="polite" className="sticky top-3 z-30 mb-4">
      <button
        type="button"
        data-testid="new-requests-banner"
        onClick={() => {
          setResult(null);
          router.refresh();
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
