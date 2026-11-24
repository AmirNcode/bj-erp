'use client';

/**
 * FR-94 ERP › Sales: small shared pieces of the module's screens — labelled
 * fields, date / number / person inputs, formatting, and the "run an action,
 * show the error, refresh" hook every editor uses.
 */

import { createContext, useCallback, useContext, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { PersianDateField } from '@/components/PersianDateField';
import { PersonSearch } from '@/components/PersonSearch';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { toAsciiDigits } from '@/lib/employees/code';
import { formatNumber } from '@/lib/i18n/format';
import { formatCalendarDate } from '@/lib/leave/calendarMonth';
import { dateObjectToGregorian, gregorianToPersianDateObject } from '@/lib/leave/dateConvert';
import { nativeSelectClass } from '@/lib/native-select';
import { cn } from '@/lib/utils';
import type { DeadlineState } from '@/lib/sales/deadlines';
import { currencyLabel, formatCompactMoney, formatMoney } from '@/lib/sales/money';
import type { CustomValues, Currency, FieldDef, Person, Product, Stage } from '@/lib/sales/types';

type Result = { ok: true } | { ok: false; error: string };

/** Run a server action: pending flag, error toast, page refresh on success. */
export function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (action: () => Promise<Result>, onDone?: () => void): Promise<boolean> => {
      setBusy(true);
      try {
        const result = await action();
        if (!result.ok) {
          toast.error(result.error);
          return false;
        }
        onDone?.();
        start(() => router.refresh());
        return true;
      } finally {
        setBusy(false);
      }
    },
    [router]
  );
  return { run, pending: busy || pending };
}

export function Field({ label, children, className, hint }: {
  label: string; children: React.ReactNode; className?: string; hint?: string;
}) {
  return (
    <label className={cn('flex min-w-0 flex-col gap-1.5 text-sm', className)}>
      <span className="font-medium text-foreground">{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

/** A Persian date picker over a stored Gregorian `YYYY-MM-DD` (null = empty). */
export function DateInput({ value, onChange, testId, disabled }: {
  value: string | null; onChange: (iso: string | null) => void; testId?: string; disabled?: boolean;
}) {
  const locale = useLocale();
  return (
    <PersianDateField
      portal
      locale={locale}
      value={value ? gregorianToPersianDateObject(value, locale) : null}
      onChange={(d) => onChange(d ? dateObjectToGregorian(d) : null)}
      testId={testId}
      disabled={disabled}
    />
  );
}

/** Text → number, accepting Persian digits and thousands separators; null when empty or not a number. */
export function parseNumber(raw: string): number | null {
  const cleaned = toAsciiDigits(raw).replace(/[,،٬\s]/g, '').replace(/٫/g, '.');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

/** Number input that takes Persian digits; hands back a number or null. */
export function NumberInput({ value, onChange, className, ariaLabel, disabled, testId }: {
  value: number | null | undefined; onChange: (n: number | null) => void; className?: string;
  ariaLabel?: string; disabled?: boolean; testId?: string;
}) {
  const [text, setText] = useState(value === null || value === undefined ? '' : String(value));
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    if (parseNumber(text) !== (value ?? null)) setText(value === null || value === undefined ? '' : String(value));
  }
  return (
    <Input
      dir="ltr"
      inputMode="decimal"
      aria-label={ariaLabel}
      data-testid={testId}
      disabled={disabled}
      className={cn('text-end tabular-nums', className)}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value.trim() === '' ? null : parseNumber(e.target.value));
      }}
    />
  );
}

export function Select({ value, onChange, children, ariaLabel, className, disabled, testId }: {
  value: string; onChange: (v: string) => void; children: React.ReactNode; ariaLabel?: string;
  className?: string; disabled?: boolean; testId?: string;
}) {
  return (
    <select
      className={cn(nativeSelectClass, className)}
      value={value}
      aria-label={ariaLabel}
      data-testid={testId}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      {children}
    </select>
  );
}

export function PersonPick({ people, value, onChange, testId, ariaLabel }: {
  people: Person[]; value: string | null; onChange: (id: string | null) => void; testId: string; ariaLabel?: string;
}) {
  return (
    <PersonSearch
      people={people.map((p) => ({ id: p.id, name: p.name, personnelNo: p.personnel_no }))}
      value={value}
      onChange={onChange}
      testId={testId}
      ariaLabel={ariaLabel}
      autoChoose={false}
    />
  );
}

/** One extra (custom) field, by its type. */
export function CustomFieldInput({ def, value, onChange }: {
  def: FieldDef; value: CustomValues[string] | undefined; onChange: (v: CustomValues[string] | null) => void;
}) {
  const t = useTranslations('sales');
  if (def.type === 'number') {
    return <NumberInput value={typeof value === 'number' ? value : null} onChange={onChange} />;
  }
  if (def.type === 'date') {
    return <DateInput value={typeof value === 'string' && value ? value : null} onChange={onChange} />;
  }
  if (def.type === 'yes_no') {
    return (
      <Select value={value === true ? 'yes' : value === false ? 'no' : ''} onChange={(v) => onChange(v === '' ? null : v === 'yes')}>
        <option value="">—</option>
        <option value="yes">{t('yes')}</option>
        <option value="no">{t('no')}</option>
      </Select>
    );
  }
  if (def.type === 'select') {
    return (
      <Select value={typeof value === 'string' ? value : ''} onChange={(v) => onChange(v || null)}>
        <option value="">—</option>
        {def.options.map((o) => <option key={o} value={o}>{o}</option>)}
      </Select>
    );
  }
  return <Input value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value || null)} />;
}

