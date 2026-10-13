'use client';

import { useEffect, useRef } from 'react';

/** How often an open, visible page re-checks for changes. */
export const POLL_MS = 60_000;

/**
 * Runs `check` every `pollMs` while the page is visible, and again as soon as
 * the app comes back to the foreground or back online. Skips a tick while the
 * previous check is still running, and swallows failures (offline, deploy in
 * progress): the next tick tries again.
 */
export function useVisiblePoll(check: () => Promise<void>, pollMs = POLL_MS, enabled = true) {
  const inFlight = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const run = async () => {
      if (document.visibilityState !== 'visible' || inFlight.current) return;
      inFlight.current = true;
      try {
        await check();
      } catch {
        // Next tick.
      } finally {
        inFlight.current = false;
      }
    };
    const timer = window.setInterval(run, pollMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void run();
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
  }, [check, pollMs, enabled]);
}
