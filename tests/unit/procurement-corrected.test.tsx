import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import { ProcurementList, STATE_ORDER } from '@/app/[locale]/(app)/procurement/ProcurementList';
import type { TravelBookingRow } from '@/lib/actions/travel';

afterEach(cleanup);

const row = {
  request_id: 'r1', serial_year: 1405, serial_seq: 1, employee_name: 'Sara', personnel_no: '101',
  department_name_fa: null, department_name_en: 'HQ', errand_location: 'Shiraz', start_date: '2027-03-01',
  end_date: '2027-03-02', state: 'corrected', transport: null, flight_cost_rials: null, hotel_cost_rials: null,
  lost_rials: null, done_at: null,
} as TravelBookingRow;

describe('procurement: corrected trips (FR-84)', () => {
  it('lists a corrected booking in its own group, before the finished ones', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ProcurementList rows={[row]} locale="en" />
      </NextIntlClientProvider>
    );
    expect(screen.getByTestId('procurement-group-corrected').textContent).toContain('Dates corrected');
    expect(STATE_ORDER.indexOf('corrected')).toBeLessThan(STATE_ORDER.indexOf('done'));
  });
});
