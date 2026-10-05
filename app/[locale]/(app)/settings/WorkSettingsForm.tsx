'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import DatePicker from 'react-multi-date-picker';
import { updateWorkSettings } from '@/lib/actions/settings';
import { WEEKDAYS } from '@/lib/leave/weekend';
import { dateObjectToGregorian, gregorianToPersianDateObject, type PickerDate } from '@/lib/leave/dateConvert';
import { calendarPickerConfig } from '@/lib/leave/calendarPicker';
import { Plus, X } from 'lucide-react';
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
  /** FR-41 frequency rows. */
  frequencyWeekly: string;
  frequencyBiweekly: string;
  anchorLabel: string;
  anchorHint: string;
  /** Day dropdown's empty option. */
  dayNone: string;
  addDay: string;
  removeDay: string;
};

/** One dropdown in a frequency row: an ISO weekday, or null for "none". */
type Slot = number | null;

// Week order (Sat..Fri), so a reload shows days the way the week reads.
const weekOrder = (days: number[]) =>
  WEEKDAYS.map((d) => d.iso).filter((iso) => days.includes(iso));
const toSlots = (days: number[]): Slot[] => (days.length ? weekOrder(days) : [null]);
const fromSlots = (slots: Slot[]) => slots.filter((d): d is number => d !== null);

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
  const [weeklySlots, setWeeklySlots] = useState<Slot[]>(() => toSlots(initial));
  const [biweeklySlots, setBiweeklySlots] = useState<Slot[]>(() => toSlots(initialBiweekly));
  const selected = fromSlots(weeklySlots);
  const biweekly = fromSlots(biweeklySlots);
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

  // A day can be in only one slot across BOTH rows: weekly and every other
  // week at once is refused by the server and a CHECK constraint, so the other
  // slots' days are disabled in each dropdown rather than rejected on save.
  const used = new Set([...selected, ...biweekly]);
  const keyOf = (iso: number) => WEEKDAYS.find((d) => d.iso === iso)?.key ?? '';
  const isoOf = (key: string): Slot => WEEKDAYS.find((d) => d.key === key)?.iso ?? null;

  // Dropdowns stack vertically, one per line; "Add day" sits beside the first
  // so a new dropdown appears directly under the last one.
  const renderSlots = (
    kind: 'weekly' | 'biweekly',
    slots: Slot[],
    setSlots: (fn: (prev: Slot[]) => Slot[]) => void
  ) => (
    <div className="flex flex-col gap-2">
      {slots.map((slot, i) => (
        <div key={i} className="flex flex-wrap items-center gap-1">
          {/* Native <select> — must stay native for Playwright selectOption. */}
          <select
            value={slot === null ? 'none' : keyOf(slot)}
            disabled={isPending}
            data-testid={`weekend-${kind}-${i}`}
            aria-label={kind === 'weekly' ? labels.frequencyWeekly : labels.frequencyBiweekly}
            onChange={(e) => {
              const next = isoOf(e.target.value);
              setSlots((prev) => prev.map((v, j) => (j === i ? next : v)));
            }}
            className={cn(nativeSelectClass, 'h-9 w-40 rounded-[10px] bg-card text-[13px]')}
          >
            <option value="none">{labels.dayNone}</option>
            {WEEKDAYS.map((d) => (
              <option key={d.key} value={d.key} disabled={d.iso !== slot && used.has(d.iso)}>
                {labels.days[d.key]}
              </option>
            ))}
          </select>
          {slots.length > 1 && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={isPending}
              aria-label={labels.removeDay}
              data-testid={`weekend-${kind}-remove-${i}`}
              onClick={() => setSlots((prev) => prev.filter((_, j) => j !== i))}
              className="text-muted-foreground hover:text-destructive"
            >
              <X aria-hidden="true" />
            </Button>
          )}
          {i === 0 && slots.length < WEEKDAYS.length && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isPending}
              data-testid={`weekend-${kind}-add`}
              onClick={() => setSlots((prev) => [...prev, null])}
              className="text-primary hover:text-primary"
            >
              <Plus aria-hidden="true" />
              {labels.addDay}
            </Button>
          )}
        </div>
      ))}
    </div>
  );

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

      {/* Two fixed rows: a label column, then the row's controls stacked. */}
      <div className="flex flex-col gap-2.5 px-6 py-3.5">
        <div
          className="grid items-start gap-x-3 gap-y-2 rounded-[10px] border p-3 sm:grid-cols-[11rem_1fr]"
          data-testid="weekend-weekly-row"
        >
          <span className="whitespace-nowrap text-[13.5px] font-semibold sm:leading-9">
            {labels.frequencyWeekly}
          </span>
          {renderSlots('weekly', weeklySlots, setWeeklySlots)}
        </div>

        <div
          className="grid items-start gap-x-3 gap-y-2 rounded-[10px] border p-3 sm:grid-cols-[11rem_1fr]"
          data-testid="weekend-biweekly-row"
        >
          <span className="whitespace-nowrap text-[13.5px] font-semibold sm:leading-9">
            {labels.frequencyBiweekly}
          </span>
          <div className="flex flex-col gap-2">
            {renderSlots('biweekly', biweeklySlots, setBiweeklySlots)}
            {/* Only meaningful once a day is fortnightly: without a reference date
                the parity — WHICH Thursdays are off — is undefined, and the server
                refuses the save rather than guessing one. */}
            {biweekly.length > 0 && (
              <div className="mt-1 flex flex-col gap-1 border-t border-muted pt-3">
                <label className="text-[13px] font-medium">{labels.anchorLabel}</label>
                {/* rmdp-container class is intentional — e2e locates input via it. */}
                <div data-testid="biweekly-anchor" className="w-40">
                  <DatePicker
                    value={anchor}
                    onChange={setAnchor}
                    calendar={calendarPickerConfig(locale).calendar}
                    locale={calendarPickerConfig(locale).calLocale}
                    containerClassName="w-full"
                    inputClass="h-9 w-full rounded-[10px] border border-input bg-card px-3 text-sm"
                  />
                </div>
                <p className="text-xs text-muted-foreground">{labels.anchorHint}</p>
              </div>
            )}
          </div>
        </div>
      </div>

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
