/**
 * Personal information (FR-53): field list, normalisation and validation.
 *
 * Pure module, shared by the profile form, the HR form, the server action and the
 * CSV import/export. The database repeats every rule as a CHECK constraint
 * (migration 20261007140001); keep the two in step. Spec:
 * docs/specs/2026-10-07-saved-signature-and-personal-info-design.md §1.
 */

import { toAsciiDigits } from '@/lib/employees/code';
import { parseUserDate } from '@/lib/leave/parseUserDate';
import { gregorianToPersianDateObject } from '@/lib/leave/dateConvert';

export type PersonalInfoGroup = 'identity' | 'bank' | 'contact' | 'employment';

export const GENDERS = ['male', 'female'] as const;
export const MARITAL_STATUSES = ['single', 'married'] as const;
export const EDUCATION_LEVELS = [
  'below_diploma',
  'diploma',
  'associate',
  'bachelor',
  'master',
  'doctorate',
] as const;
export const MILITARY_STATUSES = [
  'completed',
  'exempt',
  'educational_exempt',
  'eligible',
  'not_applicable',
] as const;

export type PersonalInfoKey =
  | 'national_id'
  | 'birth_cert_no'
  | 'father_name'
  | 'birth_date'
  | 'birth_place'
  | 'gender'
  | 'marital_status'
  | 'bank_name'
  | 'bank_account_no'
  | 'sheba'
  | 'card_no'
  | 'mobile'
  | 'home_phone'
  | 'address'
  | 'postal_code'
  | 'emergency_name'
  | 'emergency_phone'
  | 'insurance_no'
  | 'education'
  | 'military_status'
  | 'children_count';

type Kind = 'digits' | 'text' | 'longtext' | 'date' | 'choice' | 'sheba' | 'count';

export type PersonalInfoField = {
  key: PersonalInfoKey;
  group: PersonalInfoGroup;
  kind: Kind;
  /** CSV header label (Farsi); the header cell is `label (key)` like the roster import. */
  labelFa: string;
  choices?: readonly string[];
};

export const PERSONAL_INFO_FIELDS: PersonalInfoField[] = [
  { key: 'national_id', group: 'identity', kind: 'digits', labelFa: 'کد ملی' },
  { key: 'birth_cert_no', group: 'identity', kind: 'digits', labelFa: 'شماره شناسنامه' },
  { key: 'father_name', group: 'identity', kind: 'text', labelFa: 'نام پدر' },
  { key: 'birth_date', group: 'identity', kind: 'date', labelFa: 'تاریخ تولد' },
  { key: 'birth_place', group: 'identity', kind: 'text', labelFa: 'محل تولد' },
  { key: 'gender', group: 'identity', kind: 'choice', labelFa: 'جنسیت', choices: GENDERS },
  { key: 'marital_status', group: 'identity', kind: 'choice', labelFa: 'وضعیت تاهل', choices: MARITAL_STATUSES },
  { key: 'bank_name', group: 'bank', kind: 'text', labelFa: 'نام بانک' },
  { key: 'bank_account_no', group: 'bank', kind: 'digits', labelFa: 'شماره حساب' },
  { key: 'sheba', group: 'bank', kind: 'sheba', labelFa: 'شماره شبا' },
  { key: 'card_no', group: 'bank', kind: 'digits', labelFa: 'شماره کارت' },
  { key: 'mobile', group: 'contact', kind: 'digits', labelFa: 'تلفن همراه' },
  { key: 'home_phone', group: 'contact', kind: 'digits', labelFa: 'تلفن منزل' },
  { key: 'address', group: 'contact', kind: 'longtext', labelFa: 'نشانی' },
  { key: 'postal_code', group: 'contact', kind: 'digits', labelFa: 'کد پستی' },
  { key: 'emergency_name', group: 'contact', kind: 'text', labelFa: 'نام تماس اضطراری' },
  { key: 'emergency_phone', group: 'contact', kind: 'digits', labelFa: 'تلفن تماس اضطراری' },
  { key: 'insurance_no', group: 'employment', kind: 'digits', labelFa: 'شماره بیمه تامین اجتماعی' },
  { key: 'education', group: 'employment', kind: 'choice', labelFa: 'مدرک تحصیلی', choices: EDUCATION_LEVELS },
  { key: 'military_status', group: 'employment', kind: 'choice', labelFa: 'وضعیت نظام وظیفه', choices: MILITARY_STATUSES },
  { key: 'children_count', group: 'employment', kind: 'count', labelFa: 'تعداد فرزندان' },
];

export const PERSONAL_INFO_GROUPS: PersonalInfoGroup[] = ['identity', 'bank', 'contact', 'employment'];

/** The "core five" behind the generated `complete` column. */
export const CORE_FIELDS: PersonalInfoKey[] = ['national_id', 'father_name', 'birth_date', 'sheba', 'mobile'];

/** What the DB row and the form exchange: every field nullable; dates Gregorian ISO. */
export type PersonalInfoValues = {
  [K in PersonalInfoKey]: K extends 'children_count' ? number | null : string | null;
};

export function emptyPersonalInfo(): PersonalInfoValues {
  return Object.fromEntries(PERSONAL_INFO_FIELDS.map((f) => [f.key, null])) as PersonalInfoValues;
}

/** Why a value was refused; the UI maps it to a translated message per field. */
export type FieldProblem = 'format' | 'checksum' | 'length' | 'choice' | 'date';

