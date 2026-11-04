/**
 * Placeholder for a person without a photo (FR-82): up to two initials and a stable colour.
 */

const PALETTE = [
  'bg-sky-100 text-sky-800',
  'bg-emerald-100 text-emerald-800',
  'bg-amber-100 text-amber-800',
  'bg-rose-100 text-rose-800',
  'bg-violet-100 text-violet-800',
  'bg-teal-100 text-teal-800',
  'bg-orange-100 text-orange-800',
  'bg-indigo-100 text-indigo-800',
] as const;

/**
 * First letter of the first and last word, joined with a zero-width non-joiner so two Persian
 * letters stay separate glyphs (as the org chart always did).
 */
export function initials(name: string | null | undefined): string {
  const words = (name ?? '')
    .trim()
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w));
  if (words.length === 0) return '؟';
  const first = Array.from(words[0])[0] ?? '';
  if (words.length === 1) return first.toLocaleUpperCase();
  const last = Array.from(words[words.length - 1])[0] ?? '';
  return `${first}\u200c${last}`.toLocaleUpperCase();
}

/** Same colour for the same person on every screen. */
export function avatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}
