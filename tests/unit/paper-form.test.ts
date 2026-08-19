import { describe, it, expect } from 'vitest';
import {
  paperFormFor,
  signatureSourceFor,
  leaveTypeCheckbox,
  type SignatureBox,
} from '@/lib/leave/paperForm';

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

  it('gives the daily leave form its own box set, with جانشین and no حراست', () => {
    // Read off docs/forms/daily_pto_form.jpeg. The hourly forms differ, which is
    // exactly why boxes are per-form rather than one shared list.
    expect(paperFormFor('leave', 'day').boxes).toEqual([
      'requester',
      'replacement',
      'approver',
      'hrManager',
    ]);
  });

  it('gives the hourly forms a حراست box and no جانشین', () => {
    for (const form of [paperFormFor('leave', 'hour'), paperFormFor('errand', 'hour')]) {
      expect(form.boxes).toContain('security');
      expect(form.boxes).not.toContain('replacement');
    }
  });

  it('every form prints exactly four boxes, as the paper does', () => {
    for (const k of ['leave', 'errand'] as const) {
      for (const u of ['day', 'hour'] as const) {
        expect(paperFormFor(k, u).boxes).toHaveLength(4);
      }
    }
  });

  it('every form starts with the requester and includes the approver', () => {
    for (const k of ['leave', 'errand'] as const) {
      for (const u of ['day', 'hour'] as const) {
        const { boxes } = paperFormFor(k, u);
        expect(boxes[0]).toBe('requester');
        expect(boxes).toContain('approver');
        expect(new Set(boxes).size).toBe(boxes.length); // no duplicates
      }
    }
  });
});

describe('signatureSourceFor', () => {
  it('maps the requester box to the request’s own signature', () => {
    expect(signatureSourceFor('requester')).toEqual({ kind: 'requester' });
  });

  it('maps تصویب کننده to the manager step', () => {
    expect(signatureSourceFor('approver')).toEqual({ kind: 'step', role: 'manager' });
  });

  it('maps every HR-flavoured box to the one hr step', () => {
    // Three different printed labels across the three forms, one step.
    for (const box of ['hrManager', 'adminOffice', 'hrOffice'] as SignatureBox[]) {
      expect(signatureSourceFor(box)).toEqual({ kind: 'step', role: 'hr' });
    }
  });

  it('maps حراست to the security step, which is configurable but unseeded', () => {
    expect(signatureSourceFor('security')).toEqual({ kind: 'step', role: 'security' });
  });

  it('leaves جانشین without a source — the app never captures that signature', () => {
    expect(signatureSourceFor('replacement')).toBeNull();
  });

  it('every box on every form resolves without throwing', () => {
    for (const k of ['leave', 'errand'] as const) {
      for (const u of ['day', 'hour'] as const) {
        for (const box of paperFormFor(k, u).boxes) {
          expect(() => signatureSourceFor(box)).not.toThrow();
        }
      }
    }
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
