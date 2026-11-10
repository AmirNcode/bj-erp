/** View as (FR-86): client-side helpers for the strip and tab sync. */
export const VIEW_AS_CHANNEL = 'bj-view-as';

/**
 * This tab's id. A BroadcastChannel delivers to every other channel object of the
 * same name, the sending tab's own listener included, so a tab must skip its own
 * message: otherwise its reload races the start/exit navigation and can win.
 */
export const VIEW_AS_TAB_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);

/** Tell the admin's other tabs that a view started or ended (they reload). */
export function postViewAsChange(): void {
  try {
    const ch = new BroadcastChannel(VIEW_AS_CHANNEL);
    ch.postMessage({ from: VIEW_AS_TAB_ID });
    ch.close();
  } catch {
    /* no BroadcastChannel: other tabs catch up on their next request */
  }
}

/** True for a change posted by another tab (the only kind a tab reloads for). */
export function isOtherTabChange(data: unknown): boolean {
  const from = (data as { from?: unknown } | null)?.from;
  return typeof from === 'string' && from !== VIEW_AS_TAB_ID;
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
