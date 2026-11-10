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
 * Signature boxes (spec 2026-11-09-form-signature-boxes-design): every form
 * prints the requester's box first and, on the daily leave form only, the
 * replacement's box (جانشین). Every other box is an APPROVAL STEP the admin
 * configures on Manage › Approval steps, titled with the box name they typed,
 * in step order — see `stepBoxes`.
 */

export type RequestKind = 'leave' | 'errand';
export type LeaveUnit = 'day' | 'hour';

export type PaperForm = {
  /** Message key under `print.forms.*` for the printed title. */
  titleKey: 'dailyLeave' | 'hourlyLeave' | 'hourlyErrand' | 'dailyErrand';
  /** The کد فرم printed top-right, or null when the client has no such form. */
  code: string | null;
  /** Daily leave only: the form names a replacement (جانشین), who signs too. */
  replacementBox: boolean;
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
  replacementBox: true,
  derived: false,
};

const HOURLY_LEAVE: PaperForm = {
  titleKey: 'hourlyLeave',
  code: 'BJ-F 50208(R0)',
  replacementBox: false,
  derived: false,
};

const HOURLY_ERRAND: PaperForm = {
  titleKey: 'hourlyErrand',
  code: 'BJ-F 50207(R0)',
  replacementBox: false,
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
  replacementBox: false,
  derived: true,
};

export function paperFormFor(kind: RequestKind, unit: LeaveUnit): PaperForm {
  if (kind === 'errand') return unit === 'hour' ? HOURLY_ERRAND : DAILY_ERRAND;
  return unit === 'hour' ? HOURLY_LEAVE : DAILY_LEAVE;
}

/** One active approval step of the company, as the print payload lists it. */
export type PrintStep = {
  stepId: string;
  stepOrder: number;
  boxLabel: string | null;
};

/** The parts of an approval (signed, pending or exempt) the box layout needs. */
export type BoxApproval = {
  stepId?: string | null;
  stepOrder?: number;
  boxLabel?: string | null;
};

export type StepBox<A extends BoxApproval> = {
  /** Stable key: the step id, or `legacy-<n>` for a pre-chain approval. */
  key: string;
  /** The box name; null falls back to the approval's role label. */
  title: string | null;
  /** The request's approval for this box — signed, pending, rejected or exempt. */
  approval: A | null;
  /** The step does not apply to this request (e.g. a skipped department manager). */
  notRequired: boolean;
};

/**
 * The approval-step boxes of one printed request, after the fixed requester
 * (and replacement) boxes.
 *
 *  - one box per active step for the request's kind, in step order;
 *  - a step the request has no approval row for: on a pending request the
 *    server lists every step still owed, so a missing one does not apply to
 *    this request ("Not required"), and likewise on an approved one; on a
 *    rejected or cancelled request it was simply never signed (empty box);
 *  - approvals whose step is gone or inactive (and pre-chain ones) still print,
 *    in their own boxes at the end, titled with the name snapshot at signing.
 *
 * A signed box keeps the title it was signed under (`approval.boxLabel`).
 */
export function stepBoxes<A extends BoxApproval>(
  steps: PrintStep[],
  approvals: A[],
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
): StepBox<A>[] {
  const ordered = [...steps].sort((a, b) => a.stepOrder - b.stepOrder);
  const used = new Set<A>();
  const boxes: StepBox<A>[] = ordered.map((step) => {
    const approval = approvals.find((a) => a.stepId === step.stepId) ?? null;
    if (approval) used.add(approval);
    return {
      key: step.stepId,
      title: approval?.boxLabel ?? step.boxLabel,
      approval,
      notRequired: !approval && (status === 'pending' || status === 'approved'),
    };
  });
  const rest = approvals
    .filter((a) => !used.has(a))
    .sort((a, b) => (a.stepOrder ?? 0) - (b.stepOrder ?? 0));
  rest.forEach((a, i) =>
    boxes.push({ key: a.stepId ?? `legacy-${i}`, title: a.boxLabel ?? null, approval: a, notRequired: false })
  );
  return boxes;
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
