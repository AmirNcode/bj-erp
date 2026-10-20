import { describe, expect, it } from 'vitest';
import { perDiemProblem, signatureProblem } from '@/lib/leave/signature';

// Smallest string isValidSignatureData accepts: PNG data-URL prefix, length >= 100, length % 4 === 2.
const VALID = 'data:image/png;base64,iVBORw0KGgo' + 'A'.repeat(100 - 33 + 2);

describe('signatureProblem', () => {
  it('accepts an authorized, well-formed signature', () => {
    expect(VALID.length % 4).toBe(2);
    expect(signatureProblem({ signatureData: VALID, signatureAuthorized: true })).toBeNull();
  });

  it('reports the authorization box before a missing drawing', () => {
    expect(signatureProblem({ signatureData: '', signatureAuthorized: false })).toBe(
      'signature authorization is required'
    );
  });

  it('reports a missing then a malformed drawing', () => {
    expect(signatureProblem({ signatureData: '', signatureAuthorized: true })).toBe('signature is required');
    expect(signatureProblem({ signatureData: 'data:image/png;base64,xx', signatureAuthorized: true })).toBe(
      'signature data is invalid'
    );
  });
});

describe('perDiemProblem', () => {
  it('accepts no amount or whole Rials of 0 or more', () => {
    expect(perDiemProblem(undefined)).toBeNull();
    expect(perDiemProblem(null)).toBeNull();
    expect(perDiemProblem(0)).toBeNull();
    expect(perDiemProblem(1_500_000)).toBeNull();
  });

  it('refuses negative, fractional and unsafe amounts', () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
      expect(perDiemProblem(bad)).toBe('per diem must be 0 or more');
    }
  });
});
