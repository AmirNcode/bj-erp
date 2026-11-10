import { describe, it, expect } from 'vitest';
import { paperFormFor, leaveTypeCheckbox, stepBoxes, type PrintStep } from '@/lib/leave/paperForm';

describe('paperFormFor', () => {
  it('maps each stored request shape to the right paper form', () => {
    expect(paperFormFor('leave', 'day').code).toBe('BJ-F 50210(R0)');
    expect(paperFormFor('leave', 'hour').code).toBe('BJ-F 50208(R0)');
    expect(paperFormFor('errand', 'hour').code).toBe('BJ-F 50207(R0)');
  });

  it('titles each one distinctly', () => {
    const keys = (['leave', 'errand'] as const).flatMap((k) =>
      (['day', 'hour'] as const).map((u) => paperFormFor(k, u).titleKey)
    );
    expect(new Set(keys).size).toBe(4);
  });

  it('marks the daily errand as derived, and nothing else', () => {
    expect(paperFormFor('errand', 'day').derived).toBe(true);
    expect(paperFormFor('errand', 'hour').derived).toBe(false);
    expect(paperFormFor('leave', 'day').derived).toBe(false);
    expect(paperFormFor('leave', 'hour').derived).toBe(false);
  });

  it('only the daily leave form has a replacement (جانشین) box', () => {
    expect(paperFormFor('leave', 'day').replacementBox).toBe(true);
    expect(paperFormFor('leave', 'hour').replacementBox).toBe(false);
    expect(paperFormFor('errand', 'day').replacementBox).toBe(false);
    expect(paperFormFor('errand', 'hour').replacementBox).toBe(false);
  });
});

describe('stepBoxes', () => {
  const steps: PrintStep[] = [
    { stepId: 'office', stepOrder: 3, boxLabel: 'امور اداری' },
    { stepId: 'direct', stepOrder: 1, boxLabel: 'تصویب کننده' },
    { stepId: 'dept', stepOrder: 2, boxLabel: 'مدیر واحد' },
  ];
  type A = { stepId: string | null; stepOrder?: number; boxLabel?: string | null; decision: string | null };

  it('prints one box per step, in step order, titled with the box name', () => {
    const approvals: A[] = [
      { stepId: 'direct', stepOrder: 1, boxLabel: 'تصویب کننده', decision: 'approved' },
      { stepId: 'dept', stepOrder: 2, boxLabel: 'مدیر واحد', decision: null },
      { stepId: 'office', stepOrder: 3, boxLabel: 'امور اداری', decision: null },
    ];
    const boxes = stepBoxes(steps, approvals, 'pending');
    expect(boxes.map((b) => b.key)).toEqual(['direct', 'dept', 'office']);
    expect(boxes.map((b) => b.title)).toEqual(['تصویب کننده', 'مدیر واحد', 'امور اداری']);
    expect(boxes.every((b) => !b.notRequired)).toBe(true);
    expect(boxes[1].approval?.decision).toBeNull(); // pending: an empty box, not hidden
  });

  it('marks a step the pending request skipped as not required', () => {
    // The department manager is the direct manager: the server owes no such step.
    const approvals: A[] = [
      { stepId: 'direct', stepOrder: 1, decision: null },
      { stepId: 'office', stepOrder: 3, decision: null },
    ];
    const dept = stepBoxes(steps, approvals, 'pending').find((b) => b.key === 'dept');
    expect(dept).toMatchObject({ approval: null, notRequired: true, title: 'مدیر واحد' });
  });

  it('marks a missing step on an approved request as not required too', () => {
    const boxes = stepBoxes(steps, [{ stepId: 'direct', decision: 'approved' }], 'approved');
    expect(boxes.filter((b) => b.notRequired).map((b) => b.key)).toEqual(['dept', 'office']);
  });

  it('leaves a never-signed step on a rejected request as an empty box', () => {
    const boxes = stepBoxes(steps, [{ stepId: 'direct', decision: 'rejected' }], 'rejected');
    expect(boxes.filter((b) => b.notRequired)).toHaveLength(0);
  });

  it('keeps the title a signature was given, after the box is renamed', () => {
    const boxes = stepBoxes(
      [{ stepId: 'direct', stepOrder: 1, boxLabel: 'Renamed' }],
      [{ stepId: 'direct', boxLabel: 'تصویب کننده', decision: 'approved' }],
      'approved'
    );
    expect(boxes[0].title).toBe('تصویب کننده');
  });

  it('still prints signatures whose step was removed, and legacy ones, at the end', () => {
    const boxes = stepBoxes(
      [{ stepId: 'direct', stepOrder: 1, boxLabel: 'تصویب کننده' }],
      [
        { stepId: null, stepOrder: 1, decision: 'approved' },
        { stepId: 'gone', stepOrder: 2, boxLabel: 'حراست', decision: 'approved' },
        { stepId: 'direct', stepOrder: 1, decision: 'approved' },
      ],
      'approved'
    );
    expect(boxes.map((b) => [b.key, b.title])).toEqual([
      ['direct', 'تصویب کننده'],
      ['legacy-0', null],
      ['gone', 'حراست'],
    ]);
  });
});

describe('leaveTypeCheckbox', () => {
  it('recognises the three printed types in either language', () => {
    expect(leaveTypeCheckbox('Annual Leave', 'مرخصی استحقاقی')).toBe('annual');
    expect(leaveTypeCheckbox('Sick Leave', 'مرخصی استعلاجی')).toBe('sick');
    expect(leaveTypeCheckbox('Unpaid Leave', 'مرخصی بدون حقوق')).toBe('unpaid');
  });

  it('works from the Farsi name alone', () => {
    expect(leaveTypeCheckbox(null, 'مرخصی استحقاقی')).toBe('annual');
    expect(leaveTypeCheckbox(null, 'مرخصی بدون حقوق')).toBe('unpaid');
  });

  it('ticks nothing for a type it does not recognise', () => {
    // Leave types are admin-editable company data. A wrong tick on a signed
    // document is worse than none, and the type name prints beside the boxes.
    expect(leaveTypeCheckbox('Study Leave', 'مرخصی تحصیلی')).toBeNull();
    expect(leaveTypeCheckbox(null, null)).toBeNull();
    expect(leaveTypeCheckbox('', '')).toBeNull();
  });

  it('is case-insensitive on the English name', () => {
    expect(leaveTypeCheckbox('ANNUAL LEAVE', null)).toBe('annual');
  });
});
