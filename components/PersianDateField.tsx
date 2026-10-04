'use client';

import { LazyDatePicker } from '@/components/LazyDatePicker';
import { calendarPickerConfig } from '@/lib/leave/calendarPicker';
import type { PickerDate } from '@/lib/leave/dateConvert';

const INPUT_CLASS =
  'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';

type Props = {
  locale: string;
  value: PickerDate | null;
  onChange: (value: PickerDate | null) => void;
  id?: string;
  minDate?: PickerDate | null;
  /** Put on the wrapper, for e2e. */
  testId?: string;
};

/**
 * The app's date input: a Persian (Jalali) picker, right-to-left in Farsi.
 * Enter commits the date inside the picker and must not also submit the form.
 */
export function PersianDateField({ locale, value, onChange, id, minDate, testId }: Props) {
  const { isRtl, calendar, calLocale, calendarPosition } = calendarPickerConfig(locale);

  return (
    <div
      style={{ direction: isRtl ? 'rtl' : 'ltr' }}
      className="w-full"
      data-testid={testId}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.preventDefault();
      }}
    >
      <LazyDatePicker
        id={id}
        value={value}
        onChange={(date: PickerDate | null) => onChange(date ?? null)}
        minDate={minDate ?? undefined}
        calendar={calendar}
        locale={calLocale}
        calendarPosition={calendarPosition}
        inputClass={INPUT_CLASS}
        containerClassName="rmdp-container w-full"
        format="YYYY/MM/DD"
      />
    </div>
  );
}
