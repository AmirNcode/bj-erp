'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { PersonSearch, type PersonSearchOption } from '@/components/PersonSearch';
import { startViewAs } from '@/lib/actions/view-as';
import { postViewAsChange } from '@/lib/view-as/client';

/** Choosing a person starts the view at once and lands on their Home. */
export function ViewAsPicker({ people, locale }: { people: PersonSearchOption[]; locale: string }) {
  const t = useTranslations('admin.viewAs');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const choose = (id: string | null) => {
    if (!id) return;
    setError(null);
    startTransition(async () => {
      const r = await startViewAs(id);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      postViewAsChange();
      // A full load, so every layout and cache re-reads under the new identity.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/${locale}/home`);
    });
  };

  return (
    <div className="flex max-w-md flex-col gap-2">
      <PersonSearch
        value={null}
        onChange={choose}
        people={people}
        autoChoose={false}
        limit={8}
        disabled={pending}
        ariaLabel={t('title')}
        testId="view-as-person"
      />
      {error && <p role="alert" className="text-sm text-destructive" data-testid="view-as-error">{error}</p>}
    </div>
  );
}
