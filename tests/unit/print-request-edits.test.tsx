import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import messages from '@/messages/en.json';
import PrintRequestPage from '@/app/[locale]/(print)/print/request/[id]/page';
import { formatCalendarDate } from '@/lib/leave/calendarMonth';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), caller: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/auth/context', () => ({ requireCaller: mocks.caller }));
vi.mock('@/lib/errors/db-error', () => ({ dbErr: async (error: string) => ({ ok: false, error }) }));
vi.mock('next-intl/server', () => ({
  setRequestLocale: vi.fn(),
  getTranslations: async (namespace: 'print') => createTranslator({ locale: 'en', messages, namespace }),
}));
vi.mock('@/lib/actions/leave/reference', () => ({ getWorkSettings: async () => ({ ok: true, settings: { hoursPerDay: 8 } }) }));
vi.mock('@/app/[locale]/(print)/print/request/[id]/PrintToolbar', () => ({ PrintToolbar: () => null }));

const d = (iso: string) => formatCalendarDate(iso, 'en');
const base = {
  id: 'r', employee_name: 'Requester', status: 'approved', leave_type_id: null, leave_type_name_fa: null, leave_type_name_en: null,
  created_at: '2027-02-20T07:00:00Z', signature_consent_at: '2027-02-20T07:00:00Z', current_balance_minutes: null,
  serial_year: 1405, serial_seq: 1, day_part: 'full', start_time: null, end_time: null, per_diem_rials: null,
};
const fix = (over: object) => ({
  old_start_date: '2027-03-01', new_start_date: '2027-03-01', old_end_date: '2027-03-03', new_end_date: '2027-03-03',
  per_diem_before: null, per_diem_after: null, reason: 'edit reason', corrected_by_name: 'HR', corrected_at: '2027-03-05T10:00:00Z',
  old_unit: 'day', new_unit: 'day', old_day_part: 'full', new_day_part: 'full',
  old_start_time: null, new_start_time: null, old_end_time: null, new_end_time: null, minutes_before: 1440, minutes_after: 1440,
  ...over,
});

function serve(context: object, corrections: object[], extensions: object[] = []) {
  mocks.rpc.mockResolvedValue({
    data: { context: { ...base, ...context }, signatures: { requester_signature_data: null, approvals: [], steps: [] }, extensions, corrections },
    error: null,
  });
}
const renderPage = async () => render(await PrintRequestPage({ params: Promise.resolve({ locale: 'en', id: 'r' }) }));

beforeEach(() => {
  cleanup(); vi.clearAllMocks();
  mocks.caller.mockResolvedValue({ ok: true, supabase: { rpc: mocks.rpc, from: mocks.from } });
});

describe('printed edits (FR-91)', () => {
  it('a shortened daily leave prints the signed dates and duration, then one edit line', async () => {
    serve(
      { kind: 'leave', unit: 'day', start_date: '2027-03-01', end_date: '2027-03-02', requested_minutes: 960 },
      [fix({ new_end_date: '2027-03-02', minutes_after: 960 })]
    );
    await renderPage();
    const body = screen.getByTestId('print-body-leave').textContent ?? '';
    expect(body).toContain(d('2027-03-03'));
    expect(body).toContain('3 days');
    expect(body).not.toContain('2 days');
    const lines = screen.getAllByTestId('print-correction');
    expect(lines).toHaveLength(1);
    expect(lines[0].textContent).toContain('Edited to');
    expect(lines[0].textContent).toContain(d('2027-03-02'));
    expect(lines[0].textContent).toContain('edit reason');
    expect(screen.queryByTestId('print-signed-original')).toBeNull();
  });

  it('a daily leave edited to hourly prints on the hourly form with the signed original in its own line', async () => {
    serve(
      { kind: 'leave', unit: 'hour', start_date: '2027-03-01', end_date: '2027-03-01', start_time: '09:00:00', end_time: '11:00:00', requested_minutes: 120 },
      [fix({ new_unit: 'hour', new_end_date: '2027-03-01', new_start_time: '09:00:00', new_end_time: '11:00:00', minutes_after: 120 })]
    );
    await renderPage();
    expect(screen.getByTestId('print-form').getAttribute('data-form-code')).toBe('BJ-F 50208(R0)');
    expect(screen.getByTestId('print-body-leave').textContent).toContain('09:00');
    const signed = screen.getByTestId('print-signed-original').textContent ?? '';
    expect(signed).toContain('Signed as');
    expect(signed).toContain(d('2027-03-03'));
    expect(signed).toContain('3 days');
    expect(screen.getAllByTestId('print-correction')).toHaveLength(1);
  });

  it('an hourly errand edit prints the signed times and an edit line', async () => {
    serve(
      { kind: 'errand', unit: 'hour', start_date: '2027-03-01', end_date: '2027-03-01', start_time: '10:00:00', end_time: '12:00:00', requested_minutes: 120, errand_location: 'Plant' },
      [fix({ old_unit: 'hour', new_unit: 'hour', old_end_date: '2027-03-01', old_start_time: '09:00:00', old_end_time: '10:00:00', new_start_time: '10:00:00', new_end_time: '12:00:00', minutes_before: 60, minutes_after: 120 })]
    );
    await renderPage();
    const body = screen.getByTestId('print-body-errand').textContent ?? '';
    expect(body).toContain('From time : 09:00To time : 10:00');
    const lines = screen.getAllByTestId('print-correction');
    expect(lines).toHaveLength(1);
    expect(lines[0].textContent).toContain('10:00–12:00');
  });

  it('a trip with an extension and an edit keeps the signed dates and today\'s order of lines', async () => {
    serve(
      { kind: 'errand', unit: 'day', start_date: '2027-03-01', end_date: '2027-03-06', requested_minutes: 2880, errand_location: 'Shiraz' },
      [fix({ old_end_date: '2027-03-05', new_end_date: '2027-03-06', corrected_at: '2027-03-08T10:00:00Z', reason: 'trip fix', minutes_before: null, minutes_after: null })],
      [{ old_end_date: '2027-03-03', new_end_date: '2027-03-05', reason: 'extended', status: 'approved', decided_at: '2027-03-04T10:00:00Z' }]
    );
    await renderPage();
    const body = screen.getByTestId('print-body-errand').textContent ?? '';
    expect(body).toContain(d('2027-03-03'));
    const ext = screen.getByTestId('print-extension');
    const fixLine = screen.getByTestId('print-correction');
    expect(ext.textContent).toContain('extended');
    expect(fixLine.textContent).toContain('trip fix');
    expect(ext.compareDocumentPosition(fixLine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a legacy correction row without the FR-91 columns still prints', async () => {
    serve(
      { kind: 'errand', unit: 'day', start_date: '2027-03-01', end_date: '2027-03-05', requested_minutes: 2400, errand_location: 'Shiraz' },
      [{
        old_start_date: '2027-03-01', new_start_date: '2027-03-01', old_end_date: '2027-03-03', new_end_date: '2027-03-05',
        per_diem_before: null, per_diem_after: null, reason: 'legacy fix', corrected_by_name: 'HR', corrected_at: '2027-03-02T10:00:00Z',
      }]
    );
    await renderPage();
    expect(screen.getByTestId('print-body-errand').textContent).toContain(d('2027-03-03'));
    expect(screen.getByTestId('print-correction').textContent).toContain('legacy fix');
  });
});
