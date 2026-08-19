'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import DatePicker from 'react-multi-date-picker';
import { dateObjectToGregorian } from '@/lib/leave/dateConvert';
import { calendarPickerConfig } from '@/lib/leave/calendarPicker';
import { formatCalendarDate } from '@/lib/leave/calendarMonth';
import { upsertHoliday, deleteHoliday, getCompanyHolidays, type Holiday } from '@/lib/actions/settings';
import { HolidayImportDialog, type HolidayImportLabels } from './HolidayImportDialog';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

type Labels = {
  holidaysTitle: string;
  addHoliday: string;
  dateLabel: string;
  nameFaLabel: string;
  nameEnLabel: string;
  recurringLabel: string;
  recurringHint: string;
  delete: string;
  noHolidays: string;
  errorLabel: string;
  /** FR-40 bulk upload. */
  holidayImport: HolidayImportLabels;
};

// react-multi-date-picker passes a DateObject; we only ever read it via dateObjectToGregorian.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DateObjectLike = any;

export function HolidayEditor({
  initial,
  locale,
  labels,
}: {
  initial: Holiday[];
  locale: string;
  labels: Labels;
}) {
  const tc = useTranslations('common');
  const { calendar, calLocale } = calendarPickerConfig(locale);
  const [holidays, setHolidays] = useState<Holiday[]>(initial);
  const [picked, setPicked] = useState<DateObjectLike | null>(null);
  const [nameFa, setNameFa] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [recurring, setRecurring] = useState(false);
  const [errMsg, setErrMsg] = useState('');
  const [isPending, startTransition] = useTransition();

  const show = (d: string) => formatCalendarDate(d, locale);

  // Re-read so rows carry their real DB ids (a subsequent delete needs them).
  // Shared by add, delete and the bulk import.
  const refresh = async () => {
    const refreshed = await getCompanyHolidays();
    if (refreshed.ok) setHolidays(refreshed.holidays);
  };

  const onAdd = () => {
    setErrMsg('');
    if (!picked || !nameFa) {
      setErrMsg(labels.errorLabel);
      return;
    }
    const date = dateObjectToGregorian(picked);
    startTransition(async () => {
      const res = await upsertHoliday({ date, nameFa, nameEn, isRecurring: recurring });
      if (!res.ok) {
        setErrMsg(res.error);
        toast.error(`${labels.errorLabel}: ${res.error}`);
        return;
      }
      await refresh();
      setPicked(null);
      setNameFa('');
      setNameEn('');
      setRecurring(false);
      toast.success(labels.addHoliday);
    });
  };

  const onDelete = (id: string) => {
    setErrMsg('');
    startTransition(async () => {
      const res = await deleteHoliday(id);
      if (!res.ok) {
        setErrMsg(res.error);
        toast.error(`${labels.errorLabel}: ${res.error}`);
        return;
      }
      await refresh();
      toast.success(labels.delete);
    });
  };

  return (
    <section className="space-y-4" data-testid="holiday-editor">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{labels.holidaysTitle}</p>
        <HolidayImportDialog
          existingDates={holidays.map((h) => h.holiday_date)}
          locale={locale}
          labels={labels.holidayImport}
          errorLabel={labels.errorLabel}
          onImported={refresh}
        />
      </div>
      {errMsg && (
        <p role="alert" data-testid="holiday-error" className="text-sm text-destructive">
          {labels.errorLabel}: {errMsg}
        </p>
      )}

      <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">{labels.dateLabel}</label>
          {/* rmdp-container class is intentional — e2e locates input via .rmdp-container input */}
          <DatePicker
            value={picked}
            onChange={setPicked}
            calendar={calendar}
            locale={calLocale}
            inputClass="border border-input rounded-lg px-3 py-2 text-sm w-full bg-background"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="hol-name-fa" className="text-sm font-medium">
            {labels.nameFaLabel}
          </label>
          <input
            id="hol-name-fa"
            data-testid="holiday-name-fa"
            value={nameFa}
            onChange={(e) => setNameFa(e.target.value)}
            className="border border-input rounded-lg px-3 py-2 text-sm bg-background"
            disabled={isPending}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="hol-name-en" className="text-sm font-medium">
            {labels.nameEnLabel}
          </label>
          <input
            id="hol-name-en"
            value={nameEn}
            onChange={(e) => setNameEn(e.target.value)}
            className="border border-input rounded-lg px-3 py-2 text-sm bg-background"
            disabled={isPending}
          />
        </div>
        <div className="space-y-1">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={recurring}
              onChange={(e) => setRecurring(e.target.checked)}
              disabled={isPending}
              className="rounded border-input"
            />
            {labels.recurringLabel}
          </label>
          <p className="text-xs text-muted-foreground">{labels.recurringHint}</p>
        </div>
        <Button
          type="button"
          data-testid="holiday-add"
          onClick={onAdd}
          disabled={isPending}
        >
          {labels.addHoliday}
        </Button>
      </div>

      {holidays.length === 0 ? (
        <p className="text-sm text-muted-foreground">{labels.noHolidays}</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border" data-testid="holiday-list">
          {holidays.map((h) => (
            <li key={h.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <span>
                <span className="font-mono">{show(h.holiday_date)}</span> · {h.name_fa}
              </span>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="destructive"
                    size="xs"
                    disabled={isPending}
                  >
                    {labels.delete}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent size="sm">
                  <AlertDialogHeader>
                    <AlertDialogTitle>{labels.delete}</AlertDialogTitle>
                    <AlertDialogDescription>{h.name_fa}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{tc('dismiss')}</AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      onClick={() => onDelete(h.id)}
                      data-testid={`holiday-delete-confirm-${h.id}`}
                    >
                      {labels.delete}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
