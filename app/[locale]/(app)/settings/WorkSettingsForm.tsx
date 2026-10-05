'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import DatePicker from 'react-multi-date-picker';
import { updateWorkSettings } from '@/lib/actions/settings';
import { WEEKDAYS, frequencyOf, type WeekendFrequency } from '@/lib/leave/weekend';
import { dateObjectToGregorian, gregorianToPersianDateObject, type PickerDate } from '@/lib/leave/dateConvert';
import { calendarPickerConfig } from '@/lib/leave/calendarPicker';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { nativeSelectClass } from '@/lib/native-select';
import { formatCalendarDate } from '@/lib/leave/calendarMonth';
import { todayInAppTz } from '@/lib/appDate';
import { cn } from '@/lib/utils';

type Labels = {
  weekendTitle: string;
  weekendHint: string;
  hoursTitle: string;
  hoursHint: string;
  workStart: string;
  workEnd: string;
  hourlyCap: string;
  save: string;
  /** "Last saved: {date}" — substituted here. */
  lastSaved: string;
  saved: string;
  errorLabel: string;
  days: Record<string, string>;
  /** FR-41 frequency control. */
  frequencyWorking: string;
  frequencyWeekly: string;
  frequencyBiweekly: string;
  anchorLabel: string;
  anchorHint: string;
};

