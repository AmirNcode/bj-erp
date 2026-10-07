'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PersianDateField } from '@/components/PersianDateField';
import { nativeSelectClass } from '@/lib/native-select';
import { dateObjectToGregorian, type PickerDate } from '@/lib/leave/dateConvert';
import { todayInAppTz } from '@/lib/appDate';
import { toAsciiDigits } from '@/lib/employees/code';
import {
  createClearance,
  getLeaverPrefill,
  type LeaverWarnings,
  type PersonOption,
} from '@/lib/actions/clearance';
import {
  SEPARATION_REASONS,
  draftRowsFromUnits,
  type DraftRow,
  type SeparationReason,
  type UnitRow,
} from '@/lib/clearance/model';
import { RowsEditor } from '../_components/RowsEditor';

type Props = {
  locale: string;
  /** Who may be filed for: everyone active except the caller. */
  people: PersonOption[];
  /** Every active person, for the signer pickers. */
  allPeople: PersonOption[];
  units: UnitRow[];
  departmentManagers: Record<string, string | null>;
};

type Prefill = {
  fatherName: string | null;
  birthCertNo: string | null;
  warnings: LeaverWarnings;
};

export function NewClearanceForm({ locale, people, allPeople, units, departmentManagers }: Props) {
  const t = useTranslations('clearance');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [query, setQuery] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const [reason, setReason] = useState<SeparationReason | ''>('');
  const [lastDay, setLastDay] = useState<PickerDate | null>(null);
  const [fatherName, setFatherName] = useState('');
  const [birthCertNo, setBirthCertNo] = useState('');
  const [note, setNote] = useState('');
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [error, setError] = useState('');

  // Explicit map, not t(`reasons.${r}`): a dynamic message key has already caused a
  // production-only failure in this codebase (docs/MEMORY.md).
  const reasonLabel: Record<SeparationReason, string> = {
    resignation: t('reasons.resignation'),
    dismissal: t('reasons.dismissal'),
    contract_end: t('reasons.contract_end'),
    abandonment: t('reasons.abandonment'),
    redundancy: t('reasons.redundancy'),
  };
  const managers = useMemo(() => new Map(Object.entries(departmentManagers)), [departmentManagers]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return people;
    return people.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.personnelNo ?? '').includes(q) || p.id === employeeId
    );
  }, [people, query, employeeId]);

  const pickEmployee = (id: string) => {
    setEmployeeId(id);
    setPrefill(null);
    setError('');
    if (!id) {
      setRows([]);
      return;
    }
    const person = people.find((p) => p.id === id);
    setRows(
      draftRowsFromUnits(units, {
        leaverId: id,
        leaverDepartmentId: person?.departmentId ?? null,
        departmentManagers: managers,
      })
    );
    startTransition(async () => {
      const res = await getLeaverPrefill(id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPrefill(res);
      setFatherName(res.fatherName ?? '');
      setBirthCertNo(res.birthCertNo ?? '');
    });
  };

  const lastDayIso = lastDay ? dateObjectToGregorian(lastDay) : '';
  const pastDate = !!lastDayIso && lastDayIso < todayInAppTz();
  const w = prefill?.warnings;
  const warnings = w
    ? [
        w.pendingRequests > 0 && t('new.warnPending', { count: w.pendingRequests }),
        w.directReports > 0 && t('new.warnReports', { count: w.directReports }),
        w.departmentsManaged > 0 && t('new.warnDepartments', { count: w.departmentsManaged }),
        w.approvalSteps > 0 && t('new.warnSteps', { count: w.approvalSteps }),
      ].filter((x): x is string => !!x)
    : [];

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (!employeeId) return setError(t('new.pickFirst'));
    if (!reason) return setError(t('fields.reason'));
    if (!lastDayIso) return setError(t('fields.lastWorkingDay'));
    startTransition(async () => {
      const res = await createClearance({
        employeeId,
        reason,
        lastWorkingDay: lastDayIso,
        fatherName: prefill?.fatherName ? null : fatherName,
        birthCertNo: prefill?.birthCertNo ? null : birthCertNo,
        note,
        rows,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(`/${locale}/profile/clearance/${res.id}`);
    });
  };

  return (
    <form onSubmit={submit} className="space-y-5" data-testid="clearance-new-form">
      <div className="space-y-1.5">
        <Label htmlFor="clearance-employee">{t('fields.employee')}</Label>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('new.search')}
          aria-label={t('new.search')}
          data-testid="clearance-employee-search"
        />
        <select
          id="clearance-employee"
          className={nativeSelectClass}
          value={employeeId}
          onChange={(e) => pickEmployee(e.target.value)}
          data-testid="clearance-employee"
        >
          <option value="">{t('new.chooseEmployee')}</option>
          {shown.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.personnelNo ? ` (${p.personnelNo})` : ''}
            </option>
          ))}
        </select>
      </div>

      {warnings.length > 0 && (
        <div
          role="status"
          className="rounded-lg border border-warning/30 bg-warning-foreground p-3 text-sm text-warning"
          data-testid="clearance-warnings"
        >
          <p className="font-semibold">{t('new.warningsTitle')}</p>
          <ul className="mt-1 list-disc ps-5">
            {warnings.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </div>
      )}

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t('fields.reason')}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {SEPARATION_REASONS.map((r) => (
            <label key={r} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="reason"
                value={r}
                checked={reason === r}
                onChange={() => setReason(r)}
                className="size-4"
                data-testid={`clearance-reason-${r}`}
              />
              {reasonLabel[r]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="space-y-1.5">
        <Label htmlFor="clearance-last-day">{t('fields.lastWorkingDay')}</Label>
        <PersianDateField
          id="clearance-last-day"
          locale={locale}
          value={lastDay}
          onChange={setLastDay}
          testId="clearance-last-day"
        />
        {pastDate && (
          <p className="text-xs text-warning" data-testid="clearance-past-date">
            {t('new.pastDate')}
          </p>
        )}
      </div>

      {employeeId && prefill && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="clearance-father">{t('fields.fatherName')}</Label>
            <Input
              id="clearance-father"
              value={fatherName}
              onChange={(e) => setFatherName(e.target.value)}
              readOnly={!!prefill.fatherName}
              maxLength={100}
              data-testid="clearance-father"
            />
            <p className="text-xs text-muted-foreground">
              {prefill.fatherName ? t('new.prefilledHint') : t('new.typedHint')}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="clearance-cert">{t('fields.birthCertNo')}</Label>
            <Input
              id="clearance-cert"
              value={birthCertNo}
              onChange={(e) => setBirthCertNo(toAsciiDigits(e.target.value).replace(/[^0-9]/g, ''))}
              readOnly={!!prefill.birthCertNo}
              inputMode="numeric"
              maxLength={10}
              dir="ltr"
              data-testid="clearance-cert"
            />
            <p className="text-xs text-muted-foreground">
              {prefill.birthCertNo ? t('new.prefilledHint') : t('new.typedHint')}
            </p>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="clearance-note">{t('fields.note')}</Label>
        <Textarea
          id="clearance-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('fields.notePlaceholder')}
          maxLength={500}
          data-testid="clearance-note"
        />
      </div>

      {employeeId && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">{t('rows.title')}</h2>
          <RowsEditor rows={rows} onChange={setRows} people={allPeople} leaverId={employeeId} locale={locale} />
        </section>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive" data-testid="clearance-error">
          {error}
        </p>
      )}

      <Button type="submit" disabled={isPending} data-testid="clearance-submit">
        {isPending ? t('new.submitting') : t('new.submit')}
      </Button>
    </form>
  );
}
