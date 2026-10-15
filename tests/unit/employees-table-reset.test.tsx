import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EmployeesTable,
  type EmployeeRow,
} from '@/app/[locale]/(app)/manage/employees/EmployeesTable';
import { bulkResetPasswords } from '@/lib/actions/employees';
import { passwordResetEligibleIds, resetSelectableIds } from '@/lib/employees/passwordReset';

// FR-55 review, Medium 2: a non-admin passwords holder sees the admin and people
// who hold more in the list. Their rows must not be selectable, or select-all
// sends a batch the database refuses whole.

vi.mock('@/lib/actions/employees', () => ({
  bulkResetPasswords: vi.fn(async () => ({ ok: true, credentials: [] })),
}));
vi.mock('@/components/CredentialsDownload', () => ({
  CredentialsDownload: () => <p data-testid="credentials" />,
}));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const row = (id: string, code: string, extra: Partial<EmployeeRow>): EmployeeRow => ({
  id,
  employee_code: code,
  full_name: `Person ${code}`,
  active: true,
  hireDateLabel: '—',
  departmentLabel: '—',
  roleLabels: [],
  upcoming: null,
  isSelf: false,
  canReset: false,
  ...extra,
});

// Mixed list as a helpdesk sees it: self, two eligible, the admin, a manager.
const ROWS: EmployeeRow[] = [
  row('self', '100', { isSelf: true }),
  row('e1', '101', { canReset: true }),
  row('admin', 'admin', {}),
  row('e2', '102', { canReset: true }),
  row('mgr', '103', {}),
];

const LABELS = {
  employee: 'Employee',
  hireDate: 'Hire date',
  department: 'Department',
  roles: 'Roles',
  upcomingLeave: 'Upcoming',
  edit: 'Edit',
  locked: 'Locked',
  noEmployees: 'None',
  errorLabel: 'Error',
  selected: '{count} selected',
  clearSelection: 'Clear',
  regen: { button: 'Regenerate', confirmTitle: 'Sure?', confirmBody: '{count} people', cancel: 'Cancel', confirm: 'Go' },
};

const renderTable = (rows = ROWS) =>
  render(<EmployeesTable employees={rows} canBulkReset showLocks={false} locale="en" labels={LABELS} />);

describe('bulk password reset selection (Medium 2)', () => {
  it('offers a checkbox only on eligible rows', () => {
    renderTable();
    expect(screen.getByTestId('emp-check-101')).toBeTruthy();
    expect(screen.getByTestId('emp-check-102')).toBeTruthy();
    expect(screen.queryByTestId('emp-check-100')).toBeNull(); // self
    expect(screen.queryByTestId('emp-check-admin')).toBeNull();
    expect(screen.queryByTestId('emp-check-103')).toBeNull();
  });

  it('select-all takes the eligible rows only and sends just those', async () => {
    renderTable();
    fireEvent.click(screen.getByTestId('emp-check-all'));
    expect(screen.getByText('2 selected')).toBeTruthy();
    expect((screen.getByTestId('emp-check-all') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByTestId('regen-passwords'));
    fireEvent.click(await screen.findByTestId('regen-confirm'));
    await waitFor(() => expect(bulkResetPasswords).toHaveBeenCalledTimes(1));
    expect(vi.mocked(bulkResetPasswords).mock.calls[0][0].sort()).toEqual(['e1', 'e2']);
  });

  it('select-all is checked once every eligible row is ticked by hand', () => {
    renderTable();
    fireEvent.click(screen.getByTestId('emp-check-101'));
    expect((screen.getByTestId('emp-check-all') as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByTestId('emp-check-102'));
    expect((screen.getByTestId('emp-check-all') as HTMLInputElement).checked).toBe(true);
  });

  it('a page with no eligible row leaves select-all unchecked and selects nobody', () => {
    renderTable(ROWS.map((r) => ({ ...r, canReset: false })));
    fireEvent.click(screen.getByTestId('emp-check-all'));
    expect((screen.getByTestId('emp-check-all') as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByTestId('emp-bulk-bar')).toBeNull();
  });
});

describe('lib/employees/passwordReset', () => {
  it('resetSelectableIds keeps list order and eligible rows only', () => {
    expect(resetSelectableIds(ROWS)).toEqual(['e1', 'e2']);
  });

  it('asks the database once and fails closed on an error', async () => {
    const rpc = vi.fn(async () => ({ data: ['e1'], error: null }));
    const client = { rpc } as unknown as Parameters<typeof passwordResetEligibleIds>[0];
    expect([...(await passwordResetEligibleIds(client, ['e1', 'admin']))]).toEqual(['e1']);
    expect(rpc).toHaveBeenCalledWith('app_password_reset_eligible', { p_ids: ['e1', 'admin'] });

    const failing = { rpc: vi.fn(async () => ({ data: null, error: { message: 'boom' } })) } as unknown as Parameters<
      typeof passwordResetEligibleIds
    >[0];
    expect((await passwordResetEligibleIds(failing, ['e1'])).size).toBe(0);
    const none = { rpc: vi.fn() } as unknown as Parameters<typeof passwordResetEligibleIds>[0];
    expect((await passwordResetEligibleIds(none, [])).size).toBe(0);
    expect(none.rpc).not.toHaveBeenCalled();
  });
});
