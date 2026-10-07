'use client';

/** Pieces shared by the Add and Edit employee forms. */

import { useLocale, useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatNumber } from '@/lib/i18n/format';
import {
  daysHoursToMinutes,
  minutesToDaysHours,
  type DaysHoursError,
} from '@/lib/leave/duration';

// Rendered as raw slugs. The e2e `createEmployee` helper picks these checkboxes
// by their exact label text, so translating them is a separate, deliberate
// change (docs/TASKS.md).
export const ROLES = ['admin', 'manager', 'employee', 'security', 'hr'] as const;
export type Role = (typeof ROLES)[number];

/** Stable test-id slug for a leave type: `annual`, `sick`, or its English name. */
export function leaveTypeSlug(type: { name_en: string | null; name_fa: string }) {
  const label = (type.name_en ?? type.name_fa).toLowerCase();
  if (label.includes('annual')) return 'annual';
  if (label.includes('sick')) return 'sick';
  return label.replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'leave';
}

/**
 * A leave amount as whole days plus whole hours. The ledger stores minutes, and
 * a decimal-days box could not hold an uploaded "3 days 6 hours" (3.75) — the
 * browser refused to submit the whole form.
 *
 * Uncontrolled: inputs `<name>_days` and `<name>_hours`, plus a hidden
 * `<name>_rest` carrying the minutes below a whole hour (from hourly leave) that
 * the form does not show but must not lose. Read them back with readDaysHours.
 */
