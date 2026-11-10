import { describe, expect, it } from 'vitest';
import {
  isOpenRequest,
  printReplacementStatus,
  replacementCanAnswer,
  replacementNoteProblem,
  requesterMustChooseReplacement,
} from '@/lib/leave/replacementSignoff';

describe('FR-88 replacement sign-off', () => {
  it('treats pending and approved requests as open', () => {
    expect(isOpenRequest('pending')).toBe(true);
    expect(isOpenRequest('approved')).toBe(true);
    expect(isOpenRequest('rejected')).toBe(false);
    expect(isOpenRequest('cancelled')).toBe(false);
  });

  it('lets the replacement answer only a pending sign-off on an open request', () => {
    expect(replacementCanAnswer({ status: 'pending', signoffStatus: 'pending' })).toBe(true);
    // Any moment: an approved request can still be signed.
    expect(replacementCanAnswer({ status: 'approved', signoffStatus: 'pending' })).toBe(true);
    expect(replacementCanAnswer({ status: 'pending', signoffStatus: 'signed' })).toBe(false);
    expect(replacementCanAnswer({ status: 'pending', signoffStatus: 'declined' })).toBe(false);
    expect(replacementCanAnswer({ status: 'cancelled', signoffStatus: 'pending' })).toBe(false);
    expect(replacementCanAnswer({ status: 'pending', signoffStatus: null })).toBe(false);
  });

  it('asks the requester to choose again only after a decline on an open request', () => {
    expect(requesterMustChooseReplacement({ status: 'pending', signoffStatus: 'declined' })).toBe(true);
    expect(requesterMustChooseReplacement({ status: 'approved', signoffStatus: 'declined' })).toBe(true);
    expect(requesterMustChooseReplacement({ status: 'rejected', signoffStatus: 'declined' })).toBe(false);
    expect(requesterMustChooseReplacement({ status: 'pending', signoffStatus: 'pending' })).toBe(false);
    expect(requesterMustChooseReplacement({ status: 'pending', signoffStatus: undefined })).toBe(false);
  });

  it('gives the print form a status only when a replacement is named', () => {
    expect(printReplacementStatus(null, null)).toBeNull();
    expect(printReplacementStatus('', 'signed')).toBeNull();
    expect(printReplacementStatus('Ali', 'signed')).toBe('signed');
    expect(printReplacementStatus('Ali', 'declined')).toBe('declined');
    // Filed before FR-88: nobody was asked, so the box stays blank.
    expect(printReplacementStatus('Ali', null)).toBe('pending');
  });

  it('limits the decline note to 500 characters after trimming', () => {
    expect(replacementNoteProblem(undefined)).toBeNull();
    expect(replacementNoteProblem(`  ${'x'.repeat(500)}  `)).toBeNull();
    expect(replacementNoteProblem('x'.repeat(501))).toBe('note is too long (max 500 characters)');
  });
});
