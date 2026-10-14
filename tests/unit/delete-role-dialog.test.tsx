import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { DeleteRoleDialog } from '@/app/[locale]/(app)/settings/roles/_components/DeleteRoleDialog';
import { deleteRole, getRoleHolders } from '@/lib/actions/roles';
import { toast } from 'sonner';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/actions/roles', () => ({
  getRoleHolders: vi.fn(),
  deleteRole: vi.fn(async () => ({ ok: true, removed: [] })),
}));

const writeText = vi.fn(async () => {});
Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

function open(holders: { fullName: string; personnelNo: string }[]) {
  vi.mocked(getRoleHolders).mockResolvedValue({ ok: true, holders });
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <DeleteRoleDialog roleId="r1" roleName="Helpdesk" />
    </NextIntlClientProvider>
  );
  fireEvent.click(screen.getByTestId('role-delete-r1'));
}

describe('DeleteRoleDialog', () => {
  it('lists the holders and copies their personnel numbers one per line', async () => {
    open([
      { fullName: 'Sara Ahmadi', personnelNo: '1201' },
      { fullName: 'Reza Karimi', personnelNo: '1305' },
    ]);
    const list = await screen.findByTestId('delete-holders');
    expect(getRoleHolders).toHaveBeenCalledWith('r1');
    expect(list.querySelectorAll('li')).toHaveLength(2);
    expect(list.textContent).toContain('Sara Ahmadi');
    expect(list.querySelector('bdi')?.textContent).toBe('1201');
    expect(screen.getByTestId('delete-body').textContent).toBe('2 people hold this role. They all lose it.');
    fireEvent.click(screen.getByTestId('copy-personnel-nos'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('1201\n1305'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(en.rolesAdmin.delete.copied));
  });

  it('hides the list and the copy button when nobody holds the role', async () => {
    open([]);
    await waitFor(() => expect(screen.getByTestId('delete-body').textContent).toBe('No one holds this role.'));
    expect(screen.queryByTestId('delete-holders')).toBeNull();
    expect(screen.queryByTestId('copy-personnel-nos')).toBeNull();
  });

  it('deletes and refreshes on confirm', async () => {
    open([]);
    await waitFor(() => expect((screen.getByTestId('delete-confirm') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('delete-confirm'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(deleteRole).toHaveBeenCalledWith('r1');
  });

  it('keeps the dialog open with the refusal in an alert', async () => {
    vi.mocked(deleteRole).mockResolvedValueOnce({ ok: false, error: 'Built-in roles cannot be deleted.' });
    open([]);
    await waitFor(() => expect((screen.getByTestId('delete-confirm') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('delete-confirm'));
    expect((await screen.findByRole('alert')).textContent).toBe('Built-in roles cannot be deleted.');
    expect(screen.getByTestId('delete-confirm')).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });
});
