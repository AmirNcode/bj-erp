import type { FontStep } from '@/lib/prefs/fontScale';

/** Overrides the default `--font-step` for this person (see globals.css). */
export function FontStepStyle({ step }: { step: FontStep }) {
  return <style>{`:root:root{--font-step:${step}}`}</style>;
}
