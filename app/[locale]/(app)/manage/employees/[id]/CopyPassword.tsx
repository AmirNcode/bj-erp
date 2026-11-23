'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

export function CopyPassword({ password }: { password: string }) {
  const t = useTranslations('manage.employees');
  const passwordElement = useRef<HTMLSpanElement>(null);
  const [status, setStatus] = useState<'idle' | 'copied' | 'manual'>('idle');

  useEffect(() => {
    if (status !== 'copied') return;
    const timer = window.setTimeout(() => setStatus('idle'), 2000);
    return () => window.clearTimeout(timer);
  }, [status]);

  async function copy() {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(password);
      } else {
        // The LAN installation can run over HTTP, without the Clipboard API.
        const range = document.createRange();
        range.selectNodeContents(passwordElement.current!);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        if (!document.execCommand('copy')) {
          setStatus('manual');
          return;
        }
        selection?.removeAllRanges();
      }
      setStatus('copied');
    } catch {
      setStatus('manual');
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span ref={passwordElement} dir="ltr" className="select-all break-all rounded-lg border border-success/20 bg-background px-4 py-2 font-mono text-xl tracking-widest">
        {password}
      </span>
      <Button type="button" size="sm" variant="outline" onClick={copy}>{t('copyPassword')}</Button>
      <span role="status" className="text-sm">
        {status === 'copied' ? t('passwordCopied') : status === 'manual' ? t('copyPasswordManually') : ''}
      </span>
    </div>
  );
}
