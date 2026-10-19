import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createTranslator, NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/en.json';
import farsiMessages from '@/messages/fa.json';
import { approvalChoices, type ApprovalProgressRow } from '@/lib/leave/approval-context';
import { getRequestForPrint } from '@/lib/actions/leave/review';
import { getRequestSignature } from '@/lib/actions/leave/signatures';
import { RequestProgress } from '@/components/RequestProgress';
import PrintRequestPage from '@/app/[locale]/(print)/print/request/[id]/page';
import { formatPersianConsentTimestamp } from '@/lib/i18n/format';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), caller: vi.fn(), progress: vi.fn(), from: vi.fn(), locale: 'en' }));
vi.mock('@/lib/auth/context', () => ({ requireCaller: mocks.caller }));
vi.mock('@/lib/actions/leave/progress', () => ({ getRequestProgress: mocks.progress }));
vi.mock('@/lib/errors/db-error', () => ({ dbErr: async (error: string) => ({ ok: false, error }) }));
vi.mock('next-intl/server', () => ({
  setRequestLocale: vi.fn(),
  getTranslations: async (namespace: 'print') => createTranslator({
    locale: mocks.locale, messages: mocks.locale === 'fa' ? farsiMessages : messages, namespace,
  }),
}));
vi.mock('@/lib/actions/leave/reference', () => ({ getWorkSettings: async () => ({ ok: true, settings: { hoursPerDay: 8 } }) }));
vi.mock('@/app/[locale]/(print)/print/request/[id]/PrintToolbar', () => ({ PrintToolbar: () => null }));

const step: ApprovalProgressRow = {
  step_id: 'direct', step_role: 'manager', step_order: 1, manager_scope: 'direct', named: false,
  expected_name: 'CEO', signer_name: null, principal_name: 'CEO', signed_at: null, decision: null,
  evidence_kind: 'pending', grant_id: 'authority', can_approve: true, can_reject: true,
  is_delegated: true, per_diem_allowed: false,
};

beforeEach(() => {
  cleanup(); vi.clearAllMocks();
  mocks.locale = 'en';
  mocks.caller.mockResolvedValue({ ok: true, supabase: { rpc: mocks.rpc, from: mocks.from } });
});

describe('printed approval evidence', () => {
  const context = {
    id: 'r', kind: 'leave', unit: 'day', status: 'approved', employee_name: 'Requester',
    leave_type_id: null, leave_type_name_fa: null, leave_type_name_en: null,
    start_date: '2026-10-20', end_date: '2026-10-20', requested_minutes: 480,
    created_at: '2026-10-20T07:00:00Z', signature_consent_at: '2026-10-20T07:00:00Z',
    current_balance_minutes: null, serial_year: 1405, serial_seq: 1,
  };
  const submittedAt = '2026-10-20T07:00:00Z';
  const processedAt = '2026-10-20T09:03:00Z';
  const recordedStatement = 'Historical explicit CEO authority statement retained verbatim.';
  const automatic = {
    ...step, decision: 'approved', evidence_kind: 'automatic', signed_at: processedAt,
    authority_ref: 'historical-grant', statement: recordedStatement, signature_data: 'must-not-print',
    evidence: { delegate_name: 'Historical delegate', submitted_at: submittedAt, consent_at: submittedAt },
  };
  function serve(approvals: object[]) {
    mocks.rpc.mockImplementation(async (name: string) => name === 'app_request_approval_context'
      ? { data: context, error: null }
      : { data: { requester_signature_data: null, approvals }, error: null });
  }

  it('preserves exact identities and step order for multiple signed steps with the same role', async () => {
    serve([
      { ...step, decision: 'approved', signer_name: 'Direct signer' },
      { ...step, step_id: 'named', step_order: 2, named: true, expected_name: 'Named CEO', decision: 'approved', signer_name: 'Named signer' },
      { ...step, step_id: 'department', step_order: 3, manager_scope: 'department', decision: 'approved', signer_name: 'Department signer' },
    ]);
    render(await PrintRequestPage({ params: Promise.resolve({ locale: 'en', id: 'r' }) }));
    expect(screen.getByText('Step 1: Direct manager')).toBeTruthy();
    expect(screen.getByText('Step 2: Named CEO')).toBeTruthy();
    expect(screen.getByText('Step 3: Department manager')).toBeTruthy();
    expect(document.querySelector('[data-approval-step-id="named"]')).toBeTruthy();
    expect(document.querySelector('[data-approval-step-id="department"]')).toBeTruthy();
  });

  it.each(['en', 'fa'])('prints immutable automatic authority, identity and separate timestamps in %s', async (locale) => {
    mocks.locale = locale;
    serve([automatic]);
    const result = await getRequestForPrint('r');
    expect(result).toMatchObject({ ok: true, request: { approvals: [{
      authorityStatement: recordedStatement, delegateName: 'Historical delegate',
      submittedAt, responsibilityConsentAt: submittedAt, signatureConsentAt: processedAt, signatureData: null,
    }] } });
    render(await PrintRequestPage({ params: Promise.resolve({ locale, id: 'r' }) }));
    expect(screen.getByText(recordedStatement)).toBeTruthy();
    expect(screen.getByText(/Historical delegate/)).toBeTruthy();
    expect(screen.getByText(/historical-grant/)).toBeTruthy();
    const content = screen.getByTestId('print-box-approver').textContent ?? '';
    const labels = locale === 'fa' ? farsiMessages.approvalEvidence : messages.approvalEvidence;
    expect(content).toContain(labels.submittedAt.split('{at}')[0]);
    expect(content).toContain(labels.automaticallyApprovedAt.split('{at}')[0]);
    expect(content).toContain(formatPersianConsentTimestamp(submittedAt, locale));
    expect(content).toContain(formatPersianConsentTimestamp(processedAt, locale));
    expect(screen.queryByTestId('print-signature-approver')).toBeNull();
  });
});

