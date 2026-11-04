'use client';

/**
 * Who has a photo, batched (FR-82). Every <PersonAvatar> without an explicit version asks here;
 * the ids requested in one tick go to the server in one getPhotoVersions call. Results are kept
 * for five minutes, so a list of 300 people costs one small call and then only the image
 * requests for people who actually have a photo (each cached for good by its ?v= URL).
 */

import { useSyncExternalStore } from 'react';

const TTL_MS = 5 * 60 * 1000;
const BATCH = 500;

type Entry = { version: number | null; at: number };
const cache = new Map<string, Entry>();
const queued = new Set<string>();
const inFlight = new Set<string>();
const listeners = new Set<() => void>();
let scheduled = false;

function emit() {
  for (const l of listeners) l();
}

async function flush() {
  scheduled = false;
  const ids = [...queued];
  queued.clear();
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    chunk.forEach((id) => inFlight.add(id));
    try {
      // Imported on first use: keeps the server-action module out of every component that only
      // renders an avatar (and out of unit tests, which have no Supabase env).
      const { getPhotoVersions } = await import('@/lib/actions/photo');
      const res = await getPhotoVersions(chunk);
      const now = Date.now();
      // On an error, remember "no photo" briefly rather than retrying in a loop.
      for (const id of chunk) cache.set(id, { version: res.ok ? (res.versions[id] ?? null) : null, at: now });
    } catch {
      const now = Date.now();
      for (const id of chunk) cache.set(id, { version: null, at: now });
    } finally {
      chunk.forEach((id) => inFlight.delete(id));
    }
    emit();
  }
}

function request(id: string) {
  if (queued.has(id) || inFlight.has(id)) return;
  queued.add(id);
  if (!scheduled) {
    scheduled = true;
    // A short delay collects every avatar of one render (and of lazy rows mounting together).
    setTimeout(flush, 30);
  }
}

function read(id: string): number | null | undefined {
  const entry = cache.get(id);
  if (!entry) return undefined;
  if (Date.now() - entry.at > TTL_MS) {
    request(id);
  }
  return entry.version;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Tell every avatar on screen about a photo change made in this tab. */
export function notePhotoVersion(id: string, version: number | null) {
  cache.set(id, { version, at: Date.now() });
  emit();
}

/** number = has a photo (cache key) · null = none · undefined = still asking. */
export function usePhotoVersion(id: string, enabled = true): number | null | undefined {
  const value = useSyncExternalStore(
    subscribe,
    () => (enabled ? read(id) : undefined),
    () => undefined
  );
  if (enabled && value === undefined && typeof window !== 'undefined' && !cache.has(id)) request(id);
  return value;
}
