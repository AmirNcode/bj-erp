/** File size cap and name cleaning for Sales uploads. Server-only. */
export const MAX_FILE_BYTES = 52_428_800;

export class TooLargeError extends Error {
  constructor(message = 'file too large') {
    super(message);
    this.name = 'TooLargeError';
  }
}

/** Throws TooLargeError unless 1 <= n <= MAX_FILE_BYTES (0 and non-integers are refused too). */
export function checkDeclaredSize(n: number): void {
  if (!Number.isInteger(n) || n < 1) throw new Error('invalid size');
  if (n > MAX_FILE_BYTES) throw new TooLargeError();
}

/** Display-only name: basename after the last / or \, control characters removed, max 255 chars. */
export function cleanFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const name = base.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, '').trim();
  return Array.from(name).slice(0, 255).join('') || 'file';
}