const CurrenciesContext = createContext<Currency[]>([]);

/** The company's currency list (boot.currencies), filled once in sales/layout.tsx. */
export function SalesCurrenciesProvider({ currencies, children }: { currencies: Currency[]; children: React.ReactNode }) {
  return <CurrenciesContext.Provider value={currencies}>{children}</CurrenciesContext.Provider>;
}

export function useSalesCurrencies(): Currency[] {
  return useContext(CurrenciesContext);
}

const ProductsContext = createContext<Product[]>([]);

/** The company's products, filled on the record page (item rows pick from them). */
export function SalesProductsProvider({ products, children }: { products: Product[]; children: React.ReactNode }) {
  return <ProductsContext.Provider value={products}>{children}</ProductsContext.Provider>;
}

export function useSalesProducts(): Product[] {
  return useContext(ProductsContext);
}

/** Formatting bound to the page locale. */
export function useSalesFormat() {
  const locale = useLocale();
  const t = useTranslations('sales');
  const currencies = useSalesCurrencies();
  return {
    currencies,
    /** The currency's name in the page language (the raw code when unknown). */
    currencyLabel: (code: string | null | undefined) => currencyLabel(code, currencies, locale),
    /** Picker options: the active currencies, plus `current` when it was retired since. */
    currencyOptions: (current?: string | null) =>
      currencies.filter((c) => c.active || c.code === current).sort((a, b) => a.position - b.position),
    locale,
    date: (iso: string | null | undefined) => (iso ? formatCalendarDate(iso.slice(0, 10), locale) : '—'),
    number: (n: number | null | undefined) => (typeof n === 'number' ? formatNumber(n, locale) : '—'),
    money: (n: number | null | undefined, currency: string | null | undefined) =>
      formatMoney(n, currency, currencies, locale),
    /** Compact amount for the metric tiles (207.5B €); the exact value goes in `money`. */
    compactMoney: (n: number, currency: string) => formatCompactMoney(n, currency, currencies, locale),
    percent: (fraction: number | null | undefined) =>
      typeof fraction === 'number' ? `${formatNumber(fraction * 100, locale)}${locale === 'fa' ? '٪' : '%'}` : '—',
    recordNo: (n: number) => String(n),
    stageName: (s: Stage | undefined) => (s ? (locale === 'fa' ? s.name_fa : s.name_en) : '—'),
    fieldLabel: (d: FieldDef) => (locale === 'fa' ? d.label_fa : d.label_en),
    custom: (def: FieldDef, value: CustomValues[string] | undefined): string => {
      if (value === undefined || value === null || value === '') return '—';
      if (def.type === 'yes_no') return value === true ? t('yes') : t('no');
      if (def.type === 'date' && typeof value === 'string') return formatCalendarDate(value, locale);
      if (def.type === 'number' && typeof value === 'number') return formatNumber(value, locale);
      return String(value);
    },
    daysText: (left: number) =>
      left < 0 ? t('deadline.overdueBy', { days: -left }) : left === 0 ? t('deadline.today') : t('deadline.inDays', { days: left }),
  };
}

export const DEADLINE_TONE: Record<DeadlineState, string> = {
  overdue: 'text-destructive font-semibold',
  soon: 'text-warning font-semibold',
  ok: 'text-muted-foreground',
};

/** Square tag (Blueprint): roles, kinds, small states. */
export function Tag({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'good' | 'bad' | 'warn' }) {
  const tones = {
    neutral: 'bg-secondary text-secondary-foreground',
    good: 'bg-success-foreground text-success',
    bad: 'bg-destructive/10 text-destructive',
    warn: 'bg-warning-foreground text-warning',
  } as const;
  return <span className={cn('inline-block rounded-sm px-1.5 py-0.5 text-xs whitespace-nowrap', tones[tone])}>{children}</span>;
}

/** A yes / cancel question before something is removed. */
export function ConfirmDialog({ title, body, confirmLabel, cancelLabel, pending, onConfirm, onClose }: {
  title: string; body: string; confirmLabel: string; cancelLabel: string; pending?: boolean;
  onConfirm: () => void; onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>{cancelLabel}</Button>
          <Button pending={pending} variant="outline" className="text-destructive" onClick={onConfirm} disabled={pending} data-testid="sales-confirm">{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const inCalendar = (target: EventTarget | null) => target instanceof Element && target.closest('.rmdp-portal') !== null;

/**
 * DialogContent for the Sales dialogs. Their date fields draw the calendar on the page body
 * (so a scrolling dialog cannot cut it off); a press or focus there must not count as
 * "outside the dialog" and close it.
 */
export function ModalContent({ onPointerDownOutside, onInteractOutside, ...props }: React.ComponentProps<typeof DialogContent>) {
  return (
    <DialogContent
      {...props}
      onPointerDownOutside={(e) => {
        if (inCalendar(e.target)) e.preventDefault();
        else onPointerDownOutside?.(e);
      }}
      onInteractOutside={(e) => {
        if (inCalendar(e.target)) e.preventDefault();
        else onInteractOutside?.(e);
      }}
    />
  );
}
