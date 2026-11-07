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

/** Milliseconds until the session expires, plus 1.5 s so the database is past the limit. */
export function msUntilExpiry(expiresAt: string, now: number): number {
  return Math.max(0, new Date(expiresAt).getTime() - now) + 1500;
}
