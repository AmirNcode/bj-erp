import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/en.json';
import { RoleCheckboxes } from '@/app/[locale]/(app)/manage/employees/_components/EmployeeFormParts';
import type { RoleRow } from '@/lib/actions/roles-helpers';

afterEach(cleanup);

const role = (id: string, systemKey: string | null, name: string): RoleRow => ({
  id, systemKey, kind: systemKey ? 'system' : 'custom', name, holders: 0, permissions: {},
});
const ROLES = [role('r-admin', 'admin', 'Admin'), role('r-emp', 'employee', 'Employee'), role('r-sec', 'security', 'Security')];

function renderPills(selected: string[], onChange = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <RoleCheckboxes label="Roles" roles={ROLES} selected={selected} onChange={onChange}
        editable={['r-admin', 'r-emp', 'r-sec']} adminHint="admin hint" />
    </NextIntlClientProvider>
  );
  return onChange;
}

describe('role pills (owner, 2026-11-03)', () => {
  it('a selected pill is filled and checked; others outlined', () => {
    renderPills(['r-emp']);
    const emp = screen.getByTestId('role-employee');
    expect(emp.className).toContain('bg-primary');
    expect((emp.querySelector('input') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByTestId('role-security').className).not.toContain('bg-primary');
  });
  it('clicking a pill toggles it on and off', () => {
    const onChange = renderPills(['r-emp']);
    fireEvent.click(screen.getByTestId('role-security').querySelector('input')!);
    expect(onChange).toHaveBeenLastCalledWith(['r-emp', 'r-sec']);
    fireEvent.click(screen.getByTestId('role-employee').querySelector('input')!);
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
  it('admin stays disabled even when editable (D1)', () => {
    renderPills([]);
    expect((screen.getByTestId('role-admin').querySelector('input') as HTMLInputElement).disabled).toBe(true);
  });
  it('explains Security without Employee (FR-76)', () => {
    renderPills([]);
    expect(screen.getByText(/Security without Employee/)).toBeTruthy();
  });
});
