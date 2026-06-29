'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { updateWorkSettings } from '@/lib/actions/settings';
import { WEEKDAYS } from '@/lib/leave/weekend';
import { Button } from '@/components/ui/button';

type Labels = {
  weekendTitle: string;
  weekendHint: string;
  save: string;
  saved: string;
  errorLabel: string;
  days: Record<string, string>;
};

export function WorkSettingsForm({ initial, labels }: { initial: number[]; labels: Labels }) {
  const [selected, setSelected] = useState<number[]>(initial);
  const [okMsg, setOkMsg] = useState('');
  const [errMsg, setErrMsg] = useState('');
  const [isPending, startTransition] = useTransition();

  const toggle = (iso: number) =>
    setSelected((prev) => (prev.includes(iso) ? prev.filter((d) => d !== iso) : [...prev, iso]));

  const onSave = () => {
    setOkMsg('');
    setErrMsg('');
    startTransition(async () => {
      const res = await updateWorkSettings(selected);
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
