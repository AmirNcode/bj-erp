'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import DatePicker from 'react-multi-date-picker';
import { updateWorkSettings } from '@/lib/actions/settings';
import { WEEKDAYS, frequencyOf, type WeekendFrequency } from '@/lib/leave/weekend';
import { dateObjectToGregorian, gregorianToPersianDateObject } from '@/lib/leave/dateConvert';
import { calendarPickerConfig } from '@/lib/leave/calendarPicker';
import { Button } from '@/components/ui/button';
import { nativeSelectClass } from '@/lib/native-select';

// react-multi-date-picker passes a DateObject; we only ever read it via
// dateObjectToGregorian. Same escape hatch HolidayEditor uses for this picker.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DateObjectLike = any;

type Labels = {
  weekendTitle: string;
  weekendHint: string;
  hoursTitle: string;
  hoursHint: string;
  workStart: string;
  workEnd: string;
  hourlyCap: string;
  save: string;
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
  initialWorkStart,
  initialWorkEnd,
  initialHourlyCapMinutes,
  locale,
  labels,
}: {
  initial: number[];
  initialBiweekly: number[];
  initialAnchor: string | null;
  initialWorkStart: string;
  initialWorkEnd: string;
  initialHourlyCapMinutes: number;
  locale: string;
  labels: Labels;
}) {
  const [selected, setSelected] = useState<number[]>(initial);
  const [biweekly, setBiweekly] = useState<number[]>(initialBiweekly);
  // react-multi-date-picker wants a DateObject; the DB stores Gregorian ISO.
  const [anchor, setAnchor] = useState<DateObjectLike | null>(
    initialAnchor ? gregorianToPersianDateObject(initialAnchor, locale) : null
  );
  // Times are 'HH:MM' for <input type="time">; Postgres hands back 'HH:MM:SS'.
  const [workStart, setWorkStart] = useState(initialWorkStart.slice(0, 5));
  const [workEnd, setWorkEnd] = useState(initialWorkEnd.slice(0, 5));
  // The cap is stored in minutes and edited in hours — hours is what the client
  // says ("up to 4 hours"), minutes is what the ledger needs.
  const [capHours, setCapHours] = useState(initialHourlyCapMinutes / 60);
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
        setOkMsg(labels.saved);
        toast.success(labels.saved);
      } else {
        setErrMsg(res.error);
        toast.error(`${labels.errorLabel}: ${res.error}`);
      }
    });
  };

  return (
    <section className="space-y-4" data-testid="work-settings">
      <div>
        <p className="text-sm font-medium">{labels.weekendTitle}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{labels.weekendHint}</p>
      </div>
      {okMsg && (
        <p role="status" data-testid="work-settings-saved" className="text-sm text-success">
          {okMsg}
        </p>
      )}
      {errMsg && (
        <p role="alert" data-testid="work-settings-error" className="text-sm text-destructive">
          {labels.errorLabel}: {errMsg}
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {WEEKDAYS.map((d) => {
          const freq = frequencyOf(d.iso, selected, biweekly);
          return (
            <label
              key={d.iso}
              data-testid={`weekend-${d.key}`}
              className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${
                freq === 'working' ? 'border-input bg-background' : 'border-primary/40 bg-primary/5'
              }`}
            >
              <span className="font-medium">{labels.days[d.key]}</span>
              {/* Native <select> — must stay native for Playwright selectOption. */}
              <select
                value={freq}
                disabled={isPending}
                data-testid={`weekend-freq-${d.key}`}
                aria-label={labels.days[d.key]}
                onChange={(e) => setFrequency(d.iso, e.target.value as WeekendFrequency)}
                className={`${nativeSelectClass} h-8 w-auto max-w-40 py-0 text-xs`}
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
        <div className="space-y-1.5 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2.5">
          <label className="text-sm font-medium">{labels.anchorLabel}</label>
          {/* rmdp-container class is intentional — e2e locates input via it. */}
          <div data-testid="biweekly-anchor">
            <DatePicker
              value={anchor}
              onChange={setAnchor}
              calendar={calendarPickerConfig(locale).calendar}
              locale={calendarPickerConfig(locale).calLocale}
              inputClass="border border-input rounded-lg px-3 py-2 text-sm w-full bg-background"
            />
          </div>
          <p className="text-xs text-muted-foreground">{labels.anchorHint}</p>
        </div>
      )}
      {/* Work-hours window + hourly cap — the bounds hourly requests validate against. */}
      <div className="space-y-3 border-t border-border pt-4">
        <div>
          <p className="text-sm font-medium">{labels.hoursTitle}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{labels.hoursHint}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1 text-sm">
            <span className="block text-xs text-muted-foreground">{labels.workStart}</span>
            <input
              type="time"
              value={workStart}
              onChange={(e) => setWorkStart(e.target.value)}
              disabled={isPending}
              dir="ltr"
              data-testid="work-start"
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </label>
        </div>
      </div>

      <Button
        type="button"
        data-testid="work-settings-save"
        onClick={onSave}
        disabled={isPending}
      >
        {labels.save}
      </Button>
    </section>
  );
}
