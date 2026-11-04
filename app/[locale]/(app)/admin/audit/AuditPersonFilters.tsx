'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { PersonSearch } from '@/components/PersonSearch';
import type { AuditPerson } from '@/lib/admin/types';

/** "Done by" (actor) and "About" (target) pickers; each posts its id with the GET form. */
export function AuditPersonFilters({
  people,
  actor,
  about,
}: {
  people: AuditPerson[];
  actor: string | null;
  about: string | null;
}) {
  const t = useTranslations('admin.audit');
  const [actorId, setActorId] = useState(actor);
  const [aboutId, setAboutId] = useState(about);
  return (
    <>
      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        <label htmlFor="audit-actor">{t('doneBy')}</label>
        <PersonSearch id="audit-actor" name="actor" people={people} value={actorId} onChange={setActorId}
          placeholder={t('anyone')} testId="audit-actor" />
      </div>
      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        <label htmlFor="audit-about">{t('about')}</label>
        <PersonSearch id="audit-about" name="about" people={people} value={aboutId} onChange={setAboutId}
          placeholder={t('anyone')} testId="audit-about" />
      </div>
    </>
  );
}