// ── checksums (mirror private.is_valid_* in SQL) ────────────────────────────

/** Iranian national ID: 10 digits, weighted check digit mod 11. */
export function isValidNationalId(value: string): boolean {
  if (!/^\d{10}$/.test(value) || /^(\d)\1{9}$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(value[i]) * (10 - i);
  const rem = sum % 11;
  const check = Number(value[9]);
  return rem < 2 ? check === rem : check === 11 - rem;
}

/** Sheba: IR + 24 digits, ISO 13616 mod-97 = 1. */
export function isValidSheba(value: string): boolean {
  if (!/^IR\d{24}$/.test(value)) return false;
  const digits = value.slice(4) + '1827' + value.slice(2, 4);
  let rem = 0;
  for (const ch of digits) rem = (rem * 10 + Number(ch)) % 97;
  return rem === 1;
}

/** 16-digit bank card, Luhn. */
export function isValidCardNo(value: string): boolean {
  if (!/^\d{16}$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 16; i++) {
    let d = Number(value[i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

const DIGIT_RULES: Partial<Record<PersonalInfoKey, { re: RegExp; check?: (v: string) => boolean }>> = {
  national_id: { re: /^\d{10}$/, check: isValidNationalId },
  birth_cert_no: { re: /^\d{1,10}$/ },
  bank_account_no: { re: /^\d{5,20}$/ },
  card_no: { re: /^\d{16}$/, check: isValidCardNo },
  mobile: { re: /^09\d{9}$/ },
  home_phone: { re: /^0\d{10}$/ },
  postal_code: { re: /^\d{10}$/ },
  emergency_phone: { re: /^0\d{10}$/ },
  insurance_no: { re: /^\d{6,12}$/ },
};

/**
 * Turns what a person typed (or a CSV cell held) into the stored form, or reports
 * why it cannot be stored. Empty input is `null` (no value), never an error.
 * Persian/Arabic digits, spaces and dashes in number fields are accepted.
 */
export function parseFieldInput(
  field: PersonalInfoField,
  raw: string
): { ok: true; value: string | number | null } | { ok: false; problem: FieldProblem } {
  const trimmed = toAsciiDigits((raw ?? '').trim());
  if (!trimmed) return { ok: true, value: null };

  switch (field.kind) {
    case 'digits': {
      const v = trimmed.replace(/[\s\-\u200c]/g, '');
      const rule = DIGIT_RULES[field.key]!;
      if (!rule.re.test(v)) return { ok: false, problem: 'format' };
      if (rule.check && !rule.check(v)) return { ok: false, problem: 'checksum' };
      return { ok: true, value: v };
    }
    case 'sheba': {
      let v = trimmed.replace(/[\s\-]/g, '').toUpperCase();
      if (/^\d{24}$/.test(v)) v = `IR${v}`;
      if (!/^IR\d{24}$/.test(v)) return { ok: false, problem: 'format' };
      if (!isValidSheba(v)) return { ok: false, problem: 'checksum' };
      return { ok: true, value: v };
    }
    case 'text':
      return trimmed.length > 100 ? { ok: false, problem: 'length' } : { ok: true, value: trimmed };
    case 'longtext':
      return trimmed.length > 500 ? { ok: false, problem: 'length' } : { ok: true, value: trimmed };
    case 'choice':
      return field.choices!.includes(trimmed)
        ? { ok: true, value: trimmed }
        : { ok: false, problem: 'choice' };
    case 'count': {
      if (!/^\d{1,2}$/.test(trimmed)) return { ok: false, problem: 'format' };
      const n = Number(trimmed);
      return n > 20 ? { ok: false, problem: 'format' } : { ok: true, value: n };
    }
    case 'date': {
      const iso = parseUserDate(trimmed);
      if (!iso || iso < '1920-01-01' || iso > '2020-12-31') return { ok: false, problem: 'date' };
      return { ok: true, value: iso };
    }
  }
}

/** Stored Gregorian ISO → `1369/01/01` (ASCII digits) for inputs and CSV cells. */
export function isoToJalaliInput(iso: string | null): string {
  if (!iso) return '';
  return gregorianToPersianDateObject(iso, 'en')?.format('YYYY/MM/DD') ?? '';
}

/** A stored value as the text an input or CSV cell shows. */
export function fieldToInput(field: PersonalInfoField, value: string | number | null): string {
  if (value === null || value === undefined) return '';
  if (field.kind === 'date') return isoToJalaliInput(String(value));
  return String(value);
}

/**
 * Validates a whole form (key → typed text). Returns the stored values and the
 * per-field problems; `values` is only meaningful when `problems` is empty.
 */
export function parsePersonalInfoForm(input: Partial<Record<PersonalInfoKey, string>>): {
  values: PersonalInfoValues;
  problems: Partial<Record<PersonalInfoKey, FieldProblem>>;
} {
  const values = emptyPersonalInfo();
  const problems: Partial<Record<PersonalInfoKey, FieldProblem>> = {};
  for (const field of PERSONAL_INFO_FIELDS) {
    const res = parseFieldInput(field, input[field.key] ?? '');
    if (res.ok) (values as Record<string, unknown>)[field.key] = res.value;
    else problems[field.key] = res.problem;
  }
  return { values, problems };
}

export function isPersonalInfoComplete(values: Pick<PersonalInfoValues, (typeof CORE_FIELDS)[number]>): boolean {
  return CORE_FIELDS.every((k) => values[k] !== null && values[k] !== '');
}
