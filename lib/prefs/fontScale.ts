/**
 * Per-person text size. Five steps; the multiplier is `1 + 0.1 * step`, plus one
 * extra step for Farsi (Vazirmatn reads smaller than Latin at the same size).
 * Mirrors the CSS in `app/globals.css` (`--font-step` / `--font-scale`).
 * Pure helpers, safe on server and client.
 */
export const FONT_STEPS = [0, 1, 2, 3, 4] as const;
export type FontStep = (typeof FONT_STEPS)[number];

export function isFontStep(v: unknown): v is FontStep {
  return typeof v === 'number' && (FONT_STEPS as readonly number[]).includes(v);
}

export function fontScale(step: FontStep, locale: 'fa' | 'en'): number {
  const raw = 1 + 0.1 * (step + (locale === 'fa' ? 1 : 0));
  return Math.round(raw * 100) / 100;
}

/** The label is the same for everyone: '100%' … '140%' (no Farsi bonus). */
export function fontStepLabel(step: FontStep): string {
  return `${100 + step * 10}%`;
}
