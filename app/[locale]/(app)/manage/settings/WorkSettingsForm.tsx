'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { updateWorkSettings } from '@/lib/actions/settings';
import { WEEKDAYS } from '@/lib/leave/weekend';
import { Button } from '@/components/ui/button';

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
};

export function WorkSettingsForm({
  initial,
  initialWorkStart,
  initialWorkEnd,
  initialHourlyCapMinutes,
  labels,
}: {
  initial: number[];
  initialWorkStart: string;
  initialWorkEnd: string;
  initialHourlyCapMinutes: number;
  labels: Labels;
}) {
  const [selected, setSelected] = useState<number[]>(initial);
  // Times are 'HH:MM' for <input type="time">; Postgres hands back 'HH:MM:SS'.
  const [workStart, setWorkStart] = useState(initialWorkStart.slice(0, 5));
  const [workEnd, setWorkEnd] = useState(initialWorkEnd.slice(0, 5));
  // The cap is stored in minutes and edited in hours — hours is what the client
  // says ("up to 4 hours"), minutes is what the ledger needs.
  const [capHours, setCapHours] = useState(initialHourlyCapMinutes / 60);
  const [okMsg, setOkMsg] = useState('');
  const [errMsg, setErrMsg] = useState('');
  const [isPending, startTransition] = useTransition();

  const toggle = (iso: number) =>
    setSelected((prev) => (prev.includes(iso) ? prev.filter((d) => d !== iso) : [...prev, iso]));

  const onSave = () => {
    setOkMsg('');
    setErrMsg('');
    startTransition(async () => {
      const res = await updateWorkSettings({
        weekendDays: selected,
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
      <div className="flex flex-wrap gap-2">
        {WEEKDAYS.map((d) => (
          <label
            key={d.iso}
            data-testid={`weekend-${d.key}`}
            className={`cursor-pointer select-none rounded-full border px-3 py-1.5 text-sm transition-colors ${
              selected.includes(d.iso)
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background text-foreground border-input hover:bg-accent hover:text-accent-foreground'
            }`}
          >
            <input
              type="checkbox"
              className="sr-only"
              checked={selected.includes(d.iso)}
              onChange={() => toggle(d.iso)}
              disabled={isPending}
            />
            {labels.days[d.key]}
          </label>
        ))}
      </div>
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
