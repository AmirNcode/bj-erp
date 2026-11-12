import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/en.json';
import type { PendingApproval } from '@/lib/actions/leave/approvals';
import { RequestSummary } from '@/app/[locale]/(app)/manage/approvals/RequestSummary';

afterEach(cleanup);

const base = {
  id: 'r1', kind: 'leave', unit: 'day', employee_name: 'Sara Test', leave_type_name_fa: 'استحقاقی',
  leave_type_name_en: 'Annual leave', start_date: '2026-11-15', end_date: '2026-11-19', day_part: 'full',
  start_time: null, end_time: null, requested_minutes: 2400, unpaid_minutes: 0, reason: null,
  replacement_name: null, errand_location: null, balance_minutes: 960, pending_other_minutes: 0,
  balance_rule: 'overdraft',
} as unknown as PendingApproval;

function view(request: PendingApproval) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <RequestSummary request={request} hoursPerDay={8} locale="en" />
    </NextIntlClientProvider>,
  );
}

describe('RequestSummary', () => {
  it('shows requester, balance after approval with a minus sign, and the overdraft line', () => {
    view(base);
    const box = screen.getByTestId('approve-summary-r1');
    expect(box.textContent).toMatch(new RegExp('Sara Test'));
    expect(box.textContent).toMatch(new RegExp('Balance after approval'));
    expect(screen.getByTestId('approve-summary-balance-r1').textContent).toMatch(/-3 days/);
    expect(screen.getByTestId('approve-summary-overdraft-r1')).not.toBeNull();
    expect(screen.queryByTestId('approve-summary-unpaid-r1')).toBeNull();
    expect(box.textContent).not.toMatch(/Other pending requests/);
  });

  it('flags the unpaid part for a strict/split request', () => {
    view({ ...base, balance_rule: 'split', balance_minutes: 480, pending_other_minutes: 480 });
    expect(screen.getByTestId('approve-summary-unpaid-r1')).not.toBeNull();
    expect(screen.getByTestId('approve-summary-r1').textContent).toMatch(new RegExp('Other pending requests'));
  });

  it('errand shows location and no balance block', () => {
    view({ ...base, kind: 'errand', errand_location: 'Shiraz', balance_rule: 'none', balance_minutes: null });
    const box = screen.getByTestId('approve-summary-r1');
    expect(box.textContent).toMatch(new RegExp('Shiraz'));
    expect(screen.queryByTestId('approve-summary-balance-r1')).toBeNull();
  });
});
