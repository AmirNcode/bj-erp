import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { FinanceList } from '@/app/[locale]/(app)/finance/FinanceList';
import type { FinanceRow } from '@/lib/actions/finance';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
afterEach(cleanup);

const base: FinanceRow = {
  id: 'a', serial_year: 1405, serial_seq: 1, kind: 'errand', employee_name: 'Sara', personnel_no: '101',
  department_name_fa: null, department_name_en: 'HQ', leave_type_name_fa: null, leave_type_name_en: null, is_paid: null,
  start_date: '2027-03-01', end_date: '2027-03-02', unit: 'day', start_time: null, end_time: null, requested_minutes: 960,
  unpaid_minutes: 0, errand_location: 'Shiraz', per_diem_rials: 500000, per_diem_by_requester: false, decided_at: null,
  status: 'approved', travel_state: 'done', transport: 'flight', flight_cost_rials: 3000000, hotel_cost_rials: 2000000, lost_rials: null,
};
const cancelled: FinanceRow = { ...base, id: 'b', serial_seq: 2, status: 'cancelled', travel_state: 'settled', transport: 'company_car',
  per_diem_rials: null, flight_cost_rials: null, hotel_cost_rials: null, lost_rials: 400000 };
const plain: FinanceRow = { ...base, id: 'c', serial_seq: 3, travel_state: null, transport: null, flight_cost_rials: null, hotel_cost_rials: null, per_diem_rials: 100000 };

function renderList(rows: FinanceRow[]) {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <FinanceList rows={rows} months={[]} from="2027-03-01" to="2027-03-31" locale="en" hoursPerDay={8} />
    </NextIntlClientProvider>
  );
}

describe('finance: travel costs (FR-70)', () => {
  it('shows transport, ticket, hotel and the trip total', () => {
    renderList([base]);
    const row = screen.getByTestId('finance-row-a').textContent ?? '';
    expect(row).toContain('Flight');
    expect(row).toContain('3,000,000');
    expect(row).toContain('2,000,000');
    expect(screen.getByTestId('finance-row-total-a').textContent).toBe('5,500,000');
  });

  it('a cancelled trip shows only the amount lost, marked cancelled', () => {
    renderList([cancelled]);
    expect(screen.getByTestId('finance-cancelled-b').textContent).toBe('Cancelled');
    expect(screen.getByTestId('finance-row-total-b').textContent).toBe('400,000');
  });

  it('totals add every row the same way', () => {
    renderList([base, cancelled, plain]);
    expect(screen.getByTestId('finance-grand-total').textContent).toContain('6,000,000');
    expect(screen.getByTestId('finance-total').textContent).toContain('600,000');
  });

  it('the CSV carries the travel columns', async () => {
    let blob: Blob | null = null;
    URL.createObjectURL = vi.fn((b: Blob) => { blob = b; return 'blob:x'; }) as never;
    URL.revokeObjectURL = vi.fn();
    renderList([base, cancelled]);
    fireEvent.click(screen.getByTestId('finance-export'));
    await waitFor(() => expect(blob).not.toBeNull());
    const text = await (blob as unknown as Blob).text();
    const [header, first, second] = text.replace(/^﻿/, '').split(/\r?\n/);
    expect(header).toContain('Transport,Ticket cost,Hotel cost,Amount lost,Total,Status');
    expect(first).toContain('Flight,3000000,2000000,,5500000,Approved');
    expect(second).toContain('Company car,,,400000,400000,Cancelled');
  });
});
