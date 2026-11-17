'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { findSalesNode } from '@/lib/actions/sales';
import { toAsciiDigits } from '@/lib/employees/code';

/** Jump to a record or an item row by its number (8997, 8997-1-3, BJ11511-01). */
export function NodeSearch() {
  const t = useTranslations('sales.search');
  const locale = useLocale();
  const router = useRouter();
  const [code, setCode] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'none'>('idle');

  async function go(e: React.FormEvent) {
    e.preventDefault();
    const query = toAsciiDigits(code).trim();
    if (!query) return;
    setState('busy');
    const result = await findSalesNode(query);
    if (!result.ok || !result.data) {
      setState('none');
      return;
    }
    setState('idle');
    setCode('');
    const node = result.data.node_id ? `?node=${result.data.node_id}` : '';
    router.push(`/${locale}/sales/${result.data.rfp_id}${node}`);
  }

  return (
    <form onSubmit={go} className="flex w-full items-center gap-2 sm:w-auto" role="search">
      <div className="flex min-w-0 flex-1 flex-col sm:w-56 sm:flex-none">
        <Input
          dir="ltr"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            if (state === 'none') setState('idle');
          }}
          placeholder={t('placeholder')}
          aria-label={t('label')}
          aria-invalid={state === 'none'}
          data-testid="sales-node-search"
        />
      </div>
      <Button type="submit" variant="outline" size="icon" disabled={state === 'busy'} aria-label={t('go')}>
        <Search />
      </Button>
      {state === 'none' ? <span role="status" className="text-xs text-destructive">{t('none')}</span> : null}
    </form>
  );
}
