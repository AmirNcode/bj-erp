/** FR-86 admin panel › View as: pick a person and see the app as they do, read-only, for 30 minutes. */
import { ADMIN_LOCALE } from '@/lib/admin/locale';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getViewAsPeople } from '@/lib/actions/view-as';
import { ErrorNote, Section } from '../_components/parts';
import { ViewAsPicker } from './ViewAsPicker';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminViewAsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const ended = (Array.isArray(sp.ended) ? sp.ended[0] : sp.ended) === '1';
  const t = await getTranslations({ locale: ADMIN_LOCALE, namespace: 'admin.viewAs' });
  const roster = await getViewAsPeople();
  if (!roster.ok) return <ErrorNote message={roster.error} />;
  return (
    <Section title={t('title')} testId="admin-view-as">
      {ended && <p className="mb-3 text-sm text-muted-foreground" data-testid="view-as-ended">{t('ended')}</p>}
      <p className="mb-4 text-sm text-muted-foreground">{t('note')}</p>
      <ViewAsPicker people={roster.people} locale={locale} />
    </Section>
  );
}
