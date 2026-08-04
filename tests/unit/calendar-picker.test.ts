import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import persian from 'react-date-object/calendars/persian';
import persian_fa from 'react-date-object/locales/persian_fa';
import persian_en from 'react-date-object/locales/persian_en';
import gregorian from 'react-date-object/calendars/gregorian';
import gregorian_en from 'react-date-object/locales/gregorian_en';
import { calendarPickerConfig } from '@/lib/leave/calendarPicker';

describe('calendarPickerConfig', () => {
  it('defaults missing preferences to a Persian calendar and Farsi locale', () => {
    const config = calendarPickerConfig(undefined, 'fa');

    expect(config.isJalali).toBe(true);
    expect(config.calendar).toBe(persian);
    expect(config.calLocale).toBe(persian_fa);
    expect(config.calendarPosition).toBe('bottom-right');
  });

  it('keeps the Persian calendar when the interface language is English', () => {
    const config = calendarPickerConfig('jalali', 'en');

    expect(config.calendar).toBe(persian);
    expect(config.calLocale).toBe(persian_en);
    expect(config.calendarPosition).toBe('bottom-left');
  });

  it('uses Gregorian only when the saved preference explicitly requests it', () => {
    const config = calendarPickerConfig('gregorian', 'en');

    expect(config.isJalali).toBe(false);
    expect(config.calendar).toBe(gregorian);
    expect(config.calLocale).toBe(gregorian_en);
  });

  it('wires the employee hire-date picker to the saved preference with a Jalali default', () => {
    const pageSource = readFileSync(
      'app/[locale]/(app)/manage/employees/new/page.tsx',
      'utf8'
    );
    const formSource = readFileSync(
      'app/[locale]/(app)/manage/employees/new/NewEmployeeForm.tsx',
      'utf8'
    );

    expect(pageSource).toContain("calendarPref={callerProfile?.calendar_pref ?? 'jalali'}");
    expect(formSource).toContain('data-testid="hire-date-picker"');
    expect(formSource).toContain('dateObjectToGregorian(hireDate)');
  });
});
