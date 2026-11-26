/**
 * FR-98 D4: which name to show for a customer. English UI → the English name / abbreviation when
 * there is one, else the Farsi name; Farsi UI → the Farsi name. Pure.
 */

export function customerLabel(c: { name: string | null; name_en?: string | null } | null | undefined, locale: string): string {
  if (!c) return '';
  if (locale === 'en' && c.name_en) return c.name_en;
  return c.name ?? '';
}

/** Same rule for flat rows that carry `<prefix>_name` / `<prefix>_name_en` (records, deadlines, reports). */
export function labelOf(name: string | null | undefined, nameEn: string | null | undefined, locale: string): string {
  return customerLabel({ name: name ?? null, name_en: nameEn ?? null }, locale);
}
