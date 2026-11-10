import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { RequestProgress } from '@/components/RequestProgress';

const mocks = vi.hoisted(() => ({ progress: vi.fn() }));
vi.mock('@/lib/actions/leave/progress', () => ({ getRequestProgress: mocks.progress }));
afterEach(cleanup);

describe('RequestProgress: trip extensions (FR-70)', () => {
  it('lists each extension with its status and reason under the steps', async () => {
    mocks.progress.mockResolvedValue({
      ok: true, steps: [],
      extensions: [
        { old_end_date: '2027-03-03', new_end_date: '2027-03-05', reason: 'More inspections', status: 'approved', evidence: 'manual', requested_by_name: 'Mgr', decided_by_name: 'HR', decided_at: '2027-03-02T08:00:00Z' },
        { old_end_date: '2027-03-05', new_end_date: '2027-03-06', reason: 'Client asked', status: 'pending', evidence: null, requested_by_name: 'Mgr', decided_by_name: null, decided_at: null },
      ],
    });
    render(<NextIntlClientProvider locale="en" messages={en}><RequestProgress requestId="r1" defaultOpen /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByTestId('progress-extensions-r1')).toBeTruthy());
    const text = screen.getByTestId('progress-extensions-r1').textContent ?? '';
    expect(text).toContain('More inspections');
    expect(text).toContain('Approved');
    expect(text).toContain('Waiting for HR');
  });

  it('lists each correction with its reason', async () => {
    mocks.progress.mockResolvedValue({
      ok: true, steps: [], extensions: [],
      corrections: [{
        old_start_date: '2027-03-01', new_start_date: '2027-03-01', old_end_date: '2027-03-03',
        new_end_date: '2027-03-05', per_diem_before: null, per_diem_after: 2500000,
        reason: 'Wrong dates on the form', corrected_by_name: 'Fixture HR', corrected_at: '2027-03-02T10:00:00Z',
        old_unit: 'day', new_unit: 'day', old_day_part: 'full', new_day_part: 'full',
        old_start_time: null, new_start_time: null, old_end_time: null, new_end_time: null, minutes_before: 960, minutes_after: 1920,
      }],
    });
    render(<NextIntlClientProvider locale="en" messages={en}><RequestProgress requestId="r3" hoursPerDay={8} defaultOpen /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByTestId('progress-corrections-r3')).toBeTruthy());
    const text = screen.getByTestId('progress-corrections-r3').textContent ?? '';
    expect(text).toContain('Edits');
    expect(text).toContain('→');
    expect(text).toContain('2 days');
    expect(text).toContain('4 days');
    expect(text).toContain('Wrong dates on the form');
    expect(text).toContain('Edited by Fixture HR on');
    expect(text).toContain('2,500,000');
  });

  it('shows an hourly edit of a leave as old and new values, with legacy rows beside it', async () => {
    mocks.progress.mockResolvedValue({
      ok: true, steps: [], extensions: [],
      corrections: [
        {
          old_start_date: '2027-03-01', new_start_date: '2027-03-01', old_end_date: '2027-03-01', new_end_date: '2027-03-01',
          per_diem_before: null, per_diem_after: null, reason: 'Left early', corrected_by_name: null, corrected_at: '2027-03-02T10:00:00Z',
          old_unit: 'day', new_unit: 'hour', old_day_part: 'full', new_day_part: 'full',
          old_start_time: null, new_start_time: '09:00:00', old_end_time: null, new_end_time: '11:00:00', minutes_before: 480, minutes_after: 120,
        },
        // Written before FR-91: trip dates only, no unit or minutes columns.
        {
          old_start_date: '2027-03-01', new_start_date: '2027-03-01', old_end_date: '2027-03-03', new_end_date: '2027-03-04',
          per_diem_before: null, per_diem_after: null, reason: 'Legacy fix', corrected_by_name: 'HR', corrected_at: '2027-03-01T10:00:00Z',
        },
      ],
    });
    render(<NextIntlClientProvider locale="en" messages={en}><RequestProgress requestId="r4" hoursPerDay={8} defaultOpen /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByTestId('progress-corrections-r4')).toBeTruthy());
    const items = screen.getByTestId('progress-corrections-r4').querySelectorAll('li');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('Legacy fix');
    expect(items[1].textContent).toContain('09:00–11:00');
    expect(items[1].textContent).toContain('2 hours');
    expect(items[1].textContent).toContain('Left early');
  });

  it('shows nothing extra when there are no extensions', async () => {
    mocks.progress.mockResolvedValue({ ok: true, steps: [], extensions: [] });
    render(<NextIntlClientProvider locale="en" messages={en}><RequestProgress requestId="r2" defaultOpen /></NextIntlClientProvider>);
    await waitFor(() => expect(mocks.progress).toHaveBeenCalled());
    expect(screen.queryByTestId('progress-extensions-r2')).toBeNull();
  });
});
