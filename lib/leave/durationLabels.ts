import type { DurationLabels } from './duration';

/**
 * Builds the `DurationLabels` bundle from a `leave`-namespace translator.
 *
 * Exists so the four keys are not hand-wired in every page that renders a
 * duration (home, request, approvals, manage). `duration.ts` stays pure and
 * i18n-free; this is the one place that knows the key names.
 *
 * Usage in a server component:
 *   const tLeave = await getTranslations({ locale, namespace: 'leave' });
 *   const durationLabels = durationLabelsFrom(tLeave);
 */
export function durationLabelsFrom(t: (key: string) => string): DurationLabels {
  return {
    days: t('days'),
    hours: t('hours'),
    minutes: t('minutes'),
    and: t('and'),
  };
}
