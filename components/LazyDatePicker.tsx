'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';

export const LazyDatePicker = dynamic(
  () => import('react-multi-date-picker').then((module) => module.default),
  { ssr: false, loading: () => <Skeleton className="h-10 w-full" /> }
);