export function WorkSettingsForm({
  initial,
  initialBiweekly,
  initialAnchor,
  initialUpdatedAt,
  initialWorkStart,
  initialWorkEnd,
  initialHourlyCapMinutes,
  locale,
  labels,
}: {
  initial: number[];
  initialBiweekly: number[];
  initialAnchor: string | null;
  /** work_settings.updated_at, for the footer's "last saved". */
  initialUpdatedAt: string | null;
  initialWorkStart: string;
  initialWorkEnd: string;
  initialHourlyCapMinutes: number;
  locale: string;
  labels: Labels;
}) {
  const [selected, setSelected] = useState<number[]>(initial);
  const [biweekly, setBiweekly] = useState<number[]>(initialBiweekly);
  // react-multi-date-picker wants a DateObject; the DB stores Gregorian ISO.
  const [anchor, setAnchor] = useState<PickerDate | null>(
    initialAnchor ? gregorianToPersianDateObject(initialAnchor, locale) : null
  );
  // Times are 'HH:MM' for <input type="time">; Postgres hands back 'HH:MM:SS'.
  const [workStart, setWorkStart] = useState(initialWorkStart.slice(0, 5));
  const [workEnd, setWorkEnd] = useState(initialWorkEnd.slice(0, 5));
  // The cap is stored in minutes and edited in hours — hours is what the client
  // says ("up to 4 hours"), minutes is what the ledger needs.
  const [capHours, setCapHours] = useState(initialHourlyCapMinutes / 60);
  const [savedAt, setSavedAt] = useState<string | null>(initialUpdatedAt);
  const [okMsg, setOkMsg] = useState('');
  const [errMsg, setErrMsg] = useState('');
  const [isPending, startTransition] = useTransition();

  // Three states, so this cannot be a checkbox. A second parallel checkbox list
  // would also let an admin mark one day both weekly and every-other-week, which
  // the server and a CHECK constraint both refuse — better to make it unsayable.
  const setFrequency = (iso: number, next: WeekendFrequency) => {
    setSelected((prev) =>
      next === 'weekly' ? [...prev.filter((d) => d !== iso), iso] : prev.filter((d) => d !== iso)
    );
    setBiweekly((prev) =>
      next === 'biweekly' ? [...prev.filter((d) => d !== iso), iso] : prev.filter((d) => d !== iso)
    );
  };

  const onSave = () => {
    setOkMsg('');
    setErrMsg('');
    startTransition(async () => {
      const res = await updateWorkSettings({
        weekendDays: selected,
        biweeklyWeekendDays: biweekly,
        biweeklyAnchor: anchor ? dateObjectToGregorian(anchor) : null,
        workStart,
        workEnd,
        maxHourlyMinutesPerDay: Math.round(capHours * 60),
      });
      if (res.ok) {
        setSavedAt(new Date().toISOString());
        setOkMsg(labels.saved);
        toast.success(labels.saved);
      } else {
        setErrMsg(res.error);
        toast.error(`${labels.errorLabel}: ${res.error}`);
      }
    });
  };

  const inputClass =
    'h-9 w-full rounded-[10px] border border-input bg-card px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:w-[180px]';

  // Save covers this card only (weekly days off + working hours).
  return (
    <Card className="gap-0 py-0" data-testid="work-settings">
      <div className="px-6 pt-5 pb-1">
        <h2 className="text-base font-semibold">{labels.weekendTitle}</h2>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{labels.weekendHint}</p>
      </div>

      <div className="grid grid-cols-1 gap-2 px-6 py-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {WEEKDAYS.map((d) => {
          const freq = frequencyOf(d.iso, selected, biweekly);
          return (
            <label
              key={d.iso}
              data-testid={`weekend-${d.key}`}
              className={cn(
                'flex items-center justify-between gap-2 rounded-[10px] border p-2.5',
                freq === 'working' ? 'bg-card' : 'border-primary/40 bg-primary/5'
              )}
            >
              <span className="whitespace-nowrap text-[13.5px] font-semibold">{labels.days[d.key]}</span>
              {/* Native <select> — must stay native for Playwright selectOption. */}
              <select
                value={freq}
                disabled={isPending}
                data-testid={`weekend-freq-${d.key}`}
                aria-label={labels.days[d.key]}
                onChange={(e) => setFrequency(d.iso, e.target.value as WeekendFrequency)}
                className={cn(nativeSelectClass, 'h-8 w-auto min-w-[130px] rounded-[10px] bg-card py-0 text-[12.5px]')}
              >
                <option value="working">{labels.frequencyWorking}</option>
                <option value="weekly">{labels.frequencyWeekly}</option>
                <option value="biweekly">{labels.frequencyBiweekly}</option>
              </select>
            </label>
          );
        })}
      </div>

      {/* Only meaningful once a day is fortnightly: without a reference date the
          parity — WHICH Thursdays are off — is undefined, and the server refuses
          the save rather than guessing one. */}
      {biweekly.length > 0 && (
        <div className="mx-6 mb-3.5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[10px] border border-primary/40 bg-primary/5 px-3 py-2.5">
          <label className="whitespace-nowrap text-sm font-medium">{labels.anchorLabel}</label>
          {/* rmdp-container class is intentional — e2e locates input via it. */}
          <div data-testid="biweekly-anchor" className="w-[200px]">
            <DatePicker
              value={anchor}
              onChange={setAnchor}
              calendar={calendarPickerConfig(locale).calendar}
              locale={calendarPickerConfig(locale).calLocale}
              inputClass="h-9 w-full rounded-[10px] border border-input bg-card px-3 text-sm"
            />
          </div>
          <p className="text-xs text-muted-foreground">{labels.anchorHint}</p>
        </div>
      )}

      {/* Work-hours window + hourly cap — the bounds hourly requests validate against. */}
      <div className="space-y-3 border-t px-6 py-4">
        <div>
          <h3 className="text-sm font-semibold">{labels.hoursTitle}</h3>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{labels.hoursHint}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <label className="space-y-1 text-sm">
            <span className="block text-xs text-muted-foreground">{labels.workStart}</span>
            <input
              type="time"
              value={workStart}
              onChange={(e) => setWorkStart(e.target.value)}
              disabled={isPending}
              dir="ltr"
              data-testid="work-start"
              className={inputClass}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="block text-xs text-muted-foreground">{labels.workEnd}</span>
            <input
              type="time"
              value={workEnd}
              onChange={(e) => setWorkEnd(e.target.value)}
              disabled={isPending}
              dir="ltr"
              data-testid="work-end"
              className={inputClass}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="block text-xs text-muted-foreground">{labels.hourlyCap}</span>
            <input
              type="number"
              min={0.5}
              max={24}
              step="0.5"
              value={capHours}
              onChange={(e) => setCapHours(Number(e.target.value))}
              disabled={isPending}
              data-testid="hourly-cap-hours"
              className={inputClass}
            />
          </label>
        </div>
      </div>

      {errMsg && (
        <p role="alert" data-testid="work-settings-error" className="px-6 pb-3 text-sm text-destructive">
          {labels.errorLabel}: {errMsg}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3 rounded-b-xl border-t bg-muted/30 px-6 py-3.5">
        {okMsg && (
          <p role="status" data-testid="work-settings-saved" className="text-[12.5px] text-success">
            {okMsg}
          </p>
        )}
        {savedAt && (
          <p className="text-[12.5px] text-muted-foreground">
            {labels.lastSaved.replace('{date}', formatCalendarDate(todayInAppTz(new Date(savedAt)), locale))}
          </p>
        )}
        <Button
          type="button"
          data-testid="work-settings-save"
          onClick={onSave}
          disabled={isPending}
          className="rounded-[10px]"
        >
          {labels.save}
        </Button>
      </div>
    </Card>
  );
}
