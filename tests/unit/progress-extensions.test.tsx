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

  it('shows nothing extra when there are no extensions', async () => {
    mocks.progress.mockResolvedValue({ ok: true, steps: [], extensions: [] });
    render(<NextIntlClientProvider locale="en" messages={en}><RequestProgress requestId="r2" defaultOpen /></NextIntlClientProvider>);
    await waitFor(() => expect(mocks.progress).toHaveBeenCalled());
    expect(screen.queryByTestId('progress-extensions-r2')).toBeNull();
  });
});
