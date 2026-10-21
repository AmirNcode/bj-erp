'use client';

/**
 * FR-73 booking form pieces: one labelled field (text, time or Jalali date)
 * with its inline error, and the section frame. Dates and times travel as
 * Gregorian ISO and HH:MM strings; empty string = not filled.
 */

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PersianDateField } from '@/components/PersianDateField';
import { dateObjectToGregorian, gregorianToPersianDateObject } from '@/lib/leave/dateConvert';
import type { ItineraryErrorKey } from '@/lib/travel/itinerary';
import { cn } from '@/lib/utils';

export type FieldErrors = Record<string, ItineraryErrorKey>;

type FieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: ItineraryErrorKey;
  kind?: 'text' | 'time' | 'date' | 'tel';
  locale: string;
  /** Latin codes and numbers read left to right even in Farsi. */
  ltr?: boolean;
  className?: string;
};

export function ItineraryField({ id, label, value, onChange, error, kind = 'text', locale, ltr, className }: FieldProps) {
  const t = useTranslations('travel.itinerary.errors');
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {kind === 'date' ? (
        <PersianDateField
          id={id}
          locale={locale}
          value={value ? gregorianToPersianDateObject(value, locale) : null}
          onChange={(d) => onChange(d ? dateObjectToGregorian(d) : '')}
          testId={id}
        />
      ) : (
        <Input
          id={id}
          type={kind}
          dir={ltr || kind !== 'text' ? 'ltr' : undefined}
          inputMode={kind === 'tel' ? 'tel' : undefined}
          autoComplete="off"
          value={value}
          maxLength={id.endsWith('address') ? 200 : 100}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          data-testid={id}
        />
      )}
      {error && (
        <p id={errorId} className="text-xs text-destructive">
          {t(error)}
        </p>
      )}
    </div>
  );
}

export function ItinerarySection({
  icon,
  title,
  aside,
  children,
  testId,
}: {
  icon: ReactNode;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section className="space-y-4 rounded-xl border border-border p-4" data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <span aria-hidden className="text-primary [&_svg]:size-4">
            {icon}
          </span>
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function CheckboxRow({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-sm">
      <input id={id} type="checkbox" className="size-4" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={id} />
      {label}
    </label>
  );
}
