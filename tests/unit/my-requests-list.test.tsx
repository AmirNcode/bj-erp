import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MyRequestsList } from '@/app/[locale]/(app)/request/MyRequestsList';
import type { LeaveRequestWithType } from '@/lib/actions/leave/requests';

// Leaf widgets that call server actions; only their presence matters here.
vi.mock('@/components/RequestProgress', () => ({
  RequestProgress: ({ requestId, defaultOpen }: { requestId: string; defaultOpen?: boolean }) => (
    <div data-testid={`progress-${requestId}`} data-open={String(!!defaultOpen)} />
  ),
}));
vi.mock('@/app/[locale]/(app)/request/_components/RequestCancelButton', () => ({
  RequestCancelButton: () => null,
}));
vi.mock('@/app/[locale]/(app)/request/_components/RequestSignature', () => ({
  RequestSignatureViewer: () => null,
}));

afterEach(cleanup);

const messages = {
  request: {
    showPrevious: '{count, plural, one {Show # previous request} other {Show # previous requests}}',
  },
};

const labels = {
  myRequests: 'My Requests',
  noRequests: 'No requests',
  errorLabel: 'Error',
  statusPending: 'Pending',
  statusApproved: 'Approved',
  statusRejected: 'Rejected',
  statusCancelled: 'Cancelled',
  dayPartLabels: { full: 'Full day', am: 'AM', pm: 'PM' },
  coverLabel: 'Replacement',
  days: 'days',
  hours: 'hours',
  minutes: 'minutes',
  and: 'and',
  from: 'From',
  to: 'To',
  rejectedReason: 'Reason',
  trackingNo: 'Tracking no.',
  errandBadge: 'Errand',
  errandLocation: 'Location',
  unpaidTimeOffLabel: 'Unpaid',
  requesterSignature: {} as never,
  approverSignature: {} as never,
};

function req(id: string, status: string): LeaveRequestWithType {
  return {
    id,
    status,
    kind: 'leave',
    errand_location: null,
    start_date: '2026-10-14',
    end_date: '2026-10-15',
    day_part: 'full',
    unit: 'day',
    start_time: null,
    end_time: null,
    requested_minutes: 480,
    unpaid_minutes: 0,
    serial_year: 1405,
    serial_seq: 1,
    reason: null,
    decision_note: null,
    signature_consent_at: null,
    approver_signature_consent_at: null,
    created_at: '2026-10-13T10:00:00Z',
    replacement_name: null,
    leave_types: { id: 't', name_fa: 'استحقاقی', name_en: 'Annual', color: null },
  } as unknown as LeaveRequestWithType;
}

function renderList(requests: LeaveRequestWithType[], showAll = false) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <MyRequestsList requests={requests} labels={labels} locale="en" hoursPerDay={8} showAll={showAll} />
    </NextIntlClientProvider>
  );
}

const isOpen = () => screen.getByTestId('my-requests-toggle').getAttribute('aria-expanded') === 'true';

describe('MyRequestsList', () => {
  it('opens on pending requests only, with decided ones behind "show previous"', () => {
    renderList([req('p1', 'pending'), req('a1', 'approved'), req('r1', 'rejected')]);

    expect(isOpen()).toBe(true);
    expect(screen.getByTestId('request-row-p1')).toBeTruthy();
    expect(screen.queryByTestId('request-row-a1')).toBeNull();
    expect(screen.getByTestId('progress-p1').dataset.open).toBe('true');

    fireEvent.click(screen.getByTestId('show-previous-requests'));

    expect(screen.getByTestId('request-row-a1')).toBeTruthy();
    expect(screen.getByTestId('request-row-r1')).toBeTruthy();
    expect(screen.getByTestId('progress-a1').dataset.open).toBe('false');
    expect(screen.queryByTestId('show-previous-requests')).toBeNull();
  });

  it('labels the button with the number hidden', () => {
    renderList([req('p1', 'pending'), req('a1', 'approved'), req('r1', 'rejected')]);
    expect(screen.getByTestId('show-previous-requests').textContent).toBe('Show 2 previous requests');
  });

  it('starts closed with nothing pending, and lists everything when opened', () => {
    renderList([req('a1', 'approved'), req('c1', 'cancelled')]);

    expect(isOpen()).toBe(false);
    fireEvent.click(screen.getByTestId('my-requests-toggle'));

    expect(isOpen()).toBe(true);
    expect(screen.getByTestId('request-row-a1')).toBeTruthy();
    expect(screen.getByTestId('request-row-c1')).toBeTruthy();
    expect(screen.queryByTestId('show-previous-requests')).toBeNull();
    // A cancelled request has no approval steps to show.
    expect(screen.queryByTestId('progress-c1')).toBeNull();
  });

  it('opens with everything listed when asked to (?all=1)', () => {
    renderList([req('p1', 'pending'), req('a1', 'approved')], true);

    expect(isOpen()).toBe(true);
    expect(screen.getByTestId('request-row-a1')).toBeTruthy();
    expect(screen.queryByTestId('show-previous-requests')).toBeNull();
  });
});
