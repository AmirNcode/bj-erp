import { describe, expect, it } from 'vitest';
import { marriageOffer } from '@/lib/employees/specialLeave';

describe('marriageOffer (FR-65, R3 ruling on concern 3)', () => {
  it('single: offered with the normal hint', () => {
    expect(marriageOffer({ granted: false, maritalStatus: 'single' })).toEqual({ enabled: true, hint: 'marriageHint' });
  });
  it('readable and not single (married, or left empty): disabled with the not-single hint', () => {
    expect(marriageOffer({ granted: false, maritalStatus: 'married' })).toEqual({ enabled: false, hint: 'marriageNotSingle' });
    expect(marriageOffer({ granted: false, maritalStatus: null })).toEqual({ enabled: false, hint: 'marriageNotSingle' });
  });
  it('unreadable (no personal_info read): offered; the RPC refuses a non-single target itself', () => {
    expect(marriageOffer({ granted: false, maritalStatus: undefined })).toEqual({ enabled: true, hint: 'marriageHint' });
  });
  it('already granted: enabled so it can be unticked, whatever the status says', () => {
    expect(marriageOffer({ granted: true, maritalStatus: 'married' })).toEqual({ enabled: true, hint: 'grantedOn' });
    expect(marriageOffer({ granted: true, maritalStatus: undefined })).toEqual({ enabled: true, hint: 'grantedOn' });
  });
});
