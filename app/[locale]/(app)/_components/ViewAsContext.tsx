'use client';

import { createContext, useContext } from 'react';

export type ViewAsInfo = { name: string; personnelNo: string | null; expiresAt: string };

const ViewAsContext = createContext<ViewAsInfo | null>(null);

export function ViewAsProvider({ value, children }: { value: ViewAsInfo | null; children: React.ReactNode }) {
  return <ViewAsContext.Provider value={value}>{children}</ViewAsContext.Provider>;
}

export function useViewAs(): ViewAsInfo | null {
  return useContext(ViewAsContext);
}
