/**
 * Unit tests for the raw-message → field mapping in `lib/errors/db-error.ts`.
 *
 * `localizeDbError` itself needs a next-intl request context and is exercised
 * end-to-end by the e2e suite. `fieldForDbError` is pure, and it is the half
 * that decides WHERE an error appears — which is what regressed: a duplicate
 * personnel number reached the user as the generic "unexpected error" banner
 * because no rule matched the message the database actually raises.
 */
import { describe, it, expect, vi } from 'vitest';
import { dbErr, fieldForDbError } from '@/lib/errors/db-error';

// Echo the message key (plus its params as JSON, when given), so a test can
// tell WHICH rule matched and what it extracted.
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}${JSON.stringify(params)}` : key,
}));

describe('dbErr bare permission message', () => {
  it("maps requireCaller's bare 'not allowed' to the notAllowed key", async () => {
    expect((await dbErr('not allowed')).error).toBe('notAllowed');
  });
});

describe('dbErr FR-55 role messages', () => {
  const msg = async (raw: string) => (await dbErr(raw)).error;

  it('maps the role-editing refusals before the generic catch-all', async () => {
    expect(await msg('only the admin can edit roles')).toBe('rolesAdminOnly');
    expect(await msg('only the admin can delete roles')).toBe('rolesAdminOnly');
    expect(await msg('only the admin can list role holders')).toBe('rolesAdminOnly');
    expect(await msg('only the admin can transfer admin')).toBe('transferAdminOnly');
    expect(await msg('role name already used')).toBe('roleNameUsed');
    expect(await msg('built-in roles cannot be deleted')).toBe('roleBuiltInNoDelete');
    expect(await msg('wrong password')).toBe('wrongCurrentPassword');
  });

  it('maps the "not allowed to give or remove role" prefix and keeps the role name', async () => {
    expect(await msg('not allowed to give or remove role Payroll Clerk')).toBe(
      'roleChangeNotAllowed{"role":"Payroll Clerk"}'
    );
  });

  it('maps the dependency and permission-value messages with their params', async () => {
    expect(await msg('reports needs people')).toBe('permissionNeeds{"key":"reports","needs":"people"}');
    expect(await msg('invalid permission people = "super"')).toBe(
      'permissionInvalid{"key":"people","level":"\\"super\\""}'
    );
  });

  it('maps the bulk password reset refusal per personnel number', async () => {
    expect(await msg('not allowed on 1042')).toBe('accessAboveYoursOn{"personnelNo":"1042"}');
    expect(await msg('not allowed on this employee')).toBe('accessAboveYours');
  });

  it('maps the FR-55 special-leave and approval-order refusals (R5)', async () => {
    expect(await msg('not allowed to grant special leave to this employee')).toBe('accessAboveYours');
    expect(await msg('not allowed to grant special leave')).toBe('notAllowed');
    expect(await msg('not allowed to change the approval order setting')).toBe('approvalOrderNotAllowed');
    expect(await msg('only an admin may change the hours per day')).toBe('adminOnlySetting');
    // The marriage box stays offered when marital status is unreadable; this refusal decides.
    expect(await msg('marriage leave needs marital status single')).toBe('marriageNeedsSingle');
  });

  it('gives the clearance subset refusal the generic access wording', async () => {
    expect(await msg('not allowed to file a clearance form for this employee')).toBe('accessAboveYours');
  });

  it('still maps the other SQL refusals to the generic message', async () => {
    expect(await msg('not allowed to set roles')).toBe('notAllowed');
    expect(await msg('unknown role')).toBe('unknownRole');
    expect(await msg('you cannot appoint yourself department manager')).toBe('cannotAppointSelfManager');
  });
});

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

describe('fieldForDbError FR-55 roles screens', () => {
  it('puts role-name refusals under the name input', () => {
    expect(fieldForDbError('role name already used')).toBe('role_name');
    expect(fieldForDbError('invalid role name')).toBe('role_name');
    expect(
      fieldForDbError('duplicate key value violates unique constraint "roles_company_name_uniq"')
    ).toBe('role_name');
  });

  it('puts the transfer refusals under their inputs', () => {
    expect(fieldForDbError('personnel number does not match an active employee')).toBe('personnel_no');
    expect(fieldForDbError('wrong password')).toBe('password');
  });

  it('maps the index race to the same message as the pre-check', async () => {
    expect((await dbErr('duplicate key value violates unique constraint "roles_company_name_uniq"')).error).toBe('roleNameUsed');
  });
});
