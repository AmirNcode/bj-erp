import { describe, it, expect } from 'vitest';
import {
  applicableSteps,
  fillableStep,
  outstandingSteps,
  chainComplete,
  filterApprovable,
  type ApprovalStep,
  type SignedStep,
} from '@/lib/leave/approvals';

/** The seeded chain: manager (1) then hr (2), both kinds. */
const STEPS: ApprovalStep[] = [
  { id: 'manager-1', role: 'manager', stepOrder: 1, appliesTo: ['leave', 'errand'], active: true },
  { id: 'hr-2', role: 'hr', stepOrder: 2, appliesTo: ['leave', 'errand'], active: true },
];

const base = {
  steps: STEPS,
  signed: [] as SignedStep[],
  kind: 'leave' as const,
  callerRoles: [] as string[],
  isDirectManager: false,
  isSelf: false,
  orderEnforced: false,
};

describe('applicableSteps', () => {
  it('drops inactive steps and steps that do not apply to the kind', () => {
    const steps: ApprovalStep[] = [
      { id: 'manager-1', role: 'manager', stepOrder: 1, appliesTo: ['leave', 'errand'], active: true },
      { id: 'hr-2', role: 'hr', stepOrder: 2, appliesTo: ['leave'], active: true },
      { id: 'security-3', role: 'security', stepOrder: 3, appliesTo: ['errand'], active: false },
    ];
    expect(applicableSteps(steps, 'errand').map((s) => s.role)).toEqual(['manager']);
    expect(applicableSteps(steps, 'leave').map((s) => s.role)).toEqual(['manager', 'hr']);
  });

  it('orders by step_order', () => {
    const steps: ApprovalStep[] = [
      { id: 'hr-5', role: 'hr', stepOrder: 5, appliesTo: ['leave'], active: true },
      { id: 'manager-2', role: 'manager', stepOrder: 2, appliesTo: ['leave'], active: true },
    ];
    expect(applicableSteps(steps, 'leave').map((s) => s.role)).toEqual(['manager', 'hr']);
  });
});

describe('fillableStep — entitlement', () => {
  it('the direct manager fills the manager step', () => {
    expect(fillableStep({ ...base, isDirectManager: true, callerRoles: ['manager'] })?.role).toBe('manager');
  });

  it('holding the manager role is NOT enough — it must be THIS employee’s manager', () => {
    // Otherwise any manager in the company could approve anyone, contradicting
    // FR-17's broad-read / narrow-write rule.
    expect(fillableStep({ ...base, isDirectManager: false, callerRoles: ['manager'] })).toBeNull();
  });

  it('an hr user fills the hr step', () => {
    expect(fillableStep({ ...base, callerRoles: ['hr'] })?.role).toBe('hr');
  });

  it('an admin fills the lowest outstanding step', () => {
    expect(fillableStep({ ...base, callerRoles: ['admin'] })?.role).toBe('manager');
    expect(
      fillableStep({
        ...base,
        callerRoles: ['admin'],
        signed: [{ stepRole: 'manager', decision: 'approved' }],
      })?.role
    ).toBe('hr');
  });

  it('a plain employee fills nothing', () => {
    expect(fillableStep({ ...base, callerRoles: ['employee'] })).toBeNull();
  });

  it('security does not fill an hr or manager step', () => {
    expect(fillableStep({ ...base, callerRoles: ['security'] })).toBeNull();
  });
});

describe('fillableStep — already decided', () => {
  it('skips a step that is already signed', () => {
    expect(
      fillableStep({
        ...base,
        callerRoles: ['manager'],
        isDirectManager: true,
        signed: [{ stepRole: 'manager', decision: 'approved' }],
      })
    ).toBeNull();
  });

  it('a rejected step also counts as decided', () => {
    expect(
      fillableStep({
        ...base,
        callerRoles: ['hr'],
        signed: [{ stepRole: 'hr', decision: 'rejected' }],
      })
    ).toBeNull();
  });

  it('someone holding both roles fills the other step after signing one', () => {
    expect(
      fillableStep({
        ...base,
        callerRoles: ['hr', 'manager'],
        isDirectManager: true,
        signed: [{ stepRole: 'manager', decision: 'approved' }],
      })?.role
    ).toBe('hr');
  });
});

