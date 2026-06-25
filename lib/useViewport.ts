'use client';

import { useState, useEffect } from 'react';
import { isMobileWidth } from '@/lib/device';

/**
 * Client viewport hook (NFR-1 device detection). Pairs with `parseDeviceType`
 * (server-side UA). Provided as a primitive for future modules that branch
 * mobile vs desktop; SSR-safe (width starts at 0 = desktop until mounted).
 */
export function useViewport(): { width: number; isMobile: boolean } {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const update = () => setWidth(window.innerWidth);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return { width, isMobile: isMobileWidth(width) };
}
