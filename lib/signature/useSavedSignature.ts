'use client';

/**
 * The caller's saved signature (FR-52) for pre-filling signature boxes.
 *
 * Fetched lazily, the first time a signature box renders, and kept for the life
 * of the page (module-level), so a page with several approve dialogs asks the
 * server once. Profile clears it after a save or delete.
 */

import { useEffect, useState } from 'react';
import { getMySavedSignature } from '@/lib/actions/signature';

let pending: Promise<string | null> | null = null;

/**
 * Only an answer is kept. A failed call (an error result, or a thrown one such
 * as "Failed to find Server Action" from a tab older than the running build)
 * resolves null this time and leaves the cache empty, so the next signature box
 * asks again instead of staying blank for the life of the page.
 */
function load(): Promise<string | null> {
  if (pending) return pending;
  const request: Promise<string | null> = getMySavedSignature()
    .then((res) => {
      if (!res.ok) throw new Error(res.error);
      return res.signature?.signatureData ?? null;
    })
    .catch(() => {
      if (pending === request) pending = null;
      return null;
    });
  pending = request;
  return request;
}

export function clearSavedSignatureCache() {
  pending = null;
}

/** `undefined` while loading, then the saved PNG data URL or null. */
export function useSavedSignature(enabled = true): string | null | undefined {
  const [saved, setSaved] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    load().then((value) => {
      if (!cancelled) setSaved(value);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return enabled ? saved : null;
}