describe('fillableStep — self-approval', () => {
  it('a non-admin never signs their own request', () => {
    // The first HR officer to book leave must not sign their own HR step.
    expect(fillableStep({ ...base, callerRoles: ['hr'], isSelf: true })).toBeNull();
    expect(
      fillableStep({ ...base, callerRoles: ['manager'], isDirectManager: true, isSelf: true })
    ).toBeNull();
  });

  it('an admin still can — deliberately, so a company’s only admin is not stuck', () => {
    expect(fillableStep({ ...base, callerRoles: ['admin'], isSelf: true })?.role).toBe('manager');
  });
});

describe('fillableStep — order enforcement', () => {
  it('off by default: hr may go first', () => {
    expect(fillableStep({ ...base, callerRoles: ['hr'] })?.role).toBe('hr');
  });

  it('on: hr must wait for the manager', () => {
    expect(fillableStep({ ...base, callerRoles: ['hr'], orderEnforced: true })).toBeNull();
  });

  it('on: the manager may still go first', () => {
    expect(
      fillableStep({ ...base, callerRoles: ['manager'], isDirectManager: true, orderEnforced: true })?.role
    ).toBe('manager');
  });

  it('on: hr may sign once the manager has', () => {
    expect(
      fillableStep({
        ...base,
        callerRoles: ['hr'],
        orderEnforced: true,
        signed: [{ stepRole: 'manager', decision: 'approved' }],
      })?.role
    ).toBe('hr');
  });

  it('on: a REJECTED earlier step does not unblock the later one', () => {
    expect(
      fillableStep({
        ...base,
        callerRoles: ['hr'],
        orderEnforced: true,
        signed: [{ stepRole: 'manager', decision: 'rejected' }],
      })
    ).toBeNull();
  });
});

describe('fillableStep — no configured steps', () => {
  const none = { ...base, steps: [] as ApprovalStep[] };

  it('degrades to a single manager-or-admin decision rather than wedging', () => {
    expect(fillableStep({ ...none, isDirectManager: true })?.role).toBe('manager');
    expect(fillableStep({ ...none, callerRoles: ['admin'] })?.role).toBe('manager');
  });

  it('still refuses everyone else', () => {
    expect(fillableStep({ ...none, callerRoles: ['hr'] })).toBeNull();
    expect(fillableStep({ ...none, callerRoles: ['employee'] })).toBeNull();
  });

  it('treats all-inactive steps the same as none', () => {
    const inactive = STEPS.map((s) => ({ ...s, active: false }));
    expect(fillableStep({ ...base, steps: inactive, callerRoles: ['hr'] })).toBeNull();
    expect(fillableStep({ ...base, steps: inactive, isDirectManager: true })?.role).toBe('manager');
  });
});

describe('outstandingSteps / chainComplete', () => {
  it('lists who is still needed', () => {
    expect(outstandingSteps(STEPS, [], 'leave')).toEqual(['manager', 'hr']);
    expect(outstandingSteps(STEPS, [{ stepRole: 'manager', decision: 'approved' }], 'leave')).toEqual([
      'hr',
    ]);
  });

  it('a rejection does not satisfy a step', () => {
    expect(outstandingSteps(STEPS, [{ stepRole: 'hr', decision: 'rejected' }], 'leave')).toEqual([
      'manager',
      'hr',
    ]);
  });

  it('complete only when every applicable step approved', () => {
    expect(chainComplete(STEPS, [], 'leave')).toBe(false);
    expect(chainComplete(STEPS, [{ stepRole: 'manager', decision: 'approved' }], 'leave')).toBe(false);
    expect(
      chainComplete(
        STEPS,
        [
          { stepRole: 'manager', decision: 'approved' },
          { stepRole: 'hr', decision: 'approved' },
        ],
        'leave'
      )
    ).toBe(true);
  });

  it('a kind with no applicable steps is trivially complete', () => {
    const leaveOnly: ApprovalStep[] = [
      { id: 'manager-1', role: 'manager', stepOrder: 1, appliesTo: ['leave'], active: true },
    ];
    expect(chainComplete(leaveOnly, [], 'errand')).toBe(true);
  });
});

