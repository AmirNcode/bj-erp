/**
 * FR-98 §7: pure rules behind the customer form — live "what is still missing" feedback
 * (the SQL `sales_customer_missing` is the truth; this only mirrors it for the open form)
 * and contact-row validation. No React.
 */

import type { ContactLabel, CustomerContact, CustomerInput, CustomerMissingKey } from './types';

export const CONTACT_LABELS: ContactLabel[] = ['office', 'mobile', 'fax', 'other'];

export type ContactRow = { person: string; title: string; label: ContactLabel; phone: string; email: string };
export const emptyContactRow = (): ContactRow => ({ person: '', title: '', label: 'office', phone: '', email: '' });

/** empty: nothing typed (dropped on save) · partial: person or phone missing · ok. */
export type ContactState = 'empty' | 'partial' | 'ok';

export function contactState(r: ContactRow): ContactState {
  const person = r.person.trim() !== '';
  const phone = r.phone.trim() !== '';
  if (!person && !phone && r.title.trim() === '' && r.email.trim() === '') return 'empty';
  return person && phone ? 'ok' : 'partial';
}

/** True when some row is half filled (blocks Save). */
export function hasPartialContact(rows: ContactRow[]): boolean {
  return rows.some((r) => contactState(r) === 'partial');
}

/** Rows ready to send: empty rows dropped, text trimmed, blanks as null. */
export function cleanContacts(rows: ContactRow[]): CustomerContact[] {
  return rows
    .filter((r) => contactState(r) === 'ok')
    .map((r) => ({
      person: r.person.trim(),
      title: r.title.trim() || null,
      label: r.label,
      phone: r.phone.trim(),
      email: r.email.trim() || null,
    }));
}

/** One rank + category row of the form (the first row is the customer's main pair). */
export type GradeRow = { key: number; rank: string; categoryId: string | null };

/** empty: nothing picked (dropped on save) · partial: one of the two · ok. */
export function gradeState(r: GradeRow): ContactState {
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

/** Required keys still empty, in form order (spec §4). */
export function missingKeys(input: CustomerInput): CustomerMissingKey[] {
  const out: CustomerMissingKey[] = [];
  const has = (v: string | null | undefined) => !!v && v.trim() !== '';
  if (!has(input.name_en)) out.push('name_en');
  if (!input.kind) out.push('kind');
  if (!has(input.ceo_name)) out.push('ceo_name');
  if (!input.province_code) out.push('province');
  if (!input.city_id) out.push('city');
  if (!has(input.address)) out.push('address');
  if (input.contacts.length === 0) out.push('contacts');
  if (input.kind === 'contractor') {
    if (!input.rank) out.push('rank');
    if (!input.category_id) out.push('category');
  }
  return out;
}
