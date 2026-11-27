/**
 * FR-98 §7 / FR-99: pure rules behind the customer form — live "what is still missing" feedback
 * (the SQL `sales_customer_missing_of` is the truth; this only mirrors it for the open form)
 * and key-people validation. No React.
 */

import { hasGrades } from './customers';
import type { ContactLabel, CustomerInput, CustomerMissingKey, CustomerPerson } from './types';

export const CONTACT_LABELS: ContactLabel[] = ['office', 'mobile', 'fax', 'other'];

const PHONE_RE = /^\+?[0-9]{5,15}$/;

/** Mirror of `private.sales_phone`: Persian / Arabic digits to Latin, spaces and `( ) . -` dropped. */
export function normalizePhone(raw: string | null | undefined): string {
  const latin = (raw ?? '')
    .trim()
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  return latin.replace(/[\s().-]/g, '');
}

/** True for a number the database accepts (after normalizing). */
export function isValidPhone(raw: string | null | undefined): boolean {
  return PHONE_RE.test(normalizePhone(raw));
}

export const MAX_PEOPLE = 50;
export const MAX_PHONES = 5;

/** One entry of the form's Key people section (the CEO is a separate card). */
export type PersonRow = {
  name: string;
  title_id: string;
  email: string;
  phones: { label: ContactLabel; phone: string }[];
  /** A company line: no name, no title, only numbers. */
  companyLine: boolean;
};
export const emptyPerson = (companyLine = false): PersonRow => ({
  name: '', title_id: '', email: '', phones: [{ label: companyLine ? 'office' : 'mobile', phone: '' }], companyLine,
});

/** empty: nothing typed (dropped on save) · partial: a number that is not valid, or only an email (blocks Save) · ok. */
export type PersonState = 'empty' | 'partial' | 'ok';

export function personState(r: PersonRow): PersonState {
  const typed = r.phones.filter((p) => p.phone.trim() !== '');
  if (typed.some((p) => !isValidPhone(p.phone))) return 'partial';
  const name = !r.companyLine && r.name.trim() !== '';
  const title = !r.companyLine && r.title_id !== '';
  if (!name && !title && typed.length === 0) return r.email.trim() !== '' && !r.companyLine ? 'partial' : 'empty';
  return 'ok';
}

/** True when some entry blocks Save. */
export function hasPartialPerson(rows: PersonRow[]): boolean {
  return rows.some((r) => personState(r) === 'partial');
}

/** Entries ready to send: empty ones dropped, text trimmed, numbers normalized, company lines without name / title. */
export function cleanPeople(rows: PersonRow[]): CustomerPerson[] {
  const out: CustomerPerson[] = [];
  for (const r of rows) {
    if (personState(r) !== 'ok') continue;
    out.push({
      name: r.companyLine ? null : r.name.trim() || null,
      title_id: r.companyLine ? null : r.title_id || null,
      email: r.companyLine ? null : r.email.trim() || null,
      phones: r.phones.filter((p) => p.phone.trim() !== '').map((p) => ({ label: p.label, phone: normalizePhone(p.phone) })),
    });
  }
  return out;
}

/** True when the CEO line or any entry holds a number (the `phones` completeness rule). */
export function hasPhone(ceoPhone: string | null | undefined, rows: Pick<PersonRow, 'phones'>[] | Pick<CustomerPerson, 'phones'>[]): boolean {
  if (isValidPhone(ceoPhone)) return true;
  return rows.some((r) => r.phones.some((p) => isValidPhone(p.phone)));
}

/** empty: nothing picked (dropped on save) · partial: one of the two · ok. */
export type GradeStateName = 'empty' | 'partial' | 'ok';

/** One rank + category row of the form (the first row is the customer's main pair). */
export type GradeRow = { key: number; rank: string; categoryId: string | null };

/** empty: nothing picked (dropped on save) · partial: one of the two · ok. */
export function gradeState(r: GradeRow): GradeStateName {
  const rank = r.rank !== '';
  const cat = !!r.categoryId;
  if (!rank && !cat) return 'empty';
  return rank && cat ? 'ok' : 'partial';
}

/**
 * The rows as the save payload: empty rows dropped, the first remaining row is the main pair
 * (may be half filled: the customer is then Incomplete), the rest go to `grades`.
 */
export function gradesPayload(rows: GradeRow[]): Pick<CustomerInput, 'rank' | 'category_id' | 'grades'> {
  const kept = rows.filter((r) => gradeState(r) !== 'empty');
  const [first, ...rest] = kept;
  return {
    rank: first?.rank ? Number(first.rank) : null,
    category_id: first?.categoryId ?? null,
    grades: rest.filter((r) => gradeState(r) === 'ok').map((r) => ({ rank: Number(r.rank), category_id: r.categoryId as string })),
  };
}

/** True when a row after the main pair is half filled (blocks Save; the main pair may be a draft). */
export function hasPartialGrade(rows: GradeRow[]): boolean {
  return rows.filter((r) => gradeState(r) !== 'empty').slice(1).some((r) => gradeState(r) === 'partial');
}

/**
 * Required keys still empty, in form order (mirror of `private.sales_customer_missing_of`):
 * a number anywhere counts as `phones`; every type needs a complete rank + category pair OR a description.
 */
export function missingKeys(input: CustomerInput): CustomerMissingKey[] {
  const out: CustomerMissingKey[] = [];
  const has = (v: string | null | undefined) => !!v && v.trim() !== '';
  const graded = hasGrades(input.kind);
  const rank = graded ? input.rank : null;
  const category = graded ? input.category_id : null;
  if (!has(input.name_en)) out.push('name_en');
  if (!input.kind) out.push('kind');
  if (!has(input.ceo_name)) out.push('ceo_name');
  if (!input.province_code) out.push('province');
  if (!input.city_id) out.push('city');
  if (!has(input.address)) out.push('address');
  if (!hasPhone(input.ceo_phone, input.people)) out.push('phones');
  if (category && !rank) out.push('rank');
  if (rank && !category) out.push('category');
  if (!(rank && category) && !has(input.activity)) out.push('grade_or_activity');
  return out;
}
