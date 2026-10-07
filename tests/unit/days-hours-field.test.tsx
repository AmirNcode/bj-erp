import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import {
  DaysHoursField,
  leaveAmountReader,
  readDaysHours,
} from '@/app/[locale]/(app)/manage/employees/_components/EmployeeFormParts';

afterEach(() => {
  cleanup();
});

function renderField(props: Partial<React.ComponentProps<typeof DaysHoursField>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <form data-testid="form">
        <DaysHoursField
          name="balance_x"
          label="Annual Leave"
          minutes={1800}
          hoursPerDay={8}
          allowNegative
          testId="balance-days-annual"
          hoursTestId="balance-hours-annual"
          {...props}
        />
      </form>
    </NextIntlClientProvider>
  );
}

function formData() {
  return new FormData(screen.getByTestId('form') as HTMLFormElement);
}

describe('DaysHoursField', () => {
  it('shows 3 days 6 hours for an uploaded 3d 6h balance, not 3.75', () => {
    renderField();
    expect(screen.getByTestId('balance-days-annual')).toHaveProperty('value', '3');
    expect(screen.getByTestId('balance-hours-annual')).toHaveProperty('value', '6');
  });

  it('exposes the stored minutes on the days input for the e2e helpers', () => {
    renderField({ minutes: 3 * 480 + 5 * 60 + 30 });
    expect(screen.getByTestId('balance-days-annual').getAttribute('data-minutes')).toBe('1770');
  });

  it('accepts whole numbers only and caps hours below a working day', () => {
    renderField();
    const hours = screen.getByTestId('balance-hours-annual');
    expect(hours.getAttribute('step')).toBe('1');
    expect(hours.getAttribute('max')).toBe('7');
    expect(hours.getAttribute('min')).toBe('-7');
  });

  it('does not allow negatives where they are not allowed', () => {
    renderField({ allowNegative: false });
    expect(screen.getByTestId('balance-days-annual').getAttribute('min')).toBe('0');
    expect(screen.getByTestId('balance-hours-annual').getAttribute('min')).toBe('0');
  });

  it('notes leftover minutes it does not show', () => {
    renderField({ minutes: 3 * 480 + 5 * 60 + 30 });
    expect(screen.getByTestId('balance-hours-annual')).toHaveProperty('value', '5');
    expect(screen.getByText(/Plus 30 minutes/)).toBeTruthy();
  });

  it('shows no note when nothing is hidden', () => {
    renderField();
    expect(screen.queryByText(/Plus/)).toBeNull();
  });

  it('renders the error it is given', () => {
    renderField({ error: 'mixedSign' });
    expect(screen.getByRole('alert').textContent).toMatch(/minus sign on both/);
  });
});

describe('readDaysHours', () => {
  it('round-trips an untouched field to the stored minutes, leftover included', () => {
    const stored = 3 * 480 + 5 * 60 + 30;
    renderField({ minutes: stored });
    expect(readDaysHours(formData(), 'balance_x', 8, { allowNegative: true })).toEqual({
      ok: true,
      minutes: stored,
    });
  });

  it('round-trips a negative balance', () => {
    renderField({ minutes: -720 });
    expect(readDaysHours(formData(), 'balance_x', 8, { allowNegative: true })).toEqual({
      ok: true,
      minutes: -720,
    });
  });

  it('reads an emptied box as zero', () => {
    const fd = new FormData();
    fd.set('balance_x_days', '2');
    fd.set('balance_x_hours', '');
    fd.set('balance_x_rest', '0');
    expect(readDaysHours(fd, 'balance_x', 8, { allowNegative: true })).toEqual({
      ok: true,
      minutes: 960,
    });
  });

  it('passes validation errors through', () => {
    const fd = new FormData();
    fd.set('balance_x_days', '3.75');
    fd.set('balance_x_hours', '0');
    fd.set('balance_x_rest', '0');
    expect(readDaysHours(fd, 'balance_x', 8, { allowNegative: true })).toEqual({
      ok: false,
      error: 'notWhole',
    });
  });
});

describe('leaveAmountReader', () => {
  function policyForm(values: Record<string, string>) {
    const fd = new FormData();
    for (const key of ['rate', 'cap', 'carry']) {
      fd.set(`policy_${key}_t1_days`, values[`${key}_days`] ?? '0');
      fd.set(`policy_${key}_t1_hours`, values[`${key}_hours`] ?? '0');
      fd.set(`policy_${key}_t1_rest`, values[`${key}_rest`] ?? '0');
    }
    return fd;
  }

  it('reads the three policy fields as minutes', () => {
    const reader = leaveAmountReader(
      policyForm({ rate_days: '2', rate_hours: '2', cap_days: '26', carry_days: '9', carry_rest: '20' }),
      8
    );
    expect(reader.policy('t1')).toEqual({ rate: 1080, cap: 26 * 480, carry: 9 * 480 + 20 });
    expect(reader.errors).toEqual({});
  });

  it('collects every invalid field by name instead of stopping at the first', () => {
    const reader = leaveAmountReader(
      policyForm({ rate_days: '-1', carry_hours: '9' }),
      8
    );
    reader.policy('t1');
    expect(reader.errors).toEqual({
      policy_rate_t1: 'negative',
      policy_carry_t1: 'hoursTooLarge',
    });
  });

  it('lets a balance go negative', () => {
    const fd = new FormData();
    fd.set('balance_t1_days', '-1');
    fd.set('balance_t1_hours', '-4');
    fd.set('balance_t1_rest', '0');
    const reader = leaveAmountReader(fd, 8);
    expect(reader.read('balance_t1', true)).toBe(-720);
    expect(reader.errors).toEqual({});
  });
});
