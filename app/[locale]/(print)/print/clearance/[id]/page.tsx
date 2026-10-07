/**
 * Printable clearance form (FR-54 D14), laid out like the client's paper
 * «فرم تسویه حساب» (docs/forms/leave-company-form.jpeg) so HR can file it beside
 * the handwritten originals.
 *
 * Visibility is app_get_separation's: an unauthorised caller gets "not found".
 * The paper's bottom approver box (امضاء تایید کننده) has no step in the app; it
 * prints empty for a wet signature, as does any row not signed in the app.
 */

export const dynamic = 'force-dynamic';

import Image from 'next/image';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getClearance, getClearanceSignaturesForPrint } from '@/lib/actions/clearance';
import { formatCalendarDate } from '@/lib/leave/calendarMonth';
import { formatNumber, formatPersianConsentTimestamp } from '@/lib/i18n/format';
import { SEPARATION_REASONS, type SeparationReason } from '@/lib/clearance/model';
import { PrintToolbar } from '../../request/[id]/PrintToolbar';

type Props = { params: Promise<{ locale: string; id: string }> };

function Sig({ data, name, at, locale }: { data?: string | null; name?: string | null; at?: string | null; locale: string }) {
  if (!data) return null;
  return (
    <div className="flex flex-col items-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={data} alt="" className="h-10 w-auto max-w-[140px] object-contain" />
      <span className="text-[9px] leading-tight">
        {name}
        {at ? ` · ${formatPersianConsentTimestamp(at, locale)}` : ''}
      </span>
    </div>
  );
}

export default async function PrintClearancePage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('clearance');
  const tp = await getTranslations('clearance.print');
  const tPrint = await getTranslations('print');

  const [res, sigs] = await Promise.all([getClearance(id), getClearanceSignaturesForPrint(id)]);
  if (!res.ok) {
    return (
      <p role="alert" className="p-6 text-sm">
        {res.error}
      </p>
    );
  }
  const f = res.form;
  const images = sigs.ok ? sigs : { rows: {} as Record<string, string>, finance: null };
  const date = (iso: string | null) => (iso ? formatCalendarDate(iso.slice(0, 10), locale) : '');
  const name = (fa: string, en: string) => (locale === 'fa' ? fa : en);
  const reasonLabel: Record<SeparationReason, string> = {
    resignation: t('reasons.resignation'),
    dismissal: t('reasons.dismissal'),
    contract_end: t('reasons.contract_end'),
    abandonment: t('reasons.abandonment'),
    redundancy: t('reasons.redundancy'),
  };

  return (
    <>
      <PrintToolbar
        labels={{ print: tp('printButton'), back: tp('back') }}
        backHref={`/${locale}/profile/clearance/${f.id}`}
      />
      <main
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
        data-testid="print-clearance"
        className="mx-auto max-w-4xl bg-white p-4 text-black print:max-w-none print:p-0"
      >
        <div className="border-2 border-black text-[12px]">
          {/* header: title · company · date, right to left as on the paper */}
          <div className="grid grid-cols-[1fr_2fr_1fr] items-center border-b-2 border-black">
            <div className="border-e border-black px-2 py-2 text-base font-bold">{tp('title')}</div>
            <div className="flex items-center justify-center gap-2 border-e border-black px-2 py-1">
              <Image src="/bj-logo.png" alt="" width={80} height={40} className="h-7 w-auto object-contain" />
              <span className="text-base font-bold">{tPrint('company')}</span>
            </div>
            <div className="px-2 py-2">
              {tp('date')} : <strong>{date(f.createdAt)}</strong>
            </div>
          </div>

          {/* who */}
          <div className="space-y-1 border-b border-black px-3 py-2 leading-7">
            <p>
              {tp('name')} : <strong>{f.employee.name}</strong> · {tp('father')} : <strong>{f.fatherName ?? '—'}</strong> ·{' '}
              {tp('birthCert')} : <strong dir="ltr">{f.birthCertNo ?? '—'}</strong> · {tp('hireDate')} :{' '}
              <strong>{date(f.hireDate) || '—'}</strong>
            </p>
            <p>
              {tp('reason')} : {tp('lastDay')} <strong>{date(f.lastWorkingDay)}</strong>
              <span className="ms-3">
                {SEPARATION_REASONS.map((r) => (
                  <span key={r} className="mx-1 whitespace-nowrap" data-testid={r === f.reason ? 'print-reason-ticked' : undefined}>
                    {reasonLabel[r]} <span className="text-[13px] font-bold">{r === f.reason ? '☒' : '☐'}</span>
                  </span>
                ))}
              </span>
            </p>
          </div>

          {/* the rows */}
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-black">
                <th className="w-10 border-e border-black py-1">{tp('row')}</th>
                <th className="w-1/4 border-e border-black py-1">{tp('unit')}</th>
                <th className="border-e border-black py-1">{tp('remark')}</th>
                <th className="w-1/4 py-1">{tp('signature')}</th>
              </tr>
            </thead>
            <tbody>
              {f.rows.map((row, index) => (
                <tr key={row.id} className="h-14 border-b border-black align-middle" data-testid={`print-clearance-row-${index}`}>
                  <td className="border-e border-black text-center">{formatNumber(index + 1, locale)}</td>
                  <td className="border-e border-black px-2">{name(row.nameFa, row.nameEn)}</td>
                  <td className="border-e border-black px-2 text-[11px]">{row.note ?? ''}</td>
                  <td className="px-1">
                    <Sig data={images.rows[row.id]} name={row.signedByName} at={row.signedAt} locale={locale} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* to finance + approver (wet signature) */}
          <div className="grid grid-cols-2 border-b border-black px-3 py-3">
            <p>{tp('toFinance')}</p>
            <p className="text-end">{tp('approver')}</p>
          </div>

          {/* finance */}
          <div className="grid grid-cols-[2fr_1fr] gap-2 px-3 py-3" data-testid="print-clearance-finance">
            <div className="space-y-2">
              <p>{tp('financeText')}</p>
              {f.financeNote && <p className="text-[11px]">{f.financeNote}</p>}
              <p>
                {tp('settledOn')} <strong>{date(f.settlementDate)}</strong>
              </p>
            </div>
            <div>
              <p>{tp('financeSignature')}</p>
              <Sig data={images.finance} name={f.financeSignedByName} at={f.financeSignedAt} locale={locale} />
            </div>
          </div>
        </div>
        <p className="mt-2 text-[10px] text-neutral-600">{tp('footnote')}</p>
      </main>
    </>
  );
}
