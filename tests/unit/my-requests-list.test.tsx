import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MyRequestsList } from '@/app/[locale]/(app)/request/MyRequestsList';
import type { LeaveRequestWithType } from '@/lib/actions/leave/requests';
import type { ReplacementRequest } from '@/lib/actions/leave/replacement';
import type { EditKey } from '@/lib/leave/requestEdit';
import en from '@/messages/en.json';

// Leaf widgets that call server actions; only their presence matters here.
// FR-88 pieces call server actions; rendered in their own tests.
vi.mock('@/app/[locale]/(app)/request/_components/ReplacementSignoff', () => ({
  ReplacementDeclinedNotice: ({ req }: { req: { id: string } }) => <div data-testid={'replacement-declined-notice-' + req.id} />,
  ReplacementRequestCard: ({ req }: { req: { request_id: string } }) => <div data-testid={'replacement-request-' + req.request_id} />,
}));
vi.mock('@/components/RequestProgress', () => ({
  RequestProgress: ({ requestId, defaultOpen }: { requestId: string; defaultOpen?: boolean }) => (
    <div data-testid={`progress-${requestId}`} data-open={String(!!defaultOpen)} />
  ),
}));
vi.mock('@/app/[locale]/(app)/request/_components/RequestCancelButton', () => ({
  RequestCancelButton: () => null,
}));
vi.mock('@/app/[locale]/(app)/manage/requests/EditRequestDialog', () => ({
  EditRequestDialog: ({ request, units }: { request: { id: string }; units: string[] }) => (
    <div data-testid={`edit-${request.id}`} data-units={units.join(',')} />
  ),
}));
vi.mock('@/app/[locale]/(app)/request/_components/RequestSignature', () => ({
  RequestSignatureViewer: () => null,
}));

afterEach(cleanup);

// Real copy, with the plural message pinned so the assertions below stay exact.
const messages = {
  ...en,
  request: {
    ...en.request,
    showPrevious: '{count, plural, one {Show # previous request} other {Show # previous requests}}',
  },
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

function renderList(requests: LeaveRequestWithType[], showAll = false, coverRequests: ReplacementRequest[] = []) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <MyRequestsList requests={requests} locale="en" hoursPerDay={8} showAll={showAll} coverRequests={coverRequests} />
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

  // FR-88
  it('lists open requests naming the caller as replacement and opens for one to sign', () => {
    const cover = (id: string, status: string, signoff: string | null) =>
      ({ request_id: id, status, signoff_status: signoff }) as unknown as ReplacementRequest;
    renderList([req('a1', 'approved')], false, [
      cover('c1', 'pending', 'pending'),
      cover('c2', 'approved', 'signed'),
      cover('c3', 'cancelled', 'pending'),
    ]);

    expect(isOpen()).toBe(true);
    expect(screen.getByTestId('replacement-request-c1')).toBeTruthy();
    expect(screen.getByTestId('replacement-request-c2')).toBeTruthy();
    expect(screen.queryByTestId('replacement-request-c3')).toBeNull();
  });

  it('asks the requester to choose again after their replacement declined', () => {
    const declined = {
      ...req('a1', 'approved'),
      replacement_name: 'Cover',
      replacement_signoff_status: 'declined',
    } as LeaveRequestWithType;
    renderList([declined]);

    expect(isOpen()).toBe(true);
    expect(screen.getByTestId('replacement-declined-notice-a1')).toBeTruthy();
    expect(screen.getByTestId('request-cover-a1').textContent).toContain('the replacement declined');
  });

  // FR-91
  it('offers Edit on the caller\'s approved requests only with edit_requests_own and the type key', () => {
    const list = [req('p1', 'pending'), req('a1', 'approved')];
    const renderWith = (editKeys: EditKey[]) => {
      cleanup();
      render(
        <NextIntlClientProvider locale="en" messages={messages}>
          <MyRequestsList requests={list} locale="en" hoursPerDay={8} showAll viewerId="me" editKeys={editKeys} />
        </NextIntlClientProvider>
      );
    };

    renderWith([]);
    expect(screen.queryByTestId('edit-a1')).toBeNull();
    renderWith(['edit_leave_daily']);
    expect(screen.queryByTestId('edit-a1')).toBeNull();
    renderWith(['edit_requests_own']);
    expect(screen.queryByTestId('edit-a1')).toBeNull();

    renderWith(['edit_requests_own', 'edit_leave_daily', 'edit_leave_hourly']);
    expect(screen.getByTestId('edit-a1').dataset.units).toBe('day,hour');
    expect(screen.queryByTestId('edit-p1')).toBeNull();
  });
});
