import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};
const clientDir = (): 'ltr' | 'rtl' => (document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr');

/**
 * The page direction (`<html dir>`), for Radix parts that take their own `dir` prop (roving-focus
 * arrow keys, menu placement). Radix reads a DirectionProvider, not the DOM, so without this an
 * RTL page gets LTR arrow keys. The server snapshot is 'ltr' so hydration never mismatches.
 */
export function useDirection(): 'ltr' | 'rtl' {
  return useSyncExternalStore(subscribe, clientDir, () => 'ltr');
}
