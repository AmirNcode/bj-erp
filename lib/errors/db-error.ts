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
    re: /insufficient balance: ([\d.]+) day\(s\) requested, ([\d.]+) available/,
    key: 'insufficientBalance',
    params: (m) => ({ requested: m[1], available: m[2] }),
  },
  { re: /overlapping approved leave exists/, key: 'overlapApproved' },
  { re: /overlapping leave request exists/, key: 'overlap' },
  { re: /requested days must be greater than 0/, key: 'zeroDays' },
  { re: /invalid or inactive leave type/, key: 'invalidLeaveType' },
  { re: /date range too long/, key: 'rangeTooLong' },
  { re: /start and end dates are required/, key: 'datesRequired' },
  { re: /request was already decided/, key: 'alreadyDecided' },
  { re: /only pending requests can be/, key: 'onlyPending' },
  { re: /only pending or not-yet-started approved requests/, key: 'cannotCancel' },
  { re: /request not found/, key: 'requestNotFound' },
  { re: /current password is incorrect/, key: 'wrongCurrentPassword' },
  { re: /new password must be at least 8 characters/, key: 'passwordTooShort' },
  { re: /invalid employee code/, key: 'invalidEmployeeCode' },
  { re: /employee code already exists/, key: 'duplicateEmployeeCode' },
  { re: /duplicate key value.*profiles_employee_code/, key: 'duplicateEmployeeCode' },
  { re: /duplicate key value.*holidays_company_date/, key: 'duplicateHoliday' },
  { re: /cannot remove your own admin role/, key: 'cannotRemoveOwnAdmin' },
  { re: /no profile for caller/, key: 'noProfile' },
  { re: /allocation days must be greater than 0/, key: 'allocationInvalid' },
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
