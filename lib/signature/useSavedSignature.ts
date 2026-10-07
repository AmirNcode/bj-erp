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

function load(): Promise<string | null> {
  pending ??= getMySavedSignature()
    .then((res) => (res.ok ? (res.signature?.signatureData ?? null) : null))
    .catch(() => null);
  return pending;
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
