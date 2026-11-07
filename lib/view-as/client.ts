/** View as (FR-86): client-side helpers for the strip and tab sync. */
export const VIEW_AS_CHANNEL = 'bj-view-as';

/** Tell the admin's other tabs that a view started or ended (they reload). */
export function postViewAsChange(): void {
  try {
    const ch = new BroadcastChannel(VIEW_AS_CHANNEL);
    ch.postMessage('changed');
    ch.close();
  } catch {
    /* no BroadcastChannel: other tabs catch up on their next request */
  }
}

/** "Name (123)", or just "Name" when the person has no personnel number. */
export function viewAsLabel(name: string, personnelNo: string | null): string {
  return personnelNo ? `${name} (${personnelNo})` : name;
}

const MAX_TIMEOUT = 2 ** 31 - 1;
/** Already-expired views wait this long, so a live-view bounce cannot reload faster than once per 30 s. */
const PAST_EXPIRY_DELAY = 30_000;

/**
 * Milliseconds until the session expires, plus 1.5 s so the database is past the limit.
 * Finite and clamped to the setTimeout range; NaN for an unparseable date (do not arm a timer).
 * A view already past its limit waits 30 s, which stops a reload loop if the server still calls it live.
 */
export function msUntilExpiry(expiresAt: string, now: number): number {
  const at = new Date(expiresAt).getTime();
  if (!Number.isFinite(at) || !Number.isFinite(now)) return NaN;
  const remaining = at - now;
  if (remaining <= 0) return PAST_EXPIRY_DELAY;
  return Math.min(remaining + 1500, MAX_TIMEOUT);
}
