/**
 * Printable paper-equivalent request form (FR-38).
 *
 * Reproduces the client's own stationery so HR can file a printed sheet exactly
 * as they do today. The three photographed originals live in `docs/forms/`:
 *
 *   BJ-F 50210(R0) daily leave · 50208(R0) hourly leave · 50207(R0) hourly errand
 *
 * Visibility is RLS, not this file: `leave_requests_select` returns the row to
 * the requester, their direct manager, security, admin and hr. An unauthorised
 * caller gets no row, so the page renders "not found" and leaks nothing about
 * whether the request exists.
 *
 * Each box is backed by one step of the approval chain (FR-36) or by the
 * request's own signature: تصویب کننده = the manager step, the HR box = the hr
 * step, حراست = a security step nothing seeds yet. جانشین is never signed in the
 * app at all. Any box with no approved step behind it prints empty for a wet
 * signature, and a footnote on the sheet says so.
 */

export const dynamic = 'force-dynamic';

import Image from 'next/image';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getRequestForPrint, getWorkSettings } from '@/lib/actions/leave';
import { WORK_SETTINGS_FALLBACK } from '@/lib/leave/workSettings';
import { paperFormFor, leaveTypeCheckbox, signatureSourceFor } from '@/lib/leave/paperForm';
import { formatCalendarDate } from '@/lib/leave/calendarMonth';
import { formatDuration } from '@/lib/leave/duration';
import { formatTimeRange } from '@/lib/leave/formatTimeRange';
import { formatSerialLocalized } from '@/lib/leave/serial';
import { durationLabelsFrom } from '@/lib/leave/durationLabels';
import { formatPersianConsentTimestamp, localizedLeaveTypeName } from '@/lib/i18n/format';
import { PrintToolbar } from './PrintToolbar';

type Props = { params: Promise<{ locale: string; id: string }> };

/** A labelled cell in the form's grid — the boxed look of the paper original. */
function Cell({
  label,
  value,
  className = '',
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`border border-black px-2 py-1.5 ${className}`}>
      <span className="text-[10px] text-neutral-700">{label} :</span>{' '}
      <span className="text-[12px] font-semibold">{value ?? '—'}</span>
    </div>
  );
}

/** An inline ☐ / ☒ matching the printed checkboxes on BJ-F 50210. */
function Tick({ on, label }: { on: boolean; label: string }) {
  return (
    <span className="mx-1 whitespace-nowrap">
      {label} <span className="text-[13px] font-bold">{on ? '☒' : '☐'}</span>
    </span>
  );
}

