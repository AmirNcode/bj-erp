'use client';

import { useState, useTransition } from 'react';
import { updateWorkSettings } from '@/lib/actions/settings';
import { WEEKDAYS } from '@/lib/leave/weekend';

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
      if (res.ok) setOkMsg(labels.saved);
      else setErrMsg(res.error);
    });
  };

  return (
    <section className="space-y-3" data-testid="work-settings">
      <h2 className="text-lg font-semibold">{labels.weekendTitle}</h2>
      <p className="text-xs text-gray-500">{labels.weekendHint}</p>
      {okMsg && (
        <p role="status" data-testid="work-settings-saved" className="text-sm text-green-700">
          {okMsg}
        </p>
      )}
      {errMsg && (
        <p role="alert" data-testid="work-settings-error" className="text-sm text-red-700">
          {labels.errorLabel}: {errMsg}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {WEEKDAYS.map((d) => (
          <label
            key={d.iso}
            data-testid={`weekend-${d.key}`}
            className={`cursor-pointer select-none rounded-full border px-3 py-1.5 text-sm ${
              selected.includes(d.iso)
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-700 border-gray-300'
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
      <button
        type="button"
        data-testid="work-settings-save"
        onClick={onSave}
        disabled={isPending}
        className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
      >
        {labels.save}
      </button>
    </section>
  );
}
