/**
 * Maps raw Postgres/PostgREST error messages (stable English strings raised by
 * our SECURITY DEFINER functions, plus constraint violations) to localized
 * fa/en user-facing messages. Server-only — call from server actions.
 *
 * Unknown errors are logged server-side and replaced with a generic message so
 * internals never leak to the UI. If translation itself fails (no request
 * locale), the raw message is returned as a last resort.
 */

import { getTranslations } from 'next-intl/server';

type Rule = {
  re: RegExp;
  key: string;
  params?: (m: RegExpMatchArray) => Record<string, string | number>;
};

const RULES: Rule[] = [
  {
    // The minute-contract migrations retained the legacy "day(s)" word in
    // some SQL messages, but both numeric values are now minutes.
    re: /insufficient balance: ([\d.]+) (?:day|minute)\(s\) requested, ([\d.]+) available/,
    key: 'insufficientBalanceMinutes',
    params: (m) => ({ requested: m[1], available: m[2] }),
  },
  { re: /account is inactive/i, key: 'accountInactive' },
  { re: /employee not found/i, key: 'employeeNotFound' },
  { re: /select between 1 and 100 employees/i, key: 'employeeSelectionLimit' },
  { re: /invalid work hours or hourly leave cap/i, key: 'invalidHourlySettings' },
  { re: /holiday not found/i, key: 'holidayNotFound' },
  { re: /overlapping approved leave exists/, key: 'overlapApproved' },
  { re: /overlapping leave request exists/, key: 'overlap' },
  { re: /requested days must be greater than 0/, key: 'zeroDays' },
  { re: /invalid or inactive leave type/, key: 'invalidLeaveType' },
  { re: /date range too long/, key: 'rangeTooLong' },
  { re: /start and end dates are required/, key: 'datesRequired' },
  { re: /signature authorization is required/, key: 'signatureAuthorizationRequired' },
  { re: /signature is required/, key: 'signatureRequired' },
  { re: /signature data is invalid/, key: 'signatureInvalid' },
  { re: /request signature not found/, key: 'signatureNotFound' },
  { re: /request was already decided/, key: 'alreadyDecided' },
  { re: /only pending requests can be/, key: 'onlyPending' },
  { re: /only pending or not-yet-started approved requests/, key: 'cannotCancel' },
  { re: /request not found/, key: 'requestNotFound' },
  { re: /current password is incorrect/, key: 'wrongCurrentPassword' },
  { re: /new password must be at least 8 characters/, key: 'passwordTooShort' },
  { re: /new password must be at most 72 ASCII characters/, key: 'passwordTooLong' },
  { re: /invalid employee code/, key: 'invalidEmployeeCode' },
  { re: /employee code already exists/, key: 'duplicateEmployeeCode' },
  { re: /duplicate key value.*profiles_employee_code/, key: 'duplicateEmployeeCode' },
  { re: /duplicate key value.*holidays_company_date/, key: 'duplicateHoliday' },
  { re: /duplicate key value.*departments_company_code_key/, key: 'duplicateDepartmentCode' },
  // createDepartment auto-generates the code and retries a bounded number of
  // times; exhausting them means every candidate was taken.
  { re: /could not generate a unique department code/, key: 'duplicateDepartmentCode' },
  { re: /invalid department code|departments_code_format/, key: 'invalidDepartmentCode' },
  { re: /department name is required/, key: 'departmentNameRequired' },
  { re: /cannot remove your own admin role/, key: 'cannotRemoveOwnAdmin' },
  { re: /cannot deactivate the last active admin/, key: 'cannotDeactivateLastAdmin' },
  { re: /employee cannot be their own manager|profiles_manager_not_self/i, key: 'managerCannotBeSelf' },
  { re: /no profile for caller/, key: 'noProfile' },
  { re: /allocation days must be greater than 0/, key: 'allocationInvalid' },
  { re: /this leave type cannot be taken hourly/, key: 'hourlyNotAllowed' },
  { re: /end time must be after start time/, key: 'endBeforeStart' },
  { re: /times must fall within working hours/, key: 'outsideWorkHours' },
  { re: /hourly leave exceeds the daily limit/, key: 'hourlyDailyLimit' },
  // Errand (FR-30). The form validates both client-side first, so these only
  // surface when the DB is reached directly or the client check is bypassed.
  { re: /errand location is required/, key: 'errandLocationRequired' },
  { re: /errand location is too long/, key: 'errandLocationTooLong' },
  // Should be unreachable — the serial index is keyed by kind since
  // 20260730130001. Mapped anyway: when it DID fire, the worker saw only the
  // generic "unexpected error" and had nothing to report.
  { re: /duplicate key value.*leave_requests_serial_uniq/, key: 'serialCollision' },
  { re: /replacement must be an active colleague in your department/, key: 'replacementNotColleague' },
  { re: /replacement is on leave during this period/, key: 'replacementAway' },
  { re: /target balance must be >= 0/, key: 'balanceNegative' },
  { re: /at least one working day is required/i, key: 'allWeekWeekend' },
  { re: /invalid weekend days/i, key: 'invalidWeekend' },
  { re: /holiday date and farsi name are required/i, key: 'holidayFieldsRequired' },
  { re: /not allowed to|only admins can|not permitted|admin role required|admin or manager role required/i, key: 'notAllowed' },
  { re: /not authenticated/i, key: 'notAuthenticated' },
];

export async function localizeDbError(raw: string): Promise<string> {
  let t: Awaited<ReturnType<typeof getTranslations>>;
  try {
    t = await getTranslations('dbErrors');
  } catch {
    return raw;
  }
  for (const rule of RULES) {
    const m = raw.match(rule.re);
    if (m) return t(rule.key, rule.params?.(m));
  }
  console.error('[db-error] unmapped:', raw);
  return t('unexpected');
}

/** Shorthand for action error results: `return dbErr(error.message)`. */
export async function dbErr(raw: string): Promise<{ ok: false; error: string }> {
  return { ok: false as const, error: await localizeDbError(raw) };
}
