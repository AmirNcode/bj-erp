'use client';

/**
 * Agenda-style month view of time-off. Mobile-first (full names, comfortable
 * touch targets) — a dense day grid is deferred. Renders entries from the
 * reason-less calendar view; `reason` is never part of CalendarEntry, so it
 * cannot leak here (FR-25).
 */

import DateObject from 'react-date-object';
import persian from 'react-date-object/calendars/persian';
import persian_fa from 'react-date-object/locales/persian_fa';
import { gregorianToJalali } from '@/lib/leave/dateConvert';
import type { CalendarEntry } from '@/lib/actions/leave';
import { Card, CardContent } from '@/components/ui/card';

type Labels = {
  empty: string;
  statusPending: string;
  statusApproved: string;
};

type Props = {
  entries: CalendarEntry[];
  locale: string;
  calendarPref: string; // 'jalali' | 'gregorian'
  labels: Labels;
};

export function CalendarView({ entries, locale, calendarPref, labels }: Props) {
  const isJalali = calendarPref === 'jalali';
  const fmt = (iso: string) => (isJalali ? gregorianToJalali(iso) : iso);
  const monthLabel = isJalali
    ? new DateObject({ calendar: persian, locale: persian_fa }).format('MMMM YYYY')
    : new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div data-testid="calendar-view">
      <div className="text-sm font-medium text-muted-foreground mb-4">{monthLabel}</div>

      {entries.length === 0 ? (
        <p className="text-muted-foreground text-sm" data-testid="calendar-empty">
          {labels.empty}
        </p>
      ) : (
        <div className="space-y-2">
          {entries.map((e) => {
            const typeName =
              locale === 'fa' ? e.leave_type_name_fa : e.leave_type_name_en ?? e.leave_type_name_fa;
            const color = e.leave_type_color ?? '#64748b';
            const range =
              e.start_date === e.end_date ? fmt(e.start_date) : `${fmt(e.start_date)} — ${fmt(e.end_date)}`;
            return (
              <Card
                key={e.id}
                data-testid={`cal-entry-${e.id}`}
                className="flex-row items-center gap-3 rounded-xl p-3 py-3 gap-0"
                style={{ borderInlineStartWidth: 4, borderInlineStartColor: color }}
              >
                <CardContent className="flex items-center gap-3 p-0 w-full">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{e.employee_name}</div>
                    <div className="text-xs text-muted-foreground">{range}</div>
                  </div>
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                    {typeName}
                  </span>
                  <span
                    className={`text-xs shrink-0 ${
                      e.status === 'approved' ? 'text-green-700' : 'text-yellow-700'
                    }`}
                  >
                    {e.status === 'approved' ? labels.statusApproved : labels.statusPending}
                  </span>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
