'use client';

/**
 * Profile › Preferences: per-person text size. A 5-stop slider with a live
 * sample (scoped by `.font-scale-scope`, so only the sample changes until Save),
 * then Save → updateMyPrefs → router.refresh() re-renders the app at the new size.
 * Read-only while an admin is viewing as someone else.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { updateMyPrefs } from '@/lib/actions/profile';
import { FONT_STEPS, fontScale, fontStepLabel, isFontStep, type FontStep } from '@/lib/prefs/fontScale';
import { useViewAs } from '@/app/[locale]/(app)/_components/ViewAsContext';
import { Button } from '@/components/ui/button';

export function TextSizeControl({ initialStep, locale }: { initialStep: FontStep; locale: 'fa' | 'en' }) {
  const t = useTranslations('profile.textSize');
  const router = useRouter();
  const viewing = useViewAs() !== null;
  const [step, setStep] = useState<FontStep>(initialStep);
  const [savedStep, setSavedStep] = useState<FontStep>(initialStep);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const res = await updateMyPrefs({ fontStep: step });
      if (!res.ok) {
        setMessage({ kind: 'error', text: res.error });
        return;
      }
      setSavedStep(step);
      setMessage({ kind: 'ok', text: t('saved') });
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <input
          type="range"
          min={0}
          max={4}
          step={1}
          value={step}
          aria-label={t('title')}
          aria-valuetext={fontStepLabel(step)}
          data-testid="text-size-slider"
          className="w-full accent-primary"
          onChange={(e) => {
            const n = Number(e.target.value);
            if (isFontStep(n)) {
              setStep(n);
              setMessage(null);
            }
          }}
        />
        <div className="grid grid-cols-5 text-center text-xs text-muted-foreground" aria-hidden="true">
          {FONT_STEPS.map((s) => (
            <span key={s} className={s === step ? 'font-semibold text-foreground' : undefined}>
              {fontStepLabel(s)}
            </span>
          ))}
        </div>
      </div>

      <div
        className="font-scale-scope rounded-md border p-3 space-y-1"
        style={{ '--font-scale': fontScale(step, locale) } as React.CSSProperties}
        data-testid="text-size-sample"
      >
        <p className="text-base font-semibold">{t('sampleTitle')}</p>
        <p className="text-sm">{t('sampleLine1')}</p>
        <p className="text-xs text-muted-foreground">{t('sampleLine2')}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={save} disabled={step === savedStep || isPending || viewing} data-testid="text-size-save">
          {t('save')}
        </Button>
        {viewing && <span className="text-xs text-muted-foreground">{t('viewAsDisabled')}</span>}
        {message && (
          <span role={message.kind === 'error' ? 'alert' : 'status'} className={`text-sm ${message.kind === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
            {message.text}
          </span>
        )}
      </div>
    </div>
  );
}
