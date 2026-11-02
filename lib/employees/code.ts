/**
 * Employee-code helpers — the client-side mirror of the in-DB formula in
 * private.create_employee_impl (migration 20260730130002):
 *   employee_code = personnel_no
 * Before 2026-07-30 it was `departments.code || '-' || personnel_no`; accounts
 * created then were not migrated, so `prod-1042` and `1042` both log in.
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

/**
 * Mirrors private.valid_personnel_no (migration 20261102140000): 1–10 digits,
 * or — for the admin only — any text of 1–64 characters with no surrounding
 * whitespace (security staff are a subcontractor with no company number).
 */
export function isValidPersonnelNo(value: string, admin = false): boolean {
  if (admin) return value.length >= 1 && value.length <= 64 && value === value.trim();
  return /^[0-9]{1,10}$/.test(value);
}

/** Shows a personnel number in the locale's digits; one that is not all digits stays as typed. */
export function displayPersonnelNo(value: string, format: (n: number) => string): string {
  return /^[0-9]+$/.test(value) ? format(Number(value)) : value;
}

/**
 * Login-field sanitiser for the employee code. The code becomes the synthetic
 * auth email (`code@bj-app.internal`), so a Persian character typed on a Farsi
 * keyboard yields a code that can never match any account. Persian/Arabic-Indic
 * digits are converted; everything outside printable ASCII is dropped, spaces
 * included — codes never contain one.
 */
export function toLatinCode(value: string): string {
  return toAsciiDigits(value).replace(/[^\x21-\x7E]/g, '');
}

/**
 * Mirrors the in-DB composition: the login code IS the personnel number.
 * Trimmed the way `btrim(coalesce(p_personnel_no, ''))` trims it in SQL.
 * Kept as a named function rather than inlined so the one place the formula
 * lives on the client stays greppable if codes ever gain a prefix again.
 */
export function buildEmployeeCode(personnelNo: string): string {
  return personnelNo.trim();
}

/**
 * Mirrors private.valid_login_code (migration 20261102130000): an admin-chosen
 * login code is 1–64 characters an email local part takes unquoted — English
 * letters, digits and ! # $ % & ' * + / = ? ^ _ ` { | } ~ - — plus dots that
 * neither start, end nor repeat. No spaces, no @.
 */
export function isValidLoginCode(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= 64 &&
    /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/.test(value)
  );
}
