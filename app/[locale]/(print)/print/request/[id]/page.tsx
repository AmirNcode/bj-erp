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
import { getWorkSettings } from '@/lib/actions/leave/reference';
import { getRequestForPrint, type PrintableRequest } from '@/lib/actions/leave/review';
import { WORK_SETTINGS_FALLBACK } from '@/lib/leave/workSettings';
import { paperFormFor, leaveTypeCheckbox, stepBoxes } from '@/lib/leave/paperForm';
import { formatCalendarDate } from '@/lib/leave/calendarMonth';
import { formatDuration } from '@/lib/leave/duration';
import { formatTimeRange } from '@/lib/leave/formatTimeRange';
import { formatSerialLocalized } from '@/lib/leave/serial';
import { formatRials } from '@/lib/leave/perDiem';
import { durationLabelsFrom } from '@/lib/leave/durationLabels';
import { formatPersianConsentTimestamp, localizedLeaveTypeName } from '@/lib/i18n/format';
import { PrintToolbar } from './PrintToolbar';
import { printedTripDates } from '@/lib/travel/extensions';

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
  const tx = await getTranslations('travel.extension');
  const tc = await getTranslations('travel.correction');
  const te = await getTranslations('approvalEvidence');
  const ts = await getTranslations('approvals.steps');
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
  const trip = printedTripDates(
    { start: r.start_date, end: r.end_date, perDiem: r.per_diem_rials ?? null },
    r.extensions ?? [],
    r.corrections ?? []
  );
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

  // Spec 2026-11-09: the requester (and on daily leave the replacement) are
  // fixed boxes; every other box is an approval step, titled by the admin.
  const boxes = stepBoxes(r.steps, r.approvals, r.status);
  const stepLabels = {
    manager: ts('manager'), departmentManager: ts('departmentManager'), hr: ts('hr'),
    security: ts('security'), admin: ts('admin'), employee: ts('employee'),
  };
  const timestamp = (at?: string | null) => at && Number.isFinite(Date.parse(at))
    ? formatPersianConsentTimestamp(at, locale) : '—';
  const evidenceText = (step: PrintableRequest['approvals'][number]) => {
    if (step.evidenceKind === 'automatic') return te('automaticStatement', { principal: step.principalName ?? '—' });
    if (step.evidenceKind === 'hr_exempt') return te('hrExempt');
    if (step.evidenceKind === 'delegated') return te('delegatedSignature', { signer: step.approverName ?? '—', principal: step.principalName ?? '—' });
    return null;
  };
  const renderEvidence = (step: PrintableRequest['approvals'][number]) => (
    <div className="mt-1 space-y-1 text-[10px] leading-4" data-approval-step-id={step.stepId ?? 'legacy'}>
      {evidenceText(step) ? <p>{evidenceText(step)}</p> : null}
      {step.evidenceKind === 'automatic' ? <>
        <p>{te('responsibleDelegate', { name: step.delegateName ?? '—' })}</p>
        <p>{te('submittedAt', { at: timestamp(step.submittedAt) })}</p>
        <p>{te('responsibilityAcceptedAt', { at: timestamp(step.responsibilityConsentAt) })}</p>
        <p>{te('automaticallyApprovedAt', { at: timestamp(step.signatureConsentAt) })}</p>
        {step.authorityStatement ? <p>{te('recordedAuthority')} <span dir="auto">{step.authorityStatement}</span></p> : null}
      </> : null}
      {step.authorityRef ? <p className="break-all text-[8px]">{te('authorityRef', { ref: step.authorityRef })}</p> : null}
    </div>
  );
  type Approval = PrintableRequest['approvals'][number];
  /** A signature that prints: approved, or evidence that stands in for one. */
  const printed = (a: Approval | null) =>
    !!a && (a.decision === 'approved' || a.evidenceKind === 'hr_exempt');
  const roleTitle = (a: Approval | null) => !a ? '—'
    : a.named ? a.expectedName ?? stepLabels.employee
    : stepLabels[a.departmentStep ? 'departmentManager' : a.stepRole];
  const signatureImage = (data: string | null, at: string | null, alt: string, testId: string) => data ? (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={data} alt={alt} className="mx-auto mt-1 h-16 w-auto object-contain" data-testid={testId} />
      {at ? (
        <div className="text-center text-[9px] text-neutral-600">{formatPersianConsentTimestamp(at, locale)}</div>
      ) : null}
    </>
  ) : null;
  const boxCount = 1 + (form.replacementBox ? 1 : 0) + boxes.length;
  const columns = Math.min(boxCount, 4);
  const boxClass = 'min-h-32 border-e border-b border-black px-2 py-1';
  const boxTitle = (title: string) => (
    <div className="text-center text-[11px] font-semibold">{title}</div>
  );

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
                    <Cell label={t('fields.from')} value={date(trip.signedStart)} className="border-0 border-b border-e" />
                    <Cell label={t('fields.to')} value={date(trip.signedEnd)} className="border-0 border-b" />
                  </>
                )}
              </div>
              {trip.signedPerDiem != null && (
                <div className="border-b border-black px-2 py-1.5 text-[12px]" data-testid="print-per-diem">
                  <span className="text-[10px] text-neutral-700">{t('fields.perDiem')} :</span>{' '}
                  <strong>{formatRials(trip.signedPerDiem, locale)}</strong>
                  {r.per_diem_by_requester && <span className="text-[10px]"> — {t('perDiemByRequester')}</span>}
                </div>
              )}
              {trip.changes.map((c) => (
                <div
                  key={`${c.kind}-${c.at}`}
                  className="border-b border-black px-2 py-1.5 text-[12px]"
                  data-testid={c.kind === 'extension' ? 'print-extension' : 'print-correction'}
                >
                  {c.kind === 'extension'
                    ? [
                        tx('printLine', { date: date(c.end), reason: c.reason }),
                        c.perDiemChanged && c.perDiem !== null
                          && tc('printPerDiem', { amount: formatRials(c.perDiem, locale) }),
                      ].filter(Boolean).join(' — ')
                    : [
                        c.datesChanged && tc('printDates', { start: date(c.start), end: date(c.end) }),
                        c.perDiemChanged && c.perDiem !== null
                          && tc('printPerDiem', { amount: formatRials(c.perDiem, locale) }),
                      ].filter(Boolean).concat(c.reason).join(' — ')}
                </div>
              ))}
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
                    {t('fields.replacement')} :{' '}
                    <U>{r.replacement_name ?? <span data-testid="print-no-replacement">{t('noReplacement')}</span>}</U>
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
          {/* Up to four per row, wrapping. Each box draws its end and bottom
              rule; the wrapper's negative margin hides the outermost ones under
              the form's own border. */}
          <div className="overflow-hidden">
          <div
            className="-mb-px -me-px grid"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
            data-testid="print-signatures"
          >
            <div className={boxClass} data-testid="print-box-requester">
              {boxTitle(t('boxes.requester'))}
              {signatureImage(r.signature_data, r.signature_consent_at, t('boxes.requester'), 'print-signature-requester')}
            </div>
            {form.replacementBox ? (
              <div className={boxClass} data-testid="print-box-replacement">
                {boxTitle(t('boxes.replacement'))}
                <div className="mt-1 text-center text-[11px]">
                  {r.replacement_name ?? t('noReplacement')}
                </div>
                {/* FR-88: the replacement signs in the app; a decline goes back to
                    the requester, so the box says so until they choose again. */}
                {r.replacement_signature_status === 'declined' ? (
                  <p className="mt-1 text-center text-[10px]" data-testid="print-replacement-declined">
                    {t('replacementDeclined')}
                  </p>
                ) : null}
                {r.replacement_signature_status === 'signed'
                  ? signatureImage(r.replacement_signature_data ?? null, r.replacement_signature_consent_at ?? null,
                      t('boxes.replacement'), 'print-signature-replacement')
                  : null}
              </div>
            ) : null}
            {boxes.map((box) => {
              const a = box.approval;
              const signed = printed(a);
              // Who signed; while still open, who is expected to (helps a wet signature).
              const name = signed ? a?.approverName ?? null : a?.decision ? null : a?.expectedName ?? null;
              return (
                <div key={box.key} className={boxClass} data-testid={`print-box-step-${box.key}`}>
                  {boxTitle(box.title ?? roleTitle(a))}
                  {box.notRequired ? (
                    <p className="mt-2 text-center text-[11px]" data-testid={`print-not-required-${box.key}`}>
                      {t('notRequired')}
                    </p>
                  ) : null}
                  {name ? <div className="mt-1 text-center text-[11px]">{name}</div> : null}
                  {a && signed ? renderEvidence(a) : null}
                  {a && signed && !a.signatureData && a.signatureConsentAt && a.evidenceKind !== 'automatic'
                    ? <p className="mt-1 text-[9px]">{formatPersianConsentTimestamp(a.signatureConsentAt, locale)}</p>
                    : null}
                  {a && signed
                    ? signatureImage(a.signatureData, a.signatureConsentAt, box.title ?? roleTitle(a), `print-signature-step-${box.key}`)
                    : null}
                </div>
              );
            })}
          </div>
          </div>
        </div>

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
