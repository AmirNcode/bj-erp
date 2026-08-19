'use client';

/**
 * The on-screen-only controls above a printable form (FR-38).
 *
 * `print:hidden` keeps the toolbar off the paper; everything below it is the
 * form itself.
 */

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

type Props = {
  labels: { print: string; back: string };
  backHref: string;
};

export function PrintToolbar({ labels, backHref }: Props) {
  const router = useRouter();

  return (
    <div className="mx-auto mb-4 flex max-w-4xl items-center justify-between gap-3 px-4 pt-4 print:hidden">
      <Button
        type="button"
        variant="outline"
        onClick={() => router.push(backHref)}
        data-testid="print-back"
      >
        {labels.back}
      </Button>
      <Button type="button" onClick={() => window.print()} data-testid="print-button">
        {labels.print}
      </Button>
    </div>
  );
}
