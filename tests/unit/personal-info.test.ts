import { describe, expect, it } from 'vitest';
import {
  PERSONAL_INFO_FIELDS,
  isPersonalInfoComplete,
  isValidCardNo,
  isValidNationalId,
  isValidSheba,
  parseFieldInput,
  parsePersonalInfoForm,
  fieldToInput,
} from '@/lib/personal-info/fields';
import {
  personalInfoCsvRow,
  personalInfoHeader,
  validatePersonalInfoCsv,
} from '@/lib/personal-info/csv';

const field = (key: string) => PERSONAL_INFO_FIELDS.find((f) => f.key === key)!;

describe('checksums (mirror the SQL validators)', () => {
  it('national ID', () => {
    expect(isValidNationalId('0012345679')).toBe(true);
    expect(isValidNationalId('1234567891')).toBe(true);
    expect(isValidNationalId('0012345678')).toBe(false);
    expect(isValidNationalId('1111111111')).toBe(false);
    expect(isValidNationalId('001234567')).toBe(false);
  });

  it('Sheba', () => {
    expect(isValidSheba('IR820540102680020817909002')).toBe(true);
    expect(isValidSheba('IR30062960000000100324200001')).toBe(false); // 28 chars
    expect(isValidSheba('IR820540102680020817909003')).toBe(false);
  });

  it('card number (Luhn)', () => {
    expect(isValidCardNo('6037991234567893')).toBe(true);
    expect(isValidCardNo('6037991234567890')).toBe(false);
  });
});

describe('parseFieldInput', () => {
  it('accepts Persian digits, spaces and dashes in number fields', () => {
    expect(parseFieldInput(field('national_id'), '۰۰۱-۲۳۴۵۶۷-۹')).toEqual({ ok: true, value: '0012345679' });
    expect(parseFieldInput(field('card_no'), '6037 9912 3456 7893')).toEqual({ ok: true, value: '6037991234567893' });
    expect(parseFieldInput(field('mobile'), '۰۹۱۲ ۱۲۳ ۴۵۶۷')).toEqual({ ok: true, value: '09121234567' });
  });

  it('distinguishes a bad shape from a bad checksum', () => {
    expect(parseFieldInput(field('national_id'), '12345')).toEqual({ ok: false, problem: 'format' });
    expect(parseFieldInput(field('national_id'), '0012345678')).toEqual({ ok: false, problem: 'checksum' });
  });

  it('adds the IR prefix to a bare 24-digit Sheba and upper-cases it', () => {
    expect(parseFieldInput(field('sheba'), '820540102680020817909002')).toEqual({
      ok: true,
      value: 'IR820540102680020817909002',
    });
    expect(parseFieldInput(field('sheba'), 'ir82 0540 1026 8002 0817 9090 02')).toEqual({
      ok: true,
      value: 'IR820540102680020817909002',
    });
  });

  it('empty input is no value, never an error', () => {
    for (const f of PERSONAL_INFO_FIELDS) expect(parseFieldInput(f, '  ')).toEqual({ ok: true, value: null });
  });

  it('reads Jalali or Gregorian birth dates and stores Gregorian', () => {
    expect(parseFieldInput(field('birth_date'), '1369/01/01')).toEqual({ ok: true, value: '1990-03-21' });
    expect(parseFieldInput(field('birth_date'), '1990-03-21')).toEqual({ ok: true, value: '1990-03-21' });
    expect(parseFieldInput(field('birth_date'), '1369/12/31')).toEqual({ ok: false, problem: 'date' });
    expect(parseFieldInput(field('birth_date'), '1405/01/01')).toEqual({ ok: false, problem: 'date' });
  });

  it('choices and counts', () => {
    expect(parseFieldInput(field('gender'), 'female')).toEqual({ ok: true, value: 'female' });
    expect(parseFieldInput(field('gender'), 'other')).toEqual({ ok: false, problem: 'choice' });
    expect(parseFieldInput(field('children_count'), '۳')).toEqual({ ok: true, value: 3 });
    expect(parseFieldInput(field('children_count'), '21')).toEqual({ ok: false, problem: 'format' });
  });

  it('round-trips a stored date to the Jalali input form', () => {
    expect(fieldToInput(field('birth_date'), '1990-03-21')).toBe('1369/01/01');
  });
});

describe('parsePersonalInfoForm', () => {
  it('collects every problem at once and reports completeness', () => {
    const bad = parsePersonalInfoForm({ national_id: '1', mobile: '0912' });
    expect(Object.keys(bad.problems).sort()).toEqual(['mobile', 'national_id']);

    const good = parsePersonalInfoForm({
      national_id: '0012345679',
      father_name: 'Ali',
      birth_date: '1369/01/01',
      sheba: 'IR820540102680020817909002',
      mobile: '09121234567',
    });
    expect(good.problems).toEqual({});
    expect(isPersonalInfoComplete(good.values)).toBe(true);
    expect(isPersonalInfoComplete({ ...good.values, mobile: null })).toBe(false);
  });
});

describe('personal-info CSV', () => {
  const header = personalInfoHeader();
  const exported = personalInfoCsvRow({
    personnel_no: '123',
    full_name: 'Ali',
    national_id: '0012345679',
    birth_cert_no: null,
    father_name: 'Reza',
    birth_date: '1990-03-21',
    birth_place: null,
    gender: 'male',
    marital_status: 'married',
    bank_name: null,
    bank_account_no: null,
    sheba: null,
    card_no: null,
    mobile: null,
    home_phone: null,
    address: null,
    postal_code: null,
    emergency_name: null,
    emergency_phone: null,
    insurance_no: null,
    education: 'bachelor',
    military_status: null,
    children_count: 2,
  });

  it('exports Farsi choice words and Jalali dates', () => {
    expect(header[0]).toBe('شماره پرسنلی (personnel_no)');
    expect(exported).toContain('مرد');
    expect(exported).toContain('کارشناسی');
    expect(exported).toContain('1369/01/01');
  });

  it('an exported file imports back unchanged', () => {
    const { rows, errors } = validatePersonalInfoCsv([header, exported], new Set(['123']));
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      {
        personnel_no: '123',
        national_id: '0012345679',
        father_name: 'Reza',
        birth_date: '1990-03-21',
        gender: 'male',
        marital_status: 'married',
        education: 'bachelor',
        children_count: 2,
      },
    ]);
  });

  it('reports every bad line, unknown and duplicate personnel numbers', () => {
    const { rows, errors } = validatePersonalInfoCsv(
      [
        ['personnel_no', 'national_id', 'mobile'],
        ['123', '0012345678', ''],
        ['999', '', '09121234567'],
        ['456', '', '09121234567'],
        ['456', '', '09121234568'],
        ['', '', ''],
      ],
      new Set(['123', '456'])
    );
    expect(rows).toEqual([{ personnel_no: '456', mobile: '09121234567' }]);
    expect(errors.map((e) => [e.line, e.problem])).toEqual([
      [2, 'checksum'],
      [3, 'unknownEmployee'],
      [5, 'duplicate'],
    ]);
  });

  it('requires the personnel number column', () => {
    const { errors } = validatePersonalInfoCsv([['mobile'], ['09121234567']], new Set());
    expect(errors[0].problem).toBe('missingColumn');
  });
});
