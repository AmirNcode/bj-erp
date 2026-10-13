/**
 * Which search result a person picker may choose on its own (2026-10-13): the
 * only result, or the one whose personnel number is exactly what was typed.
 * Otherwise null — the picker then asks the user to select one.
 */
import { toAsciiDigits } from '@/lib/employees/code';

export function autoPick<T extends { personnelNo: string | null }>(results: T[], query: string): T | null {
  if (results.length === 1) return results[0];
  const q = toAsciiDigits(query).trim();
  if (!/^\d+$/.test(q)) return null;
  const exact = results.filter((r) => r.personnelNo === q);
  return exact.length === 1 ? exact[0] : null;
}
