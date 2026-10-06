/**
 * Pure approval-chain logic (FR-36). No Supabase, no I/O — unit-tested.
 *
 * MIRRORS the step-selection in `public.approve_leave_request`
 * (supabase/migrations/20260818160003_approval_chain_engine.sql, department
 * step since 20261005120003_department_manager_step.sql). The database
 * is authoritative at runtime and re-checks everything; this exists so the
 * approvals queue can show a person only what they can actually act on, and so
 * the rules can be tested exhaustively rather than hand-checked in psql.
 *
 * The two must stay in lockstep. If you change one, change the other.
 */

/**
 * `employee` is only ever valid on a step that names a PERSON (FR-42) — a CHECK
 * constraint enforces that, because "anyone who is an employee may approve" is
 * every colleague in the company.
 */
export type StepRole = 'manager' | 'hr' | 'security' | 'admin' | 'employee';
export type RequestKind = 'leave' | 'errand';

/**
 * Which manager a `manager` step means (FR-47). `direct` = the requester's own
 * manager (`profiles.manager_id` — their supervisor if they have one);
 * `department` = the manager of the requester's department
 * (`departments.manager_id`). Absent means `direct`, as on every step written
 * before 2026-10-05.
 */
export type ManagerScope = 'direct' | 'department';

/** What a step is called on screen: its role, or the department manager. */
export type StepLabel = StepRole | 'departmentManager';

export type ApprovalStep = {
  id: string;
  role: StepRole;
  stepOrder: number;
  appliesTo: RequestKind[];
  active: boolean;
  /** FR-42: when set, ONLY this person may fill the step. */
  approverId?: string | null;
  /** FR-47: only meaningful on a `manager` step with no named approver. */
  managerScope?: ManagerScope;
};

const isDepartmentStep = (step: ApprovalStep) =>
  step.role === 'manager' && step.managerScope === 'department' && !step.approverId;

export function stepLabel(step: ApprovalStep): StepLabel {
  return isDepartmentStep(step) ? 'departmentManager' : step.role;
}

/**
 * Whether the department-manager step is required for one requester. Mirrors
 * `private.department_step_applies`: only when the department has an ACTIVE
 * manager who is neither the requester nor the requester's direct manager — the
 * direct manager already signs, and nobody signs their own request. An inactive
 * department manager skips the step rather than blocking it forever.
 */
export function departmentStepApplies(input: {
  employeeId: string;
  employeeManagerId: string | null;
  departmentManagerId: string | null;
  departmentManagerActive: boolean;
}): boolean {
  const { employeeId, employeeManagerId, departmentManagerId, departmentManagerActive } = input;
  return (
    !!departmentManagerId &&
    departmentManagerActive &&
    departmentManagerId !== employeeId &&
    departmentManagerId !== employeeManagerId
  );
}

export type SignedStep = {
  /** FR-42: which step this decision filled. Null for rows written before FR-42. */
  stepId?: string | null;
  stepRole: StepRole;
  decision: 'approved' | 'rejected';
};

/**
 * Whether a recorded decision fills a given step.
 *
 * Keys on the STEP, falling back to the role only for evidence written before
 * FR-42. Several named people may share one role, and a role-only test would let
 * the first of them to sign complete a step the others never filled. Mirrors the
 * SQL's `a.step_id = s.id or (a.step_id is null and a.step_role = s.role)`.
 */
function fills(signed: SignedStep, step: ApprovalStep): boolean {
  if (signed.stepId) return signed.stepId === step.id;
  return signed.stepRole === step.role;
}

export type FillableInput = {
  steps: ApprovalStep[];
  /** Decisions already recorded against this request. */
  signed: SignedStep[];
  kind: RequestKind;
  callerRoles: string[];
  /** Whether the caller is this requester's own direct manager. */
  isDirectManager: boolean;
  /** FR-47: whether the caller is the manager of the requester's department. */
  isDepartmentManager?: boolean;
  /** FR-47: `departmentStepApplies(...)` for this requester. Default false. */
  departmentStepApplies?: boolean;
  /** Whether the caller IS the requester. */
  isSelf: boolean;
  orderEnforced: boolean;
  /** The caller's own profile id — needed to match a step that names a person. */
  callerId?: string | null;
};

/**
 * Active steps that apply to this request kind, in order. A department step is
 * kept only when it applies to this requester (FR-47) — mirrors
 * `private.step_applies` in every step query of the SQL.
 */
