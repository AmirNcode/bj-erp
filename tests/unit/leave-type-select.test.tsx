import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LeaveTypeSelect } from '@/app/[locale]/(app)/request/_components/FormParts';
import type { LeaveType } from '@/lib/actions/leave/reference';

const type = (id: string, name_fa: string, name_en: string): LeaveType => ({
  id,
  name_fa,
  name_en,
  allow_half_day: true,
  allow_hourly: true,
  affects_balance: true,
  is_paid: true,
  color: null,
});

const types = [
  type('annual', 'استحقاقی', 'Annual Leave'),
  type('sick', 'استعلاجی', 'Sick Leave'),
  type('unpaid', 'بدون حقوق', 'Unpaid Leave'),
];

function renderSelect(value = '', onChange = vi.fn(), locale = 'en') {
  render(
    <LeaveTypeSelect
      id="leave_type_id"
      testId="type"
      leaveTypes={types}
      value={value}
      onChange={onChange}
      locale={locale}
      label="Leave Type"
    />
  );
  return onChange;
}

afterEach(cleanup);

describe('LeaveTypeSelect', () => {
  it('shows every type as a radio in one labelled group', () => {
    renderSelect();
    expect(screen.getByRole('group', { name: 'Leave Type' })).toBeTruthy();
    expect(screen.getAllByRole('radio').map((r) => r.getAttribute('value'))).toEqual([
      'annual',
      'sick',
      'unpaid',
    ]);
    expect(screen.getAllByRole('radio').every((r) => !(r as HTMLInputElement).checked)).toBe(true);
  });

  it('picks a type with one tap on its label', () => {
    const onChange = renderSelect();
    fireEvent.click(screen.getByText('Sick Leave'));
    expect(onChange).toHaveBeenCalledWith('sick');
  });

  it('marks the current value checked', () => {
    renderSelect('unpaid');
    expect((screen.getByRole('radio', { name: 'Unpaid Leave' }) as HTMLInputElement).checked).toBe(true);
  });

  it('uses the Farsi name in fa', () => {
    renderSelect('', vi.fn(), 'fa');
    expect(screen.getByRole('radio', { name: 'استعلاجی' })).toBeTruthy();
  });
});