describe('approval evidence boundaries', () => {
  it('keeps direct, department and named same-role steps separately selectable', () => {
    const choices = approvalChoices([step,
      { ...step, step_id: 'department', manager_scope: 'department' },
      { ...step, step_id: 'named', named: true, expected_name: 'Named signer' },
      { ...step, step_id: 'exempt', evidence_kind: 'hr_exempt' },
      { ...step, step_id: 'done', decision: 'approved' },
      { ...step, step_id: 'forbidden', can_approve: false },
    ], 'approve');
    expect(choices.map((s) => s.stepId)).toEqual(['direct', 'department', 'named']);
    expect(choices.map((s) => s.label)).toEqual(['manager', 'departmentManager', 'manager']);
    expect(choices[2].name).toBe('Named signer');
    expect(choices[0]).toMatchObject({ delegated: true, principalName: 'CEO', perDiem: false });
  });

  it('prints only scoped context and evidence and suppresses any PNG attached to automatic or exempt evidence', async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === 'app_request_approval_context'
      ? { data: { id: 'r', leave_type_id: null }, error: null }
      : { data: { requester_signature_data: 'requester', approvals: [
        { ...step, evidence_kind: 'automatic', decision: 'approved', signature_data: 'must-not-print', signed_at: '2026-10-20T09:00:00Z' },
        { ...step, step_id: 'hr', evidence_kind: 'hr_exempt', signature_data: 'must-not-print' },
        { ...step, step_id: 'other', evidence_kind: 'delegated', decision: 'approved', signer_name: 'Delegate', signature_data: 'actual-signature' },
      ] }, error: null });
    const result = await getRequestForPrint('r');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.approvals.map((a) => a.signatureData)).toEqual([null, null, 'actual-signature']);
    expect(result.request.approvals[0]).toMatchObject({ stepId: 'direct', authorityRef: 'authority', principalName: 'CEO' });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.calls.map((args) => args[0])).toEqual(['app_request_approval_context', 'get_leave_request_signatures']);
  });

  it('fails closed when the scoped signature projection denies access', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'request not found' } });
    expect(await getRequestSignature('other-company')).toEqual({ ok: false, error: 'request not found' });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('renders automatic responsibility, authority reference and HR exemption without inventing a signer', async () => {
    mocks.progress.mockResolvedValue({ ok: true, steps: [
      { stepId: 'ceo', order: 1, label: 'manager', named: false, expectedName: 'CEO', decision: 'approved', signerName: null,
        signedAt: '2026-10-20T09:00:00Z', principalName: 'CEO', authorityRef: 'grant-123', evidenceKind: 'automatic' },
      { stepId: 'hr', order: 2, label: 'hr', named: false, expectedName: null, decision: null, signerName: null,
        signedAt: null, principalName: null, authorityRef: null, evidenceKind: 'hr_exempt' },
    ] });
    render(<NextIntlClientProvider locale="en" messages={messages}><RequestProgress requestId="r" defaultOpen /></NextIntlClientProvider>);
    expect(await screen.findByText(/requester accepted responsibility/)).toBeTruthy();
    expect(screen.getByText(/Authority reference: grant-123/)).toBeTruthy();
    expect(screen.getByText(/Not required — request submitted by the Head of HR/)).toBeTruthy();
    expect(screen.queryByText('Approved by —')).toBeNull();
  });
});
