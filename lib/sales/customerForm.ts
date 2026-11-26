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
