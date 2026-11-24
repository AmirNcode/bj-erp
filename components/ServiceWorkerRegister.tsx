'use client';

import { useEffect } from 'react';

/**
 * Registers public/sw.js (static-file cache + offline page) in production builds.
 * Never under `next dev`: a worker there would serve stale dev chunks.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .catch(() => {
        // Not fatal: the app works without the worker, only slower on repeat visits.
      });
  }, []);
  return null;
}
