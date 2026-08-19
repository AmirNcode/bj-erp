/**
 * Which of the client's paper forms a stored request corresponds to, and which
 * signature boxes that form prints (FR-38).
 *
 * Pure — no I/O, no i18n. Labels are message keys the caller resolves, so this
 * module stays testable and carries no translation dependency.
 *
 * The three forms, photographed in `docs/forms/`:
 *
 *   BJ-F 50210(R0)  فرم درخواست مرخصی روزانه   daily leave
 *   BJ-F 50208(R0)  فرم درخواست مرخصی ساعتی    hourly leave
 *   BJ-F 50207(R0)  فرم درخواست ماموریت ساعتی  hourly work errand
 *
 * Note 50210: the repo's own docs never recorded that code — FR-26 names 50208
 * for hourly leave and FR-30 names 50207 for the errand, but the daily leave
 * form was only ever referred to by name. Read off the photograph, 2026-08-18.
 *
 * The signature boxes are NOT the same set on each form, which is why they are
 * listed per form rather than assumed:
 *
 *   50210: requester · replacement · approver · hrManager
 *   50208: requester · approver · security · adminOffice
 *   50207: requester · approver · security · hrOffice
 *
 * The app currently captures only two of them — the requester's and the
 * approver's (FR-32, FR-14). The rest print as empty boxes for a wet signature,
 * which is exactly what HR needs while the chain in FR-36 is still being built,
 * and they fill themselves once it lands.
 */

export type RequestKind = 'leave' | 'errand';
export type LeaveUnit = 'day' | 'hour';

export type SignatureBox =
  /** درخواست کننده — filled from `signature_data`. */
  | 'requester'
  /** جانشین — the app stores the person's NAME but never their signature. */
  | 'replacement'
  /** تصویب کننده — filled from `approver_signature_data`. */
  | 'approver'
  /** حراست — not captured by the app; blank for a wet signature. */
  | 'security'
  /** مدیر اداری و منابع انسانی — blank until FR-36 makes HR an approval step. */
  | 'hrManager'
  /** امور اداری — blank, as above. */
  | 'adminOffice'
  /** امور اداری و منابع انسانی — blank, as above. */
  | 'hrOffice';

export type PaperForm = {
  /** Message key under `print.forms.*` for the printed title. */
  titleKey: 'dailyLeave' | 'hourlyLeave' | 'hourlyErrand' | 'dailyErrand';
  /** The کد فرم printed top-right, or null when the client has no such form. */
  code: string | null;
  /** Printed left-to-right here; the RTL layout reverses them visually. */
  boxes: SignatureBox[];
  /**
   * True when this layout is inferred rather than copied from a photographed
   * form, so the UI can be honest about it instead of implying an official
   * document exists.
   */
  derived: boolean;
};

const DAILY_LEAVE: PaperForm = {
  titleKey: 'dailyLeave',
  code: 'BJ-F 50210(R0)',
  boxes: ['requester', 'replacement', 'approver', 'hrManager'],
  derived: false,
};

const HOURLY_LEAVE: PaperForm = {
  titleKey: 'hourlyLeave',
  code: 'BJ-F 50208(R0)',
  boxes: ['requester', 'approver', 'security', 'adminOffice'],
  derived: false,
};

const HOURLY_ERRAND: PaperForm = {
  titleKey: 'hourlyErrand',
  code: 'BJ-F 50207(R0)',
  boxes: ['requester', 'approver', 'security', 'hrOffice'],
  derived: false,
};

/**
 * The daily work errand was added on 2026-08-05 at the client's request and we
 * have no photograph of a paper original — it may not exist.
 *
 * It reuses 50207's code and box set deliberately: the database already numbers
 * daily and hourly errands from ONE serial sequence (DATA_MODEL, the kind-keyed
 * counter), i.e. the client keeps a single errand book. `derived` is true so the
 * screen can say so rather than quietly asserting an official form.
 */
const DAILY_ERRAND: PaperForm = {
  titleKey: 'dailyErrand',
  code: 'BJ-F 50207(R0)',
  boxes: ['requester', 'approver', 'security', 'hrOffice'],
  derived: true,
};

export function paperFormFor(kind: RequestKind, unit: LeaveUnit): PaperForm {
  if (kind === 'errand') return unit === 'hour' ? HOURLY_ERRAND : DAILY_ERRAND;
  return unit === 'hour' ? HOURLY_LEAVE : DAILY_LEAVE;
}

/**
 * Which stored signature fills a given box, if any.
 *
 * Since FR-36 the approver boxes are backed by the approval CHAIN rather than a
 * single approver column, so each box maps to the step role that signs it:
 *
 *   تصویب کننده                  -> the `manager` step
 *   حراست                        -> the `security` step (configurable, unseeded)
 *   مدیر اداری/امور اداری/…       -> the `hr` step
 *
 * جانشین has no source at all: the app records who the replacement IS but never
 * captures their signature, so that box always prints blank for a wet one.
 *
 * Returning null is a normal outcome, not a gap to code around.
 */
export type SignatureSource =
  | { kind: 'requester' }
  | { kind: 'step'; role: 'manager' | 'hr' | 'security' };

export function signatureSourceFor(box: SignatureBox): SignatureSource | null {
  switch (box) {
    case 'requester':
      return { kind: 'requester' };
    case 'approver':
      return { kind: 'step', role: 'manager' };
    case 'security':
      return { kind: 'step', role: 'security' };
    case 'hrManager':
    case 'adminOffice':
    case 'hrOffice':
      return { kind: 'step', role: 'hr' };
    case 'replacement':
      return null;
  }
}

/**
 * The leave-type checkboxes printed on BJ-F 50210 (استحقاقی / استعلاجی /
 * بدون حقوق). Matched on the stored English name, falling back to the Farsi one,
 * because `leave_types` rows are company data an admin can rename.
 *
 * An unrecognised type ticks nothing rather than guessing — a wrong tick on a
 * signed document is worse than an empty one, and the type's own name is printed
 * beside the boxes regardless.
 */
export function leaveTypeCheckbox(
  nameEn: string | null,
  nameFa: string | null
): 'annual' | 'sick' | 'unpaid' | null {
  const haystack = `${nameEn ?? ''} ${nameFa ?? ''}`.toLowerCase();
  if (/annual|استحقاقی/.test(haystack)) return 'annual';
  if (/sick|استعلاجی|بیمار/.test(haystack)) return 'sick';
  if (/unpaid|بدون حقوق/.test(haystack)) return 'unpaid';
  return null;
}
