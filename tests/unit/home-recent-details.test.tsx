import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecentRequests } from '@/app/[locale]/(app)/home/RecentRequests';
import type { LeaveRequestWithType } from '@/lib/actions/leave/requests';
import en from '@/messages/en.json';

const mocks = vi.hoisted(() => ({ dismiss: vi.fn() }));
vi.mock('@/lib/actions/leave/requests', () => ({ dismissFromHome: mocks.dismiss }));
vi.mock('@/components/RequestProgress', () => ({
  RequestProgress: ({ requestId, defaultOpen }: { requestId: string; defaultOpen?: boolean }) => (
    <div data-testid={`progress-${requestId}`} data-open={String(!!defaultOpen)} />
  ),
}));
vi.mock('@/app/[locale]/(app)/request/_components/RequestCancelButton', () => ({ RequestCancelButton: () => null }));
vi.mock('@/app/[locale]/(app)/request/_components/RequestSignature', () => ({ RequestSignatureViewer: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dismiss.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

function req(id: string, status: string, over: Partial<LeaveRequestWithType> = {}): LeaveRequestWithType {
  return {
    id, status, kind: 'errand', errand_location: 'Bandar Abbas', per_diem_rials: null, per_diem_by_requester: false,
    start_date: '2026-10-25', end_date: '2026-10-26', day_part: 'full', unit: 'day', start_time: null, end_time: null,
    requested_minutes: 960, unpaid_minutes: 0, replacement_name: null, serial_year: 1405, serial_seq: 7,
    reason: null, decision_note: null, signature_consent_at: null, approver_signature_consent_at: null,
    created_at: '2026-10-20T08:00:00Z', leave_types: null, ...over,
  } as LeaveRequestWithType;
}

function renderList(requests: LeaveRequestWithType[]) {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <RecentRequests
        requests={requests}
        locale="en"
        hoursPerDay={8}
        travelBookings={{ a: { transport: null, note: 'Flight IR452, hotel booked' } }}
      />
    </NextIntlClientProvider>
  );
}

describe('Home recent requests (FR-72)', () => {
  it('Show more opens the full details with procurement\'s note', () => {
    renderList([req('a', 'approved')]);
    expect(screen.queryByTestId('travel-note-a')).toBeNull();
    fireEvent.click(screen.getByTestId('home-show-more-a'));
    expect(screen.getByTestId('travel-note-a').textContent).toContain('Flight IR452, hotel booked');
    expect(screen.getByTestId('progress-a').getAttribute('data-open')).toBe('true');
    expect(screen.getByTestId('home-show-more-a').textContent).toContain('Show less');
  });

  it('Remove only on rejected requests; removing hides the row', async () => {
    renderList([req('a', 'approved'), req('b', 'rejected', { decision_note: 'Dates clash' })]);
    expect(screen.queryByTestId('home-remove-a')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByTestId('home-remove-b')); });
    expect(mocks.dismiss).toHaveBeenCalledWith('b');
    expect(screen.queryByTestId('home-recent-request-b')).toBeNull();
  });

  it('a failed removal brings the row back with an error', async () => {
    mocks.dismiss.mockResolvedValue({ ok: false, error: 'x' });
    renderList([req('b', 'rejected')]);
    await act(async () => { fireEvent.click(screen.getByTestId('home-remove-b')); });
    expect(screen.getByTestId('home-recent-request-b')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Could not remove');
  });

  it('empty: message and a link to the Requests tab', () => {
    renderList([]);
    expect(screen.getByText('No current requests.')).toBeTruthy();
    expect(screen.getByText('See all my requests').getAttribute('href')).toBe('/en/request');
  });
});
