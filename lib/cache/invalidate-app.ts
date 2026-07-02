import { revalidatePath } from 'next/cache';

/**
 * Purge the acting user's router cache for every app route after a successful
 * mutation.
 *
 * `experimental.staleTimes` lets the client reuse visited pages for 5 minutes —
 * that's what makes tab switching instant. The trade-off: after a write, the
 * actor's other cached tabs would show pre-write data. Calling this from a
 * server action makes the requesting browser drop its whole router cache, so
 * the actor's next navigation re-fetches and always shows their own change.
 * Other users are unaffected (a server action can't reach their browsers);
 * they get fresh data via the staleness window or the refresh pill, by design.
 */
export function invalidateAppCache() {
  revalidatePath('/', 'layout');
}
