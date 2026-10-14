import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { RolesList } from '@/app/[locale]/(app)/settings/roles/_components/RolesList';
import type { RoleRow } from '@/lib/actions/roles-helpers';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/lib/actions/roles', () => ({
  getRoleHolders: vi.fn(),
  deleteRole: vi.fn(),
  listTransferCandidates: vi.fn(),
  transferAdmin: vi.fn(),
}));

afterEach(cleanup);

const row = (id: string, kind: RoleRow['kind'], name: string, systemKey: string | null, holders = 0): RoleRow => ({
  id, kind, name, systemKey, holders, permissions: {},
});

const roles = [
  row('a', 'system', 'Admin', 'admin', 1),
  row('m', 'system', 'Manager', 'manager', 3),
  row('e', 'system', 'Employee', 'employee', 40),
  row('h', 'preset', 'HR', 'hr', 2),
  row('c', 'custom', 'Helpdesk', null, 1),
];

describe('RolesList', () => {
  it('gives each kind of role its actions', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <RolesList roles={roles} adminHolder={{ fullName: 'Amir N', personnelNo: '1001' }} locale="en" />
      </NextIntlClientProvider>
    );
    expect(screen.getByTestId('roles-list').children).toHaveLength(5);
    expect(screen.getByTestId('role-new').getAttribute('href')).toBe('/en/settings/roles/new');
    expect(screen.getByTestId('role-row-a').textContent).toContain('Amir N');
    expect(screen.getByTestId('transfer-admin')).toBeTruthy();
    for (const id of ['a', 'm', 'e']) {
      expect(screen.queryByTestId(`role-edit-${id}`)).toBeNull();
      expect(screen.queryByTestId(`role-delete-${id}`)).toBeNull();
    }
    expect(screen.getByTestId('role-row-m').textContent).toContain(en.rolesAdmin.managerNote);
    expect(screen.getByTestId('role-edit-h').getAttribute('href')).toBe('/en/settings/roles/h');
    expect(screen.queryByTestId('role-delete-h')).toBeNull();
    expect(screen.getByTestId('role-row-h').textContent).toContain('Built-in');
    expect(screen.getByTestId('role-edit-c')).toBeTruthy();
    expect(screen.getByTestId('role-delete-c')).toBeTruthy();
    expect(screen.getByTestId('role-holders-c').textContent).toBe('1 person');
  });

  it('shows the admin holder without a dangling separator when they have no personnel number', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <RolesList roles={roles} adminHolder={{ fullName: 'System admin', personnelNo: '' }} locale="en" />
      </NextIntlClientProvider>
    );
    expect(screen.getByTestId('admin-holder').textContent).toBe('System admin');
  });

  it('shows name · personnel number when there is one', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <RolesList roles={roles} adminHolder={{ fullName: 'Amir N', personnelNo: '1001' }} locale="en" />
      </NextIntlClientProvider>
    );
    expect(screen.getByTestId('admin-holder').textContent).toBe('Amir N · 1001');
  });
});
