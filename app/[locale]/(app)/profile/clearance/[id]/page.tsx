/**
 * One clearance form (FR-54): the leaver's facts, unused leave, every sign-off
 * row with its remark and signature, the finance box, and — for admin / hr —
 * edit and cancel. Visibility is RLS via app_get_separation: an unauthorised
 * caller gets "not found".
 */

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getClearance, getClearanceSetup } from '@/lib/actions/clearance';
import { getWorkSettings } from '@/lib/actions/leave/reference';
import { WORK_SETTINGS_FALLBACK } from '@/lib/leave/workSettings';
import { canSignFinance, canSignRow } from '@/lib/clearance/model';
import { addDays, formatCalendarDate } from '@/lib/leave/calendarMonth';
import { formatDuration } from '@/lib/leave/duration';
import { durationLabelsFrom } from '@/lib/leave/durationLabels';
import { formatPersianConsentTimestamp, localizedLeaveTypeName } from '@/lib/i18n/format';
import { PageHeader } from '../../../_components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ClearanceStatus } from '../_components/ClearanceStatus';
import { SignDialog } from './SignDialog';
import { SignatureView } from './SignatureView';
import { ManageActions } from './ManageActions';

type Props = { params: Promise<{ locale: string; id: string }> };

export default async function ClearanceDetailPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('clearance');
  const tLeave = await getTranslations('leave');

  const res = await getClearance(id);
  const back = (
    <Link href={`/${locale}/profile/clearance`} className="block text-sm text-primary hover:underline">
      {t('backToList')}
    </Link>
  );
  if (!res.ok) {
    return (
      <main className="p-4 max-w-2xl mx-auto space-y-4">
        <PageHeader title={t('title')} />
        {back}
        <p role="alert" className="text-sm text-destructive">
          {res.error}
        </p>
      </main>
    );
  }

  const { form: f, caller } = res;
  const canManage = caller.roles.includes('admin') || caller.roles.includes('hr');
  const [setup, ws] = await Promise.all([
    canManage ? getClearanceSetup() : Promise.resolve(null),
    getWorkSettings(),
  ]);
  const hoursPerDay = ws.ok ? ws.settings.hoursPerDay : WORK_SETTINGS_FALLBACK.hoursPerDay;
  const durationLabels = durationLabelsFrom(tLeave);
  const date = (iso: string | null) => (iso ? formatCalendarDate(iso.slice(0, 10), locale) : '—');
  const name = (fa: string, en: string) => (locale === 'fa' ? fa : en);

  const statusLabel = {
    in_progress: t('status.in_progress'),
    awaiting_finance: t('status.awaiting_finance'),
    completed: t('status.completed'),
    cancelled: t('status.cancelled'),
  };
  const reasonLabel = {
    resignation: t('reasons.resignation'),
    dismissal: t('reasons.dismissal'),
    contract_end: t('reasons.contract_end'),
    abandonment: t('reasons.abandonment'),
    redundancy: t('reasons.redundancy'),
  };
  const department = f.employee.departmentNameFa
    ? name(f.employee.departmentNameFa, f.employee.departmentNameEn ?? f.employee.departmentNameFa)
    : '—';

  const facts: Array<[string, string]> = [
    [t('fields.personnelNo'), f.employee.personnelNo ?? '—'],
    [t('fields.department'), department],
    [t('fields.reason'), reasonLabel[f.reason]],
    [t('fields.lastWorkingDay'), date(f.lastWorkingDay)],
    [t('fields.hireDate'), date(f.hireDate)],
    [t('fields.fatherName'), f.fatherName ?? '—'],
    [t('fields.birthCertNo'), f.birthCertNo ?? '—'],
    [t('fields.filedOn'), date(f.createdAt)],
    [t('fields.createdBy'), f.createdByName ?? '—'],
  ];

  return (
    <main className="p-4 max-w-2xl mx-auto space-y-4" data-testid="clearance-detail" data-status={f.status}>
      <PageHeader title={f.employee.name} />
      {back}

      <Card>
        <CardContent className="space-y-3 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ClearanceStatus status={f.status} label={statusLabel[f.status]} />
            <Button asChild variant="outline" size="sm" data-testid="clearance-print">
              <Link href={`/${locale}/print/clearance/${f.id}`}>{t('print.printButton')}</Link>
            </Button>
          </div>
          <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
            {facts.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-medium">{value}</dd>
              </div>
            ))}
          </dl>
          {f.note && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{f.note}</p>}
          <p className="text-xs text-muted-foreground" data-testid="clearance-deactivation">
            {f.status === 'cancelled'
              ? t('cancelledNote')
              : f.deactivatedAt
                ? t('deactivated')
                : t('deactivatesOn', { date: date(addDays(f.lastWorkingDay, 1)) })}
          </p>
          {canManage && setup?.ok && (
            <ManageActions
              id={f.id}
              locale={locale}
              status={f.status}
              deactivated={!!f.deactivatedAt}
              reason={f.reason}
              lastWorkingDay={f.lastWorkingDay}
              note={f.note}
              rows={f.rows}
              people={setup.people}
              leaverId={f.employee.id}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b pb-4">
          <CardTitle>{t('detail.rowsTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          <ol className="divide-y divide-border" data-testid="clearance-signoffs">
            {f.rows.map((row, index) => (
              <li key={row.id} className="py-3" data-testid={`clearance-signoff-${index}`} data-signed={row.signedAt ? 'true' : 'false'}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{name(row.nameFa, row.nameEn)}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.signedAt
                        ? `${t('detail.signedBy', { name: row.signedByName ?? '—' })} · ${formatPersianConsentTimestamp(row.signedAt, locale)}`
                        : `${row.isHr ? t('rows.anyHr') : row.signerName ?? t('rows.unassigned')} · ${t('detail.notSigned')}`}
                    </p>
                    {row.note && <p className="mt-1 whitespace-pre-wrap text-sm">{row.note}</p>}
                    {row.signedAt && <SignatureView kind="row" id={row.id} />}
                  </div>
                  {canSignRow(row, caller, f.employee.id, f.status) && (
                    <SignDialog kind="row" id={row.id} unitName={name(row.nameFa, row.nameEn)} locale={locale} />
                  )}
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b pb-4">
          <CardTitle>{t('detail.financeTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-4 text-sm" data-testid="clearance-finance">
          {f.financeSignedAt ? (
            <>
              <p>{t('detail.financeBody')}</p>
              <p className="text-xs text-muted-foreground">
                {t('detail.financeSignedBy', {
                  name: f.financeSignedByName ?? '—',
                  date: formatPersianConsentTimestamp(f.financeSignedAt, locale),
                })}{' '}
                · {t('fields.settlementDate')} {date(f.settlementDate)}
              </p>
              {f.financeNote && <p className="whitespace-pre-wrap">{f.financeNote}</p>}
              <SignatureView kind="finance" id={f.id} />
            </>
          ) : canSignFinance(caller, f.employee.id, f.status) ? (
            <SignDialog kind="finance" id={f.id} locale={locale} />
          ) : (
            <p className="text-muted-foreground">{t('detail.financeWaiting')}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b pb-4">
          <CardTitle>{t('detail.balancesTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="pt-4 text-sm" data-testid="clearance-balances">
          {f.balances.length === 0 ? (
            <p className="text-muted-foreground">{t('detail.noBalances')}</p>
          ) : (
            <ul className="space-y-1">
              {f.balances.map((b) => (
                <li key={b.leaveTypeId} className="flex justify-between gap-2">
                  <span>{localizedLeaveTypeName({ name_fa: b.nameFa, name_en: b.nameEn }, locale)}</span>
                  <span className="font-medium">{formatDuration(b.minutes, hoursPerDay, locale, durationLabels)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
