'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import DatePicker from 'react-multi-date-picker';
import { dateObjectToGregorian, type PickerDate } from '@/lib/leave/dateConvert';
import { calendarPickerConfig } from '@/lib/leave/calendarPicker';
import { formatCalendarDate } from '@/lib/leave/calendarMonth';
import { upsertHoliday, deleteHoliday, getCompanyHolidays, type Holiday } from '@/lib/actions/settings';
import { HolidayImportDialog, type HolidayImportLabels } from './HolidayImportDialog';
import { CalendarDays, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { formatNumber } from '@/lib/i18n/format';
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
  /** "{count} holidays recorded" — substituted here. */
  holidaysCount: string;
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
  const [picked, setPicked] = useState<PickerDate | null>(null);
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

  const fieldClass =
    'h-9 w-full rounded-[10px] border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';

  return (
    <Card className="gap-0 py-0" data-testid="holiday-editor">
      <div className="flex flex-wrap items-start justify-between gap-3 px-6 pt-5 pb-4">
        <div>
          <h2 className="text-base font-semibold">{labels.holidaysTitle}</h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {labels.holidaysCount.replace('{count}', formatNumber(holidays.length, locale))}
          </p>
        </div>
        <HolidayImportDialog
          existingDates={holidays.map((h) => h.holiday_date)}
          locale={locale}
          labels={labels.holidayImport}
          errorLabel={labels.errorLabel}
          onImported={refresh}
        />
      </div>
      {errMsg && (
        <p role="alert" data-testid="holiday-error" className="px-6 pb-3 text-sm text-destructive">
          {labels.errorLabel}: {errMsg}
        </p>
      )}

      {/* Add form: one row on desktop. */}
      <div className="mx-6 space-y-2.5 rounded-xl border border-muted bg-muted/35 p-3.5">
        <div className="grid grid-cols-1 items-end gap-2.5 md:grid-cols-[180px_1fr_1fr_auto]">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">{labels.dateLabel}</label>
            <div className="relative">
              <CalendarDays
                aria-hidden="true"
                className="pointer-events-none absolute start-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground"
              />
              {/* rmdp-container class is intentional — e2e locates input via .rmdp-container input */}
              <DatePicker
                value={picked}
                onChange={setPicked}
                calendar={calendar}
                locale={calLocale}
                containerClassName="w-full"
                inputClass={`${fieldClass} ps-9`}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="hol-name-fa" className="text-xs font-medium text-muted-foreground">
              {labels.nameFaLabel}
            </label>
            <input
              id="hol-name-fa"
              data-testid="holiday-name-fa"
              value={nameFa}
              onChange={(e) => setNameFa(e.target.value)}
              className={fieldClass}
              disabled={isPending}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="hol-name-en" className="text-xs font-medium text-muted-foreground">
              {labels.nameEnLabel}
            </label>
            <input
              id="hol-name-en"
              dir="ltr"
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
              className={fieldClass}
              disabled={isPending}
            />
          </div>
          <Button
            type="button"
            data-testid="holiday-add"
            onClick={onAdd}
            disabled={isPending}
            className="rounded-[10px]"
          >
            <Plus aria-hidden="true" />
            {labels.addHoliday}
          </Button>
        </div>
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={recurring}
            onChange={(e) => setRecurring(e.target.checked)}
            disabled={isPending}
            className="mt-1 rounded border-input"
          />
          <span>
            {labels.recurringLabel}
            <span className="block text-xs text-muted-foreground">{labels.recurringHint}</span>
          </span>
        </label>
      </div>

      <div className="px-6 pt-3 pb-5">
        {holidays.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">{labels.noHolidays}</p>
        ) : (
          <ul data-testid="holiday-list">
            {holidays.map((h) => (
              <li
                key={h.id}
                className="group grid grid-cols-[1fr_40px] items-center gap-x-3 border-b border-muted py-2.5 text-sm transition-colors last:border-b-0 hover:bg-red-50 sm:grid-cols-[160px_110px_1fr_40px]"
              >
                <span className="whitespace-nowrap font-medium">{show(h.holiday_date)}</span>
                <span className="hidden text-[13px] text-muted-foreground sm:block">
                  {formatCalendarDate(h.holiday_date, locale, 'dddd')}
                </span>
                <span className="col-start-1 row-start-2 sm:col-start-auto sm:row-start-auto">
                  {h.name_fa}
                </span>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${labels.delete}: ${h.name_fa}`}
                      disabled={isPending}
                      className="row-span-2 text-muted-foreground group-hover:text-destructive group-hover:ring-1 group-hover:ring-destructive/40 sm:row-span-1"
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent size="sm">
                    <AlertDialogHeader>
                      <AlertDialogTitle>{labels.delete}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {show(h.holiday_date)} ، {h.name_fa}
                      </AlertDialogDescription>
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
      </div>
    </Card>
  );
}
