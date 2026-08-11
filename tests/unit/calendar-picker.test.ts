import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import persian from 'react-date-object/calendars/persian';
import persian_fa from 'react-date-object/locales/persian_fa';
import persian_en from 'react-date-object/locales/persian_en';
import { calendarPickerConfig } from '@/lib/leave/calendarPicker';

describe('calendarPickerConfig', () => {
  it('uses a Persian calendar and Farsi locale for the Farsi interface', () => {
    const config = calendarPickerConfig('fa');

    expect(config.calendar).toBe(persian);
    expect(config.calLocale).toBe(persian_fa);
    expect(config.calendarPosition).toBe('bottom-right');
  });

  it('keeps the Persian calendar when the interface language is English', () => {
    const config = calendarPickerConfig('en');

    expect(config.calendar).toBe(persian);
    expect(config.calLocale).toBe(persian_en);
    expect(config.calendarPosition).toBe('bottom-left');
  });

  it('wires the employee hire-date picker permanently to Jalali', () => {
    const pageSource = readFileSync(
      'app/[locale]/(app)/manage/employees/new/page.tsx',
      'utf8'
    );
    const formSource = readFileSync(
      'app/[locale]/(app)/manage/employees/new/NewEmployeeForm.tsx',
      'utf8'
    );

    expect(pageSource).not.toContain('calendarPref');
    expect(formSource).toContain('data-testid="hire-date-picker"');
    expect(formSource).toContain('data-calendar="jalali"');
    expect(formSource).toContain('dateObjectToGregorian(hireDate)');
  });
});
