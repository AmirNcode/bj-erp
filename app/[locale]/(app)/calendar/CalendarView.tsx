'use client';

/**
 * Month time-off view. Renders entries from the reason-less calendar view;
 * `reason` is never part of CalendarEntry, so it cannot leak here (FR-25).
 */

import { useMemo, useState } from 'react';
import { CalendarDays, List } from 'lucide-react';
import type { CalendarEntry, WorkSettings } from '@/lib/actions/leave';
import { buildCalendarMonth, formatCalendarDate } from '@/lib/leave/calendarMonth';
import { formatNumber, localizedLeaveTypeName } from '@/lib/i18n/format';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

type Labels = {
  empty: string;
  listView: string;
  monthView: string;
  offOn: string;
  noOffThisDay: string;
  returns: string;
  statusPending: string;
  statusApproved: string;
};

type Props = {
  entries: CalendarEntry[];
  locale: string;
  calendarPref: string; // 'jalali' | 'gregorian'
  rangeStart: string;
  rangeEnd: string;
  monthLabel: string;
  workSettings: WorkSettings;
  labels: Labels;
};

const sevenColumnGridStyle = { gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' };

export function CalendarView({
  entries,
  locale,
  calendarPref,
  rangeStart,
  rangeEnd,
  monthLabel,
  workSettings,
  labels,
}: Props) {
  const [viewMode, setViewMode] = useState<'list' | 'month'>('list');
  const month = useMemo(
    () =>
      buildCalendarMonth({
        entries,
        rangeStart,
        rangeEnd,
        calendarPref,
        locale,
        workSettings,
      }),
    [calendarPref, entries, locale, rangeEnd, rangeStart, workSettings]
  );
  const firstBusyDay = month.days.find((day) => day.inMonth && day.count > 0)?.iso ?? rangeStart;
  const [selectedIso, setSelectedIso] = useState(firstBusyDay);
  const selectedDay = month.days.find((day) => day.iso === selectedIso) ?? month.days[0];

  const fmt = (iso: string) => formatCalendarDate(iso, calendarPref, locale);
  const typeName = (entry: CalendarEntry) =>
    localizedLeaveTypeName(
      { name_fa: entry.leave_type_name_fa, name_en: entry.leave_type_name_en },
      locale
    );
  const statusLabel = (entry: CalendarEntry) =>
    entry.status === 'approved' ? labels.statusApproved : labels.statusPending;

  const renderList = () =>
    entries.length === 0 ? (
      <p className="text-muted-foreground text-sm" data-testid="calendar-empty">
        {labels.empty}
      </p>
    ) : (
      <div className="space-y-2">
        {entries.map((entry) => {
          const color = entry.leave_type_color ?? '#64748b';
          const range =
            entry.start_date === entry.end_date
              ? fmt(entry.start_date)
              : `${fmt(entry.start_date)} — ${fmt(entry.end_date)}`;
          return (
            <Card
              key={entry.id}
              data-testid={`cal-entry-${entry.id}`}
              className="flex-row items-center gap-0 rounded-xl p-3"
              style={{ borderInlineStartWidth: 4, borderInlineStartColor: color }}
            >
              <CardContent className="flex items-center gap-3 p-0 w-full">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{entry.employee_name}</div>
                  <div className="text-xs text-muted-foreground">{range}</div>
                </div>
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                  {typeName(entry)}
                </span>
                <span
                  className={cn(
                    'text-xs shrink-0',
                    entry.status === 'approved' ? 'text-success' : 'text-warning'
                  )}
                >
                  {statusLabel(entry)}
                </span>
              </CardContent>
            </Card>
          );
        })}
      </div>
    );

  const renderMonth = () => (
    <div className="space-y-4">
      <div
        className="grid gap-1 text-center text-xs font-semibold text-muted-foreground"
        style={sevenColumnGridStyle}
      >
        {month.weekdayLabels.map((label) => (
          <div key={label} className="py-1">
            {label}
          </div>
        ))}
      </div>

      <div
        className="grid gap-1 sm:gap-2"
        style={sevenColumnGridStyle}
        data-testid="calendar-month-grid"
      >
        {month.days.map((day) => (
          <button
            key={day.iso}
            type="button"
            aria-pressed={selectedIso === day.iso}
            aria-label={day.ariaLabel}
            data-testid={`calendar-day-${day.iso}`}
            onClick={() => setSelectedIso(day.iso)}
            className={cn(
              'relative min-h-14 min-w-0 rounded-lg border p-1 text-start transition-colors sm:min-h-24 sm:p-2',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              day.inMonth
                ? 'border-border bg-card text-card-foreground hover:border-primary/50'
                : 'border-border/50 bg-muted/40 text-muted-foreground/60',
              day.count > 0 && day.inMonth && 'border-primary/40 bg-primary/10 shadow-sm',
              selectedIso === day.iso && 'ring-2 ring-primary ring-offset-2'
            )}
          >
            <span className="text-[11px] font-semibold sm:text-xs">{day.dayLabel}</span>
            {day.count > 0 && (
              <span
                data-testid={`calendar-day-count-${day.iso}`}
                className="absolute right-0.5 top-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 py-0.5 text-[9px] font-semibold text-primary-foreground sm:right-1 sm:top-1 sm:min-w-5 sm:px-1.5 sm:text-[10px]"
              >
                {formatNumber(day.count, locale)}
              </span>
            )}
            <span className="mt-2 flex min-w-0 flex-col gap-0.5 text-[9px] leading-tight sm:mt-4 sm:text-xs">
              {day.visibleNames.map((name) => (
                <span key={name} className="truncate">
                  {name}
                </span>
              ))}
              {day.hasMore && <span>...</span>}
            </span>
          </button>
        ))}
      </div>

      <Card className="gap-0 p-4" data-testid="calendar-day-detail">
        <CardContent className="p-0">
          <h2 className="text-sm font-semibold">
            {labels.offOn} {selectedDay ? fmt(selectedDay.iso) : monthLabel}
          </h2>

          {!selectedDay || selectedDay.entries.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">{labels.noOffThisDay}</p>
          ) : (
            <div className="mt-3 divide-y divide-border">
              {selectedDay.entries.map((entry) => {
                const color = entry.leave_type_color ?? '#64748b';
                const range =
                  entry.start_date === entry.end_date
                    ? fmt(entry.start_date)
                    : `${fmt(entry.start_date)} — ${fmt(entry.end_date)}`;

                return (
                  <div key={entry.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                    <span
                      className="mt-1 h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{entry.employee_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {typeName(entry)} · {range}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {labels.returns} {fmt(entry.returnDate)}
                      </div>
                    </div>
                    <span
                      className={cn(
                        'text-xs',
                        entry.status === 'approved' ? 'text-success' : 'text-warning'
                      )}
                    >
                      {statusLabel(entry)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );

  return (
    <div data-testid="calendar-view">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm font-medium text-muted-foreground">{monthLabel}</div>
        <div
          className="inline-flex w-fit rounded-lg border bg-card p-1 shadow-xs"
          role="group"
          aria-label={monthLabel}
        >
          <Button
            type="button"
            size="sm"
            variant={viewMode === 'list' ? 'default' : 'ghost'}
            data-testid="calendar-list-toggle"
            onClick={() => setViewMode('list')}
          >
            <List aria-hidden="true" />
            {labels.listView}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={viewMode === 'month' ? 'default' : 'ghost'}
            data-testid="calendar-month-toggle"
            onClick={() => setViewMode('month')}
          >
            <CalendarDays aria-hidden="true" />
            {labels.monthView}
          </Button>
        </div>
      </div>

      {viewMode === 'list' ? renderList() : renderMonth()}
    </div>
  );
}
