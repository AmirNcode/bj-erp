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
  waiting_step: null,
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

  it('totals add every approved row the same way', () => {
    renderList([base, cancelled, plain]);
    expect(screen.getByTestId('finance-approved-grand-total').textContent).toContain('6,000,000');
    expect(screen.getByTestId('finance-approved-total').textContent).toContain('600,000');
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
    expect(header).toContain('Transport,Ticket cost,Hotel cost,Amount lost,Total,Status,Waiting on');
    expect(first).toContain('Flight,3000000,2000000,,5500000,Approved,');
    expect(second).toContain('Company car,,,400000,400000,Cancelled,');
  });
});

// Owner review 2026-10-20: finance sees pending requests too (FR-62/FR-70).
const pendingLeave: FinanceRow = { ...plain, id: 'p', serial_seq: 4, kind: 'leave', status: 'pending', per_diem_rials: null,
  errand_location: null, waiting_step: 'manager' };
const pendingErrand: FinanceRow = { ...plain, id: 'q', serial_seq: 5, status: 'pending', per_diem_rials: 300000, waiting_step: 'hr' };
const unbooked: FinanceRow = { ...base, id: 'u', serial_seq: 6, travel_state: 'to_book', transport: null,
  flight_cost_rials: null, hotel_cost_rials: null, per_diem_rials: 200000 };

describe('finance: approved and pending sections', () => {
  it('splits rows into the two sections with their own totals', () => {
    renderList([base, cancelled, pendingLeave, pendingErrand]);
    const approved = screen.getByTestId('finance-section-approved');
    const pending = screen.getByTestId('finance-section-pending');
    expect(approved.querySelector('[data-testid="finance-row-a"]')).toBeTruthy();
    expect(approved.querySelector('[data-testid="finance-row-b"]')).toBeTruthy();
    expect(pending.querySelector('[data-testid="finance-row-p"]')).toBeTruthy();
    expect(pending.querySelector('[data-testid="finance-row-q"]')).toBeTruthy();
    expect(screen.getByTestId('finance-approved-count').textContent).toBe('2');
    expect(screen.getByTestId('finance-approved-grand-total').textContent).toContain('5,900,000');
    expect(screen.getByTestId('finance-pending-count').textContent).toBe('2');
    expect(screen.getByTestId('finance-pending-total').textContent).toContain('300,000');
    expect(screen.getByTestId('finance-pending-grand-total').textContent).toContain('300,000');
  });

  it('a pending row shows only the step label it waits on', () => {
    renderList([pendingLeave, pendingErrand]);
    expect(screen.getByTestId('finance-waiting-p').textContent).toBe('Waiting on: Direct manager');
    expect(screen.getByTestId('finance-waiting-q').textContent).toBe('Waiting on: HR');
    expect(screen.getByTestId('finance-approved-empty')).toBeTruthy();
  });

  it('an approved trip procurement has not finished shows dashes and the marker', () => {
    renderList([unbooked]);
    expect(screen.getByTestId('finance-booking-open-u').textContent).toBe('Booking not finished');
    const row = screen.getByTestId('finance-row-u').textContent ?? '';
    expect(row).toContain('—');
    expect(screen.getByTestId('finance-row-total-u').textContent).toBe('200,000');
    expect(screen.queryByTestId('finance-booking-open-a')).toBeNull();
  });

  it('the CSV covers both sections with a status column', async () => {
    let blob: Blob | null = null;
    URL.createObjectURL = vi.fn((b: Blob) => { blob = b; return 'blob:x'; }) as never;
    URL.revokeObjectURL = vi.fn();
    renderList([pendingErrand, unbooked]);
    fireEvent.click(screen.getByTestId('finance-export'));
    await waitFor(() => expect(blob).not.toBeNull());
    const text = await (blob as unknown as Blob).text();
    const [, first, second] = text.replace(/^﻿/, '').split(/\r?\n/);
    expect(first).toContain('Approved — Booking not finished,');
    expect(second).toContain('Pending,Waiting on: HR');
  });
});
