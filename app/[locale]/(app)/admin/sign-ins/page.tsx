/** FR-79 admin panel › Sign-ins: recent password sign-ins and who holds a session, with sign-out. */
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getAdminSignIns } from '@/lib/actions/admin';
import { ADMIN_LOCALE } from '@/lib/admin/locale';
import { formatPersianConsentTimestamp } from '@/lib/i18n/format';
import { EmptyState } from '@/components/EmptyState';
import { ErrorNote, Section } from '../_components/parts';
import { SignedInList } from './SignedInList';

type Props = { params: Promise<{ locale: string }> };

export default async function AdminSignInsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale: ADMIN_LOCALE, namespace: 'admin.signIns' });
  const result = await getAdminSignIns();
  if (!result.ok) return <ErrorNote message={result.error} />;
  const { signIns, me } = result;
  const when = (iso: string | null) => (iso ? formatPersianConsentTimestamp(iso, ADMIN_LOCALE) : '—');
  const devices = signIns.sessions.reduce((sum, p) => sum + p.devices, 0);

  return (
    <>
      <Section title={t('signedIn')} testId="admin-signed-in"
        action={<span className="text-xs text-muted-foreground">
          {t('signedInCount', { people: signIns.sessions.length, devices })}
        </span>}>
        <SignedInList
          me={me}
          people={signIns.sessions.map((p) => ({ ...p, lastActiveLabel: when(p.last_active) }))}
        />
      </Section>
      <Section title={t('recent')} testId="admin-recent-sign-ins">
        <p className="mb-3 text-xs text-muted-foreground">{t('recentHint')}</p>
        {signIns.logins.length === 0 ? <EmptyState message={t('recentNone')} /> : (
          <ul className="divide-y divide-muted">
            {signIns.logins.map((l, i) => (
              <li key={`${l.user_id}-${l.at}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm"
                data-testid="sign-in-row">
                <span className="font-medium">{l.full_name}</span>
                <span dir="ltr" className="font-mono text-xs text-muted-foreground">{l.employee_code}</span>
                <span className="ms-auto text-xs text-muted-foreground">{when(l.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
