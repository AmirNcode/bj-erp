'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import DatePicker from 'react-multi-date-picker';
import persian from 'react-date-object/calendars/persian';
import persian_fa from 'react-date-object/locales/persian_fa';
import gregorian from 'react-date-object/calendars/gregorian';
import gregorian_en from 'react-date-object/locales/gregorian_en';
import { dateObjectToGregorian, gregorianToJalali } from '@/lib/leave/dateConvert';
import { upsertHoliday, deleteHoliday, getCompanyHolidays, type Holiday } from '@/lib/actions/settings';
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
  delete: string;
  noHolidays: string;
  errorLabel: string;
};

// react-multi-date-picker passes a DateObject; we only ever read it via dateObjectToGregorian.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DateObjectLike = any;

export function HolidayEditor({
  initial,
  calendarPref,
  labels,
}: {
  initial: Holiday[];
  calendarPref: string;
  labels: Labels;
}) {
  const isJalali = calendarPref === 'jalali';
  const [holidays, setHolidays] = useState<Holiday[]>(initial);
  const [picked, setPicked] = useState<DateObjectLike | null>(null);
  const [nameFa, setNameFa] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [recurring, setRecurring] = useState(false);
  const [errMsg, setErrMsg] = useState('');
  const [isPending, startTransition] = useTransition();

  const show = (d: string) => (isJalali ? gregorianToJalali(d) : d);

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
      // Re-read so rows carry their real DB ids (needed for a subsequent delete).
      const refreshed = await getCompanyHolidays();
      if (refreshed.ok) setHolidays(refreshed.holidays);
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
      const refreshed = await getCompanyHolidays();
      if (refreshed.ok) setHolidays(refreshed.holidays);
      toast.success(labels.delete);
    });
  };

  return (
    <section className="space-y-4" data-testid="holiday-editor">
      <p className="text-sm font-medium">{labels.holidaysTitle}</p>
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
            calendar={isJalali ? persian : gregorian}
            locale={isJalali ? persian_fa : gregorian_en}
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
                    <AlertDialogCancel />
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
