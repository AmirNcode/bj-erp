import { describe, expect, it } from 'vitest';
import {
  buildCalendarMonth,
  currentCalendarMonthRange,
  formatCalendarDate,
  nextWorkingDateAfter,
} from '@/lib/leave/calendarMonth';
import type { CalendarEntry } from '@/lib/actions/leave';

const baseEntry = {
  employee_id: 'employee',
  leave_type_name_fa: 'مرخصی استحقاقی',
  leave_type_name_en: 'Annual Leave',
  leave_type_color: '#2563eb',
  day_part: 'full',
  status: 'approved',
} satisfies Omit<CalendarEntry, 'id' | 'employee_name' | 'start_date' | 'end_date'>;

function entry(
  id: string,
  employeeName: string,
  startDate: string,
  endDate: string
): CalendarEntry {
  return {
    ...baseEntry,
    id,
    employee_id: id,
    employee_name: employeeName,
    start_date: startDate,
    end_date: endDate,
  };
}

describe('currentCalendarMonthRange', () => {
  it('uses the active Jalali month when calendar preference is Jalali', () => {
    expect(currentCalendarMonthRange('jalali', new Date(Date.UTC(2026, 5, 30)))).toEqual({
      rangeStart: '2026-06-22',
      rangeEnd: '2026-07-22',
      monthLabel: 'Tir 1405',
    });
  });
});

describe('buildCalendarMonth', () => {
  it('groups multi-day leave entries into each covered day and caps visible names', () => {
    const month = buildCalendarMonth({
      entries: [
        entry('1', 'Ava', '2026-06-29', '2026-06-30'),
        entry('2', 'Ben', '2026-06-30', '2026-06-30'),
        entry('3', 'Cy', '2026-06-30', '2026-07-01'),
      ],
      rangeStart: '2026-06-01',
      rangeEnd: '2026-06-30',
      calendarPref: 'gregorian',
      locale: 'en',
      workSettings: { weekendDays: [5], holidays: [] },
    });

    const june29 = month.days.find((day) => day.iso === '2026-06-29');
    const june30 = month.days.find((day) => day.iso === '2026-06-30');

    expect(june29?.count).toBe(1);
    expect(june30?.count).toBe(3);
    expect(june30?.visibleNames).toEqual(['Ava', 'Ben']);
    expect(june30?.hasMore).toBe(true);
    expect(june30?.entries.map((e) => e.returnDate)).toEqual([
      '2026-07-01',
      '2026-07-01',
      '2026-07-02',
    ]);
  });

  it('shows the same multi-day employee on every day they are off', () => {
    const month = buildCalendarMonth({
      entries: [entry('1', 'Ava', '2026-07-10', '2026-07-13')],
      rangeStart: '2026-07-01',
      rangeEnd: '2026-07-31',
      calendarPref: 'gregorian',
      locale: 'en',
      workSettings: { weekendDays: [5], holidays: [] },
    });

    for (const iso of ['2026-07-10', '2026-07-11', '2026-07-12', '2026-07-13']) {
      expect(month.days.find((day) => day.iso === iso)?.visibleNames).toContain('Ava');
    }
  });
});

describe('nextWorkingDateAfter', () => {
  it('skips configured weekends and holidays', () => {
    expect(
      nextWorkingDateAfter('2026-06-25', {
        weekendDays: [5],
        holidays: ['2026-06-27'],
      })
    ).toBe('2026-06-28');
  });
});

describe('formatCalendarDate', () => {
  it('uses English digits when locale is English, even for Jalali dates', () => {
    expect(formatCalendarDate('2026-06-30', 'jalali', 'en')).toBe('1405/04/09');
  });

  it('uses Persian digits when locale is Persian', () => {
    expect(formatCalendarDate('2026-06-30', 'jalali', 'fa')).toBe('۱۴۰۵/۰۴/۰۹');
  });
});
