'use client';

import { useEffect } from 'react';
import { VIEW_AS_CHANNEL } from '@/lib/view-as/client';

/** Reload when another tab starts or ends a view, so no tab shows a stale identity. */
export function ViewAsTabSync() {
  useEffect(() => {
    let ch: BroadcastChannel;
    try {
      ch = new BroadcastChannel(VIEW_AS_CHANNEL);
    } catch {
      return;
    }
    ch.onmessage = () => window.location.reload();
    return () => ch.close();
  }, []);
  return null;
}
