/**
 * Per-person text size. Five steps; the multiplier is `1 + 0.1 * step`, the same
 * for Farsi and English.
 * Mirrors the CSS in `app/globals.css` (`--font-step` / `--font-scale`).
 * Pure helpers, safe on server and client.
 */
export const FONT_STEPS = [0, 1, 2, 3, 4] as const;
export type FontStep = (typeof FONT_STEPS)[number];

export function isFontStep(v: unknown): v is FontStep {
  return typeof v === 'number' && (FONT_STEPS as readonly number[]).includes(v);
}

export function fontScale(step: FontStep): number {
  return Math.round((1 + 0.1 * step) * 100) / 100;
}

/** The label is the same for everyone: '100%' … '140%'. */
export function fontStepLabel(step: FontStep): string {
  return `${100 + step * 10}%`;
}