export function applicableSteps(
  steps: ApprovalStep[],
  kind: RequestKind,
  departmentApplies = false
): ApprovalStep[] {
  return steps
    .filter((s) => s.active && s.appliesTo.includes(kind) && (!isDepartmentStep(s) || departmentApplies))
    // `id` is a third tiebreak the SQL does not have — it orders by
    // (step_order, role) and resolves a remaining tie arbitrarily. That cannot
    // change WHICH step a given caller fills: two steps tied on order and role
    // are both person-steps, and a caller is entitled to at most one of them.
    // The extra key only makes this list stable to render.
    .sort(
      (a, b) =>
        a.stepOrder - b.stepOrder ||
        a.role.localeCompare(b.role) ||
        a.id.localeCompare(b.id)
    );
}

/**
 * The step this caller may sign right now, or null.
 *
 * Order of checks matches the SQL exactly:
 *   1. no configured steps at all  -> degrade to a single manager/admin decision
 *   2. skip steps already decided
 *   3. entitlement: a step naming a PERSON is fillable only by them, with NO
 *      admin override (FR-42 — naming someone means that signature specifically
 *      is required); otherwise admin fills any, `manager` needs the DIRECT
 *      manager rather than merely someone holding the role, and any other role
 *      needs that role
 *   4. nobody but an admin signs their own request
 *   5. when the order binds, refuse a step with an unapproved lower-ordered one
 *   6. lowest step_order wins
 */
export function fillableStep(input: FillableInput): ApprovalStep | null {
  const { steps, signed, kind, callerRoles, isDirectManager, isSelf, orderEnforced, callerId } =
    input;
  const isAdmin = callerRoles.includes('admin');
  const applicable = applicableSteps(steps, kind, input.departmentStepApplies ?? false);

  // 1. Configuration emptied: exactly today's pre-chain behaviour. The synthetic
  //    step has no row behind it, which is why its id is empty — the SQL takes
  //    the same branch and inserts evidence with a NULL step_id.
  if (applicable.length === 0) {
    return isDirectManager || isAdmin
      ? { id: '', role: 'manager', stepOrder: 1, appliesTo: [kind], active: true }
      : null;
  }

  // 4. Self-approval is an admin-only escape hatch (see the SQL's rationale:
  //    an admin with no manager above them must still be able to take leave).
  if (isSelf && !isAdmin) return null;

  const isDecided = (step: ApprovalStep) => signed.some((d) => fills(d, step));
  const isApproved = (step: ApprovalStep) =>
    signed.some((d) => d.decision === 'approved' && fills(d, step));

  const canFill = (step: ApprovalStep) => {
    // FR-42: a named step admits exactly one person, and an admin is not an
    // exception. Deactivation is handled by the database, which additionally
    // requires the caller to be active — unreachable here, since an inactive
    // account cannot reach any authenticated screen.
    if (step.approverId) return !!callerId && step.approverId === callerId;
    if (isAdmin) return true;
    if (isDepartmentStep(step)) return input.isDepartmentManager ?? false;
    if (step.role === 'manager') return isDirectManager;
    return callerRoles.includes(step.role);
  };

  for (const step of applicable) {
    if (isDecided(step)) continue;
    if (!canFill(step)) continue;
    if (orderEnforced) {
      const earlierOutstanding = applicable.some(
        (s) => s.stepOrder < step.stepOrder && !isApproved(s)
      );
      if (earlierOutstanding) continue;
    }
    return step;
  }
  return null;
}

/** Steps still waiting on someone, for the "who is left" line in the queue. */
export function outstandingSteps(
  steps: ApprovalStep[],
  signed: SignedStep[],
  kind: RequestKind,
  departmentApplies = false
): StepLabel[] {
  return applicableSteps(steps, kind, departmentApplies)
    .filter((s) => !signed.some((d) => d.decision === 'approved' && fills(d, s)))
    .map(stepLabel);
}

/**
 * Narrows the approvals queue to requests the caller can act on **now**.
 *
 * Replaces the pre-chain version, which was "admin sees all, manager sees their
 * own reports". That is no longer sufficient: an HR user has no reports at all,
 * and a manager who has already signed should not keep seeing the request.
 */
export function filterApprovable<
  T extends {
    kind: RequestKind;
    employee_manager_id: string | null;
    employee_id: string;
    /** FR-47: manager of the requester's department, and whether that step applies. */
    employee_department_manager_id?: string | null;
    department_step_applies?: boolean;
    signed: SignedStep[];
  },
>(
  rows: T[],
  myProfileId: string,
  callerRoles: string[],
  steps: ApprovalStep[],
  orderEnforced: boolean
): T[] {
  return rows.filter(
    (r) =>
      fillableStep({
        steps,
        signed: r.signed,
        kind: r.kind,
        callerRoles,
        isDirectManager: r.employee_manager_id === myProfileId,
        isDepartmentManager: r.employee_department_manager_id === myProfileId,
        departmentStepApplies: r.department_step_applies ?? false,
        isSelf: r.employee_id === myProfileId,
        orderEnforced,
        callerId: myProfileId,
      }) !== null
  );
}
