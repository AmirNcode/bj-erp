/**
 * Unit tests for the raw-message → field mapping in `lib/errors/db-error.ts`.
 *
 * `localizeDbError` itself needs a next-intl request context and is exercised
 * end-to-end by the e2e suite. `fieldForDbError` is pure, and it is the half
 * that decides WHERE an error appears — which is what regressed: a duplicate
 * personnel number reached the user as the generic "unexpected error" banner
 * because no rule matched the message the database actually raises.
 */
import { describe, it, expect } from 'vitest';
import { fieldForDbError } from '@/lib/errors/db-error';

describe('fieldForDbError', () => {
  it('attributes the in-function duplicate check to the personnel number field', () => {
    // Raised by private.create_employee_impl with errcode 23505.
    expect(fieldForDbError('personnel number already exists')).toBe('personnel_no');
  });

  it('attributes the unique-index violation to the same field', () => {
    // The pre-check above can be lost to a concurrent create; this is the path
    // that actually enforces uniqueness, and it must not fall back to a banner.
    expect(
      fieldForDbError(
        'duplicate key value violates unique constraint "profiles_company_personnel_no_key"'
      )
    ).toBe('personnel_no');
  });

  it('attributes an invalid personnel number to the field', () => {
    expect(fieldForDbError('invalid personnel number (1-10 digits)')).toBe('personnel_no');
    // The server action raises its own shorter form before the round-trip.
    expect(fieldForDbError('invalid personnel number')).toBe('personnel_no');
  });

  it('leaves the EMPLOYEE CODE errors at page level', () => {
    // The form collects a personnel number; the code is derived from it (FR-31).
    // Pinning a code error to the personnel input would name the wrong thing.
    expect(fieldForDbError('employee code already exists')).toBeUndefined();
    expect(
      fieldForDbError('duplicate key value violates unique constraint "profiles_employee_code_key"')
    ).toBeUndefined();
  });

  it('leaves unrelated errors unattributed', () => {
    expect(fieldForDbError('not authenticated')).toBeUndefined();
    expect(fieldForDbError('overlapping approved leave exists')).toBeUndefined();
    expect(fieldForDbError('department not found')).toBeUndefined();
  });

  it('returns undefined for a message no rule matches', () => {
    // Such a message becomes dbErrors.unexpected, which belongs in the banner.
    expect(fieldForDbError('some brand new postgres error nobody mapped')).toBeUndefined();
  });

  it('agrees with first-match order rather than first-field-carrying order', () => {
    // A message matching an earlier fieldless rule must stay in the banner even
    // if a later field-carrying rule would also match it — otherwise the text
    // from one rule lands under the field chosen by another.
    const raw = 'not allowed to decide this request';
    expect(fieldForDbError(raw)).toBeUndefined();
  });

  it('is stateless across repeated calls', () => {
    // Guards against a `g`-flagged regex being added: `test()` on a global regex
    // advances lastIndex and would return false every other call.
    const raw = 'personnel number already exists';
    expect(fieldForDbError(raw)).toBe('personnel_no');
    expect(fieldForDbError(raw)).toBe('personnel_no');
    expect(fieldForDbError(raw)).toBe('personnel_no');
  });
});
