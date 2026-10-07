'use client';

/** Fetches one clearance signature image only when a reader asks to see it. */

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { getClearanceSignature } from '@/lib/actions/clearance';

export function SignatureView({ kind, id }: { kind: 'row' | 'finance'; id: string }) {
  const t = useTranslations('clearance.detail');
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  const toggle = () => {
    if (open || data) {
      setOpen(!open);
      return;
    }
    setError('');
    startTransition(async () => {
      const res = await getClearanceSignature(kind, id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setData(res.signatureData);
      setOpen(true);
    });
  };

  return (
    <div className="mt-1">
      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto p-0 text-xs"
        onClick={toggle}
        disabled={isPending}
        data-testid={`clearance-signature-toggle-${id}`}
      >
        {isPending ? t('loading') : open ? t('hideSignature') : t('viewSignature')}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {open && data && (
        // A private data URL is already encoded and should not pass through the image optimizer.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={data}
          alt=""
          className="mt-1 h-auto max-h-24 w-full max-w-xs rounded border border-border bg-white object-contain"
          data-testid={`clearance-signature-${id}`}
        />
      )}
    </div>
  );
}
