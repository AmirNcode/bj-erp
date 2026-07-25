/**
 * Employee-code helpers — the client-side mirror of the in-DB formula in
 * private.create_employee_impl (migration 20260713120001):
 *   employee_code = departments.code || '-' || personnel_no
 * The database is the source of truth; these exist for live previews and
 * fast localized validation only. Keep the regexes identical to the SQL.
 */

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** Converts Persian / Arabic-Indic digits to ASCII (Excel in Farsi emits both). */
export function toAsciiDigits(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, (d) => {
    const p = PERSIAN_DIGITS.indexOf(d);
    return String(p !== -1 ? p : ARABIC_DIGITS.indexOf(d));
  });
}

/** Trims and converts Persian / Arabic-Indic digits to ASCII. */
export function normalizePersonnelNo(value: string): string {
  return toAsciiDigits(value.trim());
}

/** Mirrors the SQL check: personnel_no ~ '^[0-9]{1,10}$'. */
export function isValidPersonnelNo(value: string): boolean {
  return /^[0-9]{1,10}$/.test(value);
}

/** Mirrors the in-DB composition; department codes are stored lowercase. */
export function buildEmployeeCode(deptCode: string, personnelNo: string): string {
  return `${deptCode.toLowerCase()}-${personnelNo}`;
}