export default async function PrintRequestPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('print');
  const tLeave = await getTranslations('leave');
  const durationLabels = durationLabelsFrom(tLeave);
  // Explicit map rather than tLeave(`status.${...}`): a dynamic message key has
  // already caused a production-only failure in this codebase (docs/MEMORY.md).
  const statusLabels: Record<string, string> = {
    pending: tLeave('status.pending'),
    approved: tLeave('status.approved'),
    rejected: tLeave('status.rejected'),
    cancelled: tLeave('status.cancelled'),
  };

  const [result, settingsResult] = await Promise.all([
    getRequestForPrint(id),
    getWorkSettings(),
  ]);
  const hoursPerDay = settingsResult.ok
    ? settingsResult.settings.hoursPerDay
    : WORK_SETTINGS_FALLBACK.hoursPerDay;

  if (!result.ok) {
    return (
      <main className="mx-auto max-w-2xl p-8" data-testid="print-not-found">
        <p className="text-sm">{t('notFound')}</p>
      </main>
    );
  }

  const r = result.request;
  const form = paperFormFor(r.kind, r.unit);
  const isErrand = r.kind === 'errand';
  const isHourly = r.unit === 'hour';

  const date = (iso: string) => formatCalendarDate(iso, locale);
  const duration = formatDuration(r.requested_minutes, hoursPerDay, locale, durationLabels);
  const timeRange = formatTimeRange(r.start_time, r.end_time, locale);
  const typeName = r.leave_type_name_fa
    ? localizedLeaveTypeName(
        { name_fa: r.leave_type_name_fa, name_en: r.leave_type_name_en },
        locale
      )
    : null;
  const tick = leaveTypeCheckbox(r.leave_type_name_en, r.leave_type_name_fa);
  const department =
    (locale === 'fa' ? r.department_name_fa : r.department_name_en) ??
    r.department_name_fa ??
    r.department_name_en;

  // FR-36: each box resolves to either the request's own signature or one step
  // of the approval chain, so the HR box fills itself once HR has signed.
  const stepByRole = new Map(r.approvals.map((a) => [a.stepRole, a]));

  // FR-42: a step may be added beyond the four boxes the client's stationery
  // has — most obviously one naming a specific person, which carries the neutral
  // `employee` role. Those signatures print in a strip below the boxes rather
  // than being dropped, because a sheet that silently omits a captured signature
  // is a false record of who approved.
  //
  // Caveat worth knowing: a person-step created with one of the box roles (the
  // Add dialog never does, but SQL could) prints inside that box instead, and two
  // such steps would collide in `stepByRole`. The strip covers everything else.
  const boxStepRoles = new Set(
    form.boxes
      .map((b) => signatureSourceFor(b))
      .filter((src): src is { kind: 'step'; role: 'manager' | 'hr' | 'security' } => src?.kind === 'step')
      .map((src) => src.role)
  );
  const extraApprovals = r.approvals.filter(
    (a) => a.decision === 'approved' && !boxStepRoles.has(a.stepRole as 'manager' | 'hr' | 'security')
  );
  const resolveBox = (box: Parameters<typeof signatureSourceFor>[0]) => {
    const source = signatureSourceFor(box);
    if (!source) return null;
    if (source.kind === 'requester') {
      return {
        data: r.signature_data,
        at: r.signature_consent_at,
        name: r.employee_name,
      };
    }
    const step = stepByRole.get(source.role);
    // A rejected step is a decision, not an approval — never print its name in a
    // box that reads as authorisation.
    if (!step || step.decision !== 'approved') return null;
    return { data: step.signatureData, at: step.signatureConsentAt, name: step.approverName };
  };

  return (
    <>
      <PrintToolbar
        labels={{ print: t('printButton'), back: t('back') }}
        backHref={`/${locale}/manage/requests`}
      />

      {/* A4-ish sheet. Black on white with hard borders, because this is
          photocopied and filed alongside the handwritten originals. */}
      <main
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
        data-testid="print-form"
        data-form-code={form.code ?? ''}
        className="mx-auto max-w-4xl bg-white p-4 text-black print:max-w-none print:p-0"
      >
        <div className="border-2 border-black">
          {/* ── header ─────────────────────────────────────────────────── */}
          <h1 className="border-b-2 border-black py-2 text-center text-lg font-bold">
            {t(`forms.${form.titleKey}`)}
          </h1>

          {/* Column order matches the photographed original, which in RTL reads
              شماره/تاریخ · logo · کد فرم from right to left. Written in that
              order (not mirrored) so the printed sheet lines up with the paper
              one an HR officer is holding beside it. */}
          <div className="grid grid-cols-[1fr_2fr_1fr] border-b-2 border-black text-center">
            <div className="border-e border-black text-[11px]">
              {/* FR-29: the شماره on the paper form is the PERSONNEL number, not
                  the app's generated serial. The tracking number is printed
                  separately below so the two can never be confused. */}
              <div className="border-b border-black px-2 py-1 text-start">
                {t('serial')} : <strong>{r.personnel_no ?? '—'}</strong>
              </div>
              <div className="px-2 py-1 text-start">
                {t('date')} : <strong>{date(r.created_at.slice(0, 10))}</strong>
              </div>
            </div>
            <div className="flex items-center justify-center gap-2 border-e border-black px-2 py-1">
              <Image
                src="/bj-logo.png"
                alt={t('company')}
                width={80}
                height={40}
                className="h-7 w-auto object-contain"
              />
              <span className="text-base font-bold">{t('company')}</span>
            </div>
            <div className="px-2 py-1">
              <div className="text-[10px]">{t('formCode')}</div>
              <div className="text-[12px] font-bold" dir="ltr">
                {form.code ?? '—'}
              </div>
            </div>
          </div>

          {/* ── body ───────────────────────────────────────────────────── */}
          {isErrand ? (
            <div data-testid="print-body-errand">
              <div className="grid grid-cols-3">
                <Cell label={t('fields.name')} value={r.employee_name} className="border-0 border-b border-e" />
                <Cell label={t('fields.department')} value={department ?? '—'} className="border-0 border-b border-e" />
                <Cell label={t('fields.personnelNo')} value={r.personnel_no ?? '—'} className="border-0 border-b" />
              </div>
              <div className="grid grid-cols-3">
                <Cell label={t('fields.location')} value={r.errand_location ?? '—'} className="border-0 border-b border-e" />
                {isHourly ? (
                  <>
                    <Cell label={t('fields.fromTime')} value={timeRange?.split('–')[0] ?? '—'} className="border-0 border-b border-e" />
                    <Cell label={t('fields.toTime')} value={timeRange?.split('–')[1] ?? '—'} className="border-0 border-b" />
                  </>
                ) : (
                  <>
                    <Cell label={t('fields.from')} value={date(r.start_date)} className="border-0 border-b border-e" />
                    <Cell label={t('fields.to')} value={date(r.end_date)} className="border-0 border-b" />
                  </>
                )}
              </div>
              <div className="min-h-28 border-b border-black px-2 py-1.5">
                <span className="text-[10px] text-neutral-700">{t('fields.description')} :</span>
                <p className="mt-1 text-[12px] whitespace-pre-wrap">{r.reason ?? ''}</p>
              </div>
            </div>
          ) : (
            <div className="space-y-3 border-b border-black px-3 py-3 text-[13px] leading-8" data-testid="print-body-leave">
              <p className="font-semibold">{t('toUnit')}</p>

              {isHourly ? (
                /* BJ-F 50208 wording: name, from/to time, on date, type. */
                <p>
                  <U>{r.employee_name}</U> — {t('fields.fromTime')} <U>{timeRange?.split('–')[0] ?? '—'}</U>{' '}
                  {t('fields.toTime')} <U>{timeRange?.split('–')[1] ?? '—'}</U> {t('fields.from')}{' '}
                  <U>{date(r.start_date)}</U>
                  {typeName ? <> — <U>{typeName}</U></> : null}
                  {r.replacement_name ? (
                    <>
                      {' '}· {t('fields.replacement')} : <U>{r.replacement_name}</U>
                    </>
                  ) : null}
                </p>
              ) : (
                /* BJ-F 50210 wording: name, type checkboxes, from/to, duration,
                   then the replacement introduction. */
                <>
                  <p>
                    <U>{r.employee_name}</U>
                    <span className="mx-2">
                      <Tick on={tick === 'annual'} label={t('types.annual')} />
                      <Tick on={tick === 'sick'} label={t('types.sick')} />
                      <Tick on={tick === 'unpaid'} label={t('types.unpaid')} />
                    </span>
                    {tick === null && typeName ? <U>{typeName}</U> : null}
                  </p>
                  <p>
                    {t('fields.from')} <U>{date(r.start_date)}</U> {t('fields.to')}{' '}
                    <U>{date(r.end_date)}</U> {t('fields.duration')} <U>{duration}</U>
                  </p>
                  <p>
                    {t('fields.replacement')} : <U>{r.replacement_name ?? '—'}</U>
                  </p>
                </>
              )}

              {r.reason ? (
                <p>
                  {t('fields.reason')} : <span className="font-medium">{r.reason}</span>
                </p>
              ) : null}
            </div>
          )}

          {/* ── HR balance line — printed on BJ-F 50210 only ─────────────── */}
          {!isErrand && !isHourly ? (
            <div
              className="grid grid-cols-[1fr_3fr] border-b border-black text-[12px]"
              data-testid="print-balance-line"
            >
              <div className="border-e border-black px-2 py-3 text-center text-[11px] font-semibold">
                {t('hrExpert')}
              </div>
              <div className="px-2 py-3">
                {r.current_balance_minutes !== null
                  ? t('balanceLine', {
                      duration: formatDuration(
                        r.current_balance_minutes,
                        hoursPerDay,
                        locale,
                        durationLabels
                      ),
                    })
                  : '—'}
              </div>
            </div>
          ) : null}

          {/* ── signature boxes ────────────────────────────────────────── */}
          <div className="grid grid-cols-4" data-testid="print-signatures">
            {form.boxes.map((box, i) => {
              const sig = resolveBox(box);
              return (
                <div
                  key={box}
                  data-testid={`print-box-${box}`}
                  className={`min-h-32 px-2 py-1 ${i < form.boxes.length - 1 ? 'border-e border-black' : ''}`}
                >
                  <div className="text-center text-[11px] font-semibold">{t(`boxes.${box}`)}</div>
                  {/* The replacement is named on the form but never signs in the
                      app, so print who it is and leave the space blank. */}
                  {box === 'replacement' && r.replacement_name ? (
                    <div className="mt-1 text-center text-[11px]">{r.replacement_name}</div>
                  ) : null}
                  {box !== 'replacement' && box !== 'requester' && sig?.name ? (
                    <div className="mt-1 text-center text-[11px]">{sig.name}</div>
                  ) : null}
                  {sig?.data ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={sig.data}
                        alt={t(`boxes.${box}`)}
                        className="mx-auto mt-1 h-16 w-auto object-contain"
                        data-testid={`print-signature-${box}`}
                      />
                      {sig.at ? (
                        <div className="text-center text-[9px] text-neutral-600">
                          {formatPersianConsentTimestamp(sig.at, locale)}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        {extraApprovals.length > 0 ? (
          <div className="mx-1 mt-2 border border-black" data-testid="print-extra-approvals">
            <div className="border-b border-black px-2 py-0.5 text-[11px] font-semibold">
              {t('additionalApprovals')}
            </div>
            <div className="flex">
              {extraApprovals.map((a, i) => (
                <div
                  key={a.stepRole + i}
                  className={`min-h-24 flex-1 px-2 py-1 ${
                    i < extraApprovals.length - 1 ? 'border-e border-black' : ''
                  }`}
                  data-testid={`print-extra-approval-${i}`}
                >
                  <div className="text-center text-[11px]">{a.approverName ?? '—'}</div>
                  {a.signatureData ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={a.signatureData}
                        alt={a.approverName ?? ''}
                        className="mx-auto mt-1 h-14 w-auto object-contain"
                      />
                      {a.signatureConsentAt ? (
                        <div className="text-center text-[9px] text-neutral-600">
                          {formatPersianConsentTimestamp(a.signatureConsentAt, locale)}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* Footnotes: on screen and on paper, because someone filing this sheet
            needs to know the balance is as-of-printing and why boxes are empty. */}
        <div className="mx-1 mt-2 space-y-0.5 text-[10px] text-neutral-600">
          <p>
            {t('trackingNo')} : {formatSerialLocalized(r.serial_year, r.serial_seq, locale)} ·{' '}
            {t('fields.status')} : {statusLabels[r.status] ?? r.status}
            {r.requested_minutes ? (
              <>
                {' '}· {t('fields.duration')} : {duration}
              </>
            ) : null}
          </p>
          <p>{t('unsignedNote')}</p>
          {!isErrand && !isHourly ? <p>{t('balanceNote')}</p> : null}
          {form.derived ? <p data-testid="print-derived-note">{t('derivedNote')}</p> : null}
          {r.decision_note ? (
            <p>
              {t('fields.decisionNote')} : {r.decision_note}
            </p>
          ) : null}
        </div>
      </main>
    </>
  );
}

/** An underlined blank, the way the paper form shows a filled-in field. */
function U({ children }: { children: React.ReactNode }) {
  return (
    <span className="mx-1 border-b border-dotted border-black px-2 font-semibold">{children}</span>
  );
}