export function DaysHoursField({
  name,
  label,
  minutes,
  hoursPerDay,
  allowNegative,
  testId,
  hoursTestId,
  hint,
  error,
  leaveTypeId,
  legendClassName = 'text-sm font-medium',
}: {
  name: string;
  label: string;
  /** Stored amount, in minutes. */
  minutes: number;
  hoursPerDay: number;
  /** A balance may be negative (FR-48); a policy amount may not. */
  allowNegative: boolean;
  testId: string;
  hoursTestId: string;
  hint?: string;
  error?: DaysHoursError;
  /** Exposed on the days input, with the stored minutes, for the e2e helpers. */
  leaveTypeId?: string;
  legendClassName?: string;
}) {
  const t = useTranslations('manage.employees.duration');
  const locale = useLocale();
  const { days, hours, minutes: rest } = minutesToDaysHours(minutes, hoursPerDay);
  const maxHours = Math.ceil(hoursPerDay) - 1;
  const hintId = `${name}_hint`;
  const errorId = `${name}_error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');
  const inputProps = {
    type: 'number',
    step: 1,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy || undefined,
    className: 'min-w-0',
  } as const;

  return (
    <fieldset className="space-y-1">
      <legend className={legendClassName}>{label}</legend>
      <div className="flex gap-2">
        <div className="flex flex-1 items-center gap-1.5">
          <Input
            {...inputProps}
            id={`${name}_days`}
            name={`${name}_days`}
            min={allowNegative ? -366 : 0}
            max={366}
            defaultValue={days}
            data-testid={testId}
            data-leave-type-id={leaveTypeId}
            data-minutes={minutes}
          />
          <Label htmlFor={`${name}_days`} className="shrink-0 text-xs font-normal text-muted-foreground">
            {t('days')}
          </Label>
        </div>
        <div className="flex flex-1 items-center gap-1.5">
          <Input
            {...inputProps}
            id={`${name}_hours`}
            name={`${name}_hours`}
            min={allowNegative ? -maxHours : 0}
            max={maxHours}
            defaultValue={hours}
            data-testid={hoursTestId}
          />
          <Label htmlFor={`${name}_hours`} className="shrink-0 text-xs font-normal text-muted-foreground">
            {t('hours')}
          </Label>
        </div>
      </div>
      <input type="hidden" name={`${name}_rest`} value={rest} />
      {rest !== 0 && (
        <p className="text-xs text-muted-foreground">
          {t('restNote', { minutes: formatNumber(Math.abs(rest), locale) })}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {t(`errors.${error}`, { max: formatNumber(maxHours, locale) })}
        </p>
      )}
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </fieldset>
  );
}

/** Reads one DaysHoursField back from FormData as minutes. An emptied box counts as 0. */
export function readDaysHours(
  fd: FormData,
  name: string,
  hoursPerDay: number,
  opts: { allowNegative: boolean }
) {
  const read = (part: 'days' | 'hours' | 'rest') => {
    const raw = String(fd.get(`${name}_${part}`) ?? '').trim();
    return raw === '' ? 0 : Number(raw);
  };
  return daysHoursToMinutes(
    { days: read('days'), hours: read('hours'), restMinutes: read('rest') },
    hoursPerDay,
    opts
  );
}

/** Native checkboxes: the e2e suite checks them through their label text. */
export function RoleCheckboxes({
  label,
  selected,
  onChange,
}: {
  label: string;
  selected: Role[];
  onChange: (roles: Role[]) => void;
}) {
  return (
    <div className="space-y-2">
      <span className="block text-sm font-medium leading-none">{label}</span>
      <div className="flex flex-wrap gap-3">
        {ROLES.map((role) => (
          <label key={role} className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={selected.includes(role)}
              onChange={() =>
                onChange(
                  selected.includes(role) ? selected.filter((r) => r !== role) : [...selected, role]
                )
              }
              className="rounded border-input text-primary focus:ring-ring"
            />
            <span className="text-sm">{role}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export type PolicyLabels = {
  policyRate: string;
  policyRateHint: string;
  policyAnnualCap: string;
  policyAnnualCapHint: string;
  policyCarryCap: string;
  policyCarryCapHint: string;
};

/** Minutes per policy field. `cap` 0 means no yearly cap. */
export type PolicyMinutes = { rate: number; cap: number; carry: number };

export const policyFieldName = (key: keyof PolicyMinutes, leaveTypeId: string) =>
  `policy_${key}_${leaveTypeId}`;

/**
 * One leave type's accrual policy as three DaysHoursFields, named by
 * policyFieldName. The forms read them from FormData on submit.
 */
export function AccrualPolicyFields({
  leaveTypeId,
  slug,
  legend,
  defaults,
  hoursPerDay,
  errors,
  labels,
}: {
  leaveTypeId: string;
  slug: string;
  legend: string;
  defaults: PolicyMinutes;
  hoursPerDay: number;
  /** Validation errors from the last submit, keyed by field name. */
  errors: Record<string, DaysHoursError>;
  labels: PolicyLabels;
}) {
  const fields = [
    { key: 'rate', label: labels.policyRate, hint: labels.policyRateHint },
    { key: 'cap', label: labels.policyAnnualCap, hint: labels.policyAnnualCapHint },
    { key: 'carry', label: labels.policyCarryCap, hint: labels.policyCarryCapHint },
  ] as const;
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">{legend}</legend>
      {/* Three days+hours pairs fit side by side only in a wide card: the
          breakpoint follows the card, not the viewport, since the sidebar
          takes a variable share of the screen. */}
      <div className="@container">
        <div className="grid gap-3 @3xl:grid-cols-3">
          {fields.map((field) => {
            const name = policyFieldName(field.key, leaveTypeId);
            return (
              <DaysHoursField
                key={field.key}
                name={name}
                label={field.label}
                legendClassName="text-xs font-medium"
                minutes={defaults[field.key]}
                hoursPerDay={hoursPerDay}
                allowNegative={false}
                testId={`policy-${field.key}-${slug}`}
                hoursTestId={`policy-${field.key}-hours-${slug}`}
                hint={field.hint}
                error={errors[name]}
              />
            );
          })}
        </div>
      </div>
    </fieldset>
  );
}

/**
 * Reads the DaysHoursFields of one submit. A field that fails validation reads
 * as 0 and lands in `errors`, so the caller can check every field before making
 * any write.
 */
export function leaveAmountReader(fd: FormData, hoursPerDay: number) {
  const errors: Record<string, DaysHoursError> = {};
  const read = (name: string, allowNegative: boolean) => {
    const result = readDaysHours(fd, name, hoursPerDay, { allowNegative });
    if (result.ok) return result.minutes;
    errors[name] = result.error;
    return 0;
  };
  const policy = (leaveTypeId: string): PolicyMinutes => ({
    rate: read(policyFieldName('rate', leaveTypeId), false),
    cap: read(policyFieldName('cap', leaveTypeId), false),
    carry: read(policyFieldName('carry', leaveTypeId), false),
  });
  return { read, policy, errors };
}
