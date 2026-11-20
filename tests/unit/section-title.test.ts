import { describe, expect, it } from 'vitest';
import { sectionFor } from '@/lib/nav/sectionFor';

describe('sectionFor', () => {
  it('maps a record page to the ERP list', () =>
    expect(sectionFor('/sales/8f1c0000-0000-4000-8000-000000000000')).toEqual({ href: '/sales', key: 'erp' }));
  it('keeps the longest match', () =>
    expect(sectionFor('/manage/approval-steps/x')).toEqual({ href: '/manage/approval-steps', key: 'approvalSteps' }));
  it('exact root', () => expect(sectionFor('/home')).toEqual({ href: '/home', key: 'home' }));
  it('no match', () => expect(sectionFor('/zz-preview')).toBeNull());
  it('no false prefix', () => expect(sectionFor('/salesx')).toBeNull());
});