describe('filterApprovable', () => {
  const rows = [
    { id: 'a', kind: 'leave' as const, employee_manager_id: 'M', employee_id: 'E1', signed: [] },
    {
      id: 'b',
      kind: 'leave' as const,
      employee_manager_id: 'OTHER',
      employee_id: 'E2',
      signed: [] as SignedStep[],
    },
    {
      id: 'c',
      kind: 'leave' as const,
      employee_manager_id: 'M',
      employee_id: 'E3',
      signed: [{ stepRole: 'manager' as const, decision: 'approved' as const }],
    },
  ];

  it('a manager sees only their own reports, and only what they have not signed', () => {
    expect(filterApprovable(rows, 'M', ['manager'], STEPS, false).map((r) => r.id)).toEqual(['a']);
  });

  it('hr sees every request still needing an hr signature', () => {
    expect(filterApprovable(rows, 'H', ['hr'], STEPS, false).map((r) => r.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('with the order enforced, hr sees only what the manager has already signed', () => {
    expect(filterApprovable(rows, 'H', ['hr'], STEPS, true).map((r) => r.id)).toEqual(['c']);
  });

  it('an admin sees everything outstanding', () => {
    expect(filterApprovable(rows, 'A', ['admin'], STEPS, false).map((r) => r.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('a plain employee sees nothing', () => {
    expect(filterApprovable(rows, 'E1', ['employee'], STEPS, false)).toEqual([]);
  });

  it('a manager with no reports sees nothing', () => {
    // Ported from the superseded tests/unit/approvals.test.ts.
    expect(filterApprovable(rows, 'NOBODY', ['manager'], STEPS, false)).toEqual([]);
  });

  it('does not treat a null manager_id as a match for a real id', () => {
    // Ported from the superseded tests/unit/approvals.test.ts. `null === 'M'` is
    // false in JS, but an `==` or a truthiness check here would leak rows.
    const orphan = [
      { id: 'n', kind: 'leave' as const, employee_manager_id: null, employee_id: 'E9', signed: [] },
    ];
    expect(filterApprovable(orphan, 'M', ['manager'], STEPS, false)).toEqual([]);
  });

  it('nobody is offered their own request', () => {
    const own = [
      { id: 'x', kind: 'leave' as const, employee_manager_id: 'M', employee_id: 'H', signed: [] },
    ];
    expect(filterApprovable(own, 'H', ['hr'], STEPS, false)).toEqual([]);
  });
});

// ── FR-42: a step reserved for one named person ─────────────────────────────
//
// Every expectation here was verified first against the LIVE engine
// (public.approve_leave_request) in rolled-back transactions — a named approver
// holding no role signed their step; an admin filling the chain got the MANAGER
// step and could not complete it alone; a deactivated approver was refused.
describe('named-person steps (FR-42)', () => {
  const NAMED = 'person-uuid-1';
  const OTHER = 'person-uuid-2';

  const STEPS_WITH_PERSON: ApprovalStep[] = [
    { id: 'mgr', role: 'manager', stepOrder: 1, appliesTo: ['leave', 'errand'], active: true },
    {
      id: 'named',
      role: 'employee',
      stepOrder: 2,
      appliesTo: ['leave', 'errand'],
      active: true,
      approverId: NAMED,
    },
  ];

  const withPerson = {
    steps: STEPS_WITH_PERSON,
    signed: [] as SignedStep[],
    kind: 'leave' as const,
    callerRoles: [] as string[],
    isDirectManager: false,
    isSelf: false,
    orderEnforced: false,
  };

  it('the named person fills their step even holding no role at all', () => {
    expect(fillableStep({ ...withPerson, callerId: NAMED })?.id).toBe('named');
  });

  it('somebody else with the same role cannot fill it', () => {
    // The step's role is `employee`, which everyone effectively is. Only the
    // named id opens it.
    expect(
      fillableStep({ ...withPerson, callerId: OTHER, callerRoles: ['employee'] })
    ).toBeNull();
  });

  it('an ADMIN cannot fill a named step — they get the manager step instead', () => {
    // The decisive guarantee: naming a person means that signature specifically
    // is required, so there is no admin override. Matches the live engine, where
    // an admin signing this chain filled `manager`.
    expect(fillableStep({ ...withPerson, callerId: OTHER, callerRoles: ['admin'] })?.id).toBe(
      'mgr'
    );
  });

  it('an admin cannot complete the chain alone', () => {
    const afterAdmin: SignedStep[] = [
      { stepId: 'mgr', stepRole: 'manager', decision: 'approved' },
    ];
    expect(
      fillableStep({ ...withPerson, signed: afterAdmin, callerId: OTHER, callerRoles: ['admin'] })
    ).toBeNull();
    // ...and the chain is still outstanding on the named step.
    expect(outstandingSteps(STEPS_WITH_PERSON, afterAdmin, 'leave')).toEqual(['employee']);
    expect(chainComplete(STEPS_WITH_PERSON, afterAdmin, 'leave')).toBe(false);
  });

  it('the named person cannot sign twice', () => {
    const signed: SignedStep[] = [
      { stepId: 'named', stepRole: 'employee', decision: 'approved' },
    ];
    expect(fillableStep({ ...withPerson, signed, callerId: NAMED })).toBeNull();
  });

  it('completes once both the manager and the named person have signed', () => {
    const signed: SignedStep[] = [
      { stepId: 'mgr', stepRole: 'manager', decision: 'approved' },
      { stepId: 'named', stepRole: 'employee', decision: 'approved' },
    ];
    expect(chainComplete(STEPS_WITH_PERSON, signed, 'leave')).toBe(true);
    expect(outstandingSteps(STEPS_WITH_PERSON, signed, 'leave')).toEqual([]);
  });

  it('a named person may not sign their OWN request', () => {
    expect(fillableStep({ ...withPerson, callerId: NAMED, isSelf: true })).toBeNull();
  });

  it('two named people sharing a role each keep their own slot', () => {
    // This is why evidence keys on the STEP: under the old role-only test the
    // first signature would have completed BOTH steps.
    const twoPeople: ApprovalStep[] = [
      { id: 'a', role: 'employee', stepOrder: 1, appliesTo: ['leave'], active: true, approverId: NAMED },
      { id: 'b', role: 'employee', stepOrder: 2, appliesTo: ['leave'], active: true, approverId: OTHER },
    ];
    const firstSigned: SignedStep[] = [
      { stepId: 'a', stepRole: 'employee', decision: 'approved' },
    ];
    expect(chainComplete(twoPeople, firstSigned, 'leave')).toBe(false);
    expect(
      fillableStep({ ...withPerson, steps: twoPeople, signed: firstSigned, callerId: OTHER })?.id
    ).toBe('b');
    // And the one who already signed is done.
    expect(
      fillableStep({ ...withPerson, steps: twoPeople, signed: firstSigned, callerId: NAMED })
    ).toBeNull();
  });

  it('evidence written before FR-42 still matches its step by role', () => {
    // Backfilled rows carry no stepId. They must still count, or a historical
    // request would look unsigned and be re-signable.
    const legacy: SignedStep[] = [{ stepRole: 'manager', decision: 'approved' }];
    expect(outstandingSteps(STEPS_WITH_PERSON, legacy, 'leave')).toEqual(['employee']);
    expect(
      fillableStep({ ...withPerson, signed: legacy, callerId: OTHER, callerRoles: ['admin'] })
    ).toBeNull();
  });

  it('order enforcement still binds a named step', () => {
    expect(
      fillableStep({ ...withPerson, callerId: NAMED, orderEnforced: true })
    ).toBeNull();
    const afterManager: SignedStep[] = [
      { stepId: 'mgr', stepRole: 'manager', decision: 'approved' },
    ];
    expect(
      fillableStep({ ...withPerson, signed: afterManager, callerId: NAMED, orderEnforced: true })
        ?.id
    ).toBe('named');
  });
});
