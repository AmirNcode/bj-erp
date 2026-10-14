import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { RoleEditor, mergeNotes } from '@/app/[locale]/(app)/settings/roles/_components/RoleEditor';
import { saveRole } from '@/lib/actions/roles';
import type { RoleRow } from '@/lib/actions/roles-helpers';

// jsdom lacks these; Radix menus and pointer handling call them.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.scrollIntoView ??= () => {};

const push = vi.fn();
const replace = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace, refresh }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/actions/roles', () => ({ saveRole: vi.fn(async () => ({ ok: true, id: 'new-id' })) }));

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderEditor(role: RoleRow | null = null) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <RoleEditor role={role} locale="en" />
    </NextIntlClientProvider>
  );
}

const custom = (permissions: RoleRow['permissions']): RoleRow => ({
  id: 'r1', systemKey: null, kind: 'custom', name: 'Helpdesk', holders: 0, permissions,
});

const openSection = (key: string) =>
  fireEvent.click(screen.getByTestId(`perm-block-${key}`).querySelector('button')!);

describe('RoleEditor', () => {
  it('notes the rows a change raised, naming the item that needed them', () => {
    renderEditor();
    openSection('leave');
    fireEvent.click(screen.getByTestId('perm-reports-read'));
    expect(screen.getByTestId('perm-row-leave_balances').textContent).toContain('Turned on because Reports needs it');
    expect(screen.getByTestId('perm-row-people').textContent).toContain('Turned on because Reports needs it');
    expect(screen.getByTestId('perm-row-reports').textContent).not.toContain('Turned on');
  });

  it('notes the rows a removal lowered', () => {
    renderEditor(custom({ people: 'read', departments: 'read' }));
    fireEvent.click(screen.getByTestId('perm-people-none'));
    openSection('departments');
    expect(screen.getByTestId('perm-row-departments').textContent).toContain(
      'Turned off because it needs Employee records'
    );
    expect(screen.getByTestId('perm-departments-none').getAttribute('data-state')).toBe('on');
  });

  it('disables the middle segment on action-only items and Allowed on read-only ones', () => {
    renderEditor();
    expect((screen.getByTestId('perm-passwords-read') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('perm-passwords-edit') as HTMLButtonElement).disabled).toBe(false);
    openSection('leave');
    expect((screen.getByTestId('perm-calendar-edit') as HTMLButtonElement).disabled).toBe(true);
  });

  it('cancel leaves at once when nothing changed', () => {
    const confirm = vi.spyOn(window, 'confirm');
    renderEditor();
    fireEvent.click(screen.getByTestId('role-cancel'));
    expect(confirm).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith('/en/settings/roles');
  });

  it('cancel asks first when there are unsaved changes, and stays on No', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderEditor();
    fireEvent.click(screen.getByTestId('perm-passwords-edit'));
    fireEvent.click(screen.getByTestId('role-cancel'));
    expect(confirm).toHaveBeenCalledWith(en.rolesAdmin.unsaved);
    expect(push).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByTestId('role-cancel'));
    expect(push).toHaveBeenCalledWith('/en/settings/roles');
  });

  it('guards a reload while dirty with beforeunload', () => {
    renderEditor();
    const before = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(false);
    fireEvent.click(screen.getByTestId('perm-passwords-edit'));
    const after = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(true);
  });

  it('refuses a non-English name before calling the server', () => {
    renderEditor();
    fireEvent.change(screen.getByTestId('role-name'), { target: { value: 'پشتیبانی' } });
    fireEvent.click(screen.getByTestId('role-save'));
    expect(screen.getByTestId('role-name-error').textContent).toBe(en.rolesAdmin.nameInvalid);
    expect(saveRole).not.toHaveBeenCalled();
  });

  it('saves a new role, clears the notes and opens its page', async () => {
    renderEditor();
    fireEvent.change(screen.getByTestId('role-name'), { target: { value: ' Helpdesk QA ' } });
    fireEvent.click(screen.getByTestId('perm-passwords-edit'));
    expect(screen.getByTestId('perm-row-people').textContent).toContain('Turned on');
    fireEvent.click(screen.getByTestId('role-save'));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/en/settings/roles/new-id'));
    expect(saveRole).toHaveBeenCalledWith({ id: null, name: 'Helpdesk QA', permissions: { passwords: 'edit', people: 'read' } });
    expect(screen.getByTestId('perm-row-people').textContent).not.toContain('Turned on');
  });

  it('puts a duplicate-name refusal under the name field', async () => {
    vi.mocked(saveRole).mockResolvedValueOnce({ ok: false, error: 'A role with this name already exists.', field: 'role_name' });
    renderEditor(custom({}));
    fireEvent.click(screen.getByTestId('role-save'));
    await waitFor(() => expect(screen.getByTestId('role-name-error').textContent).toBe('A role with this name already exists.'));
    expect(screen.queryByTestId('role-save-error')).toBeNull();
  });

  it('keeps a preset name fixed', () => {
    renderEditor({ ...custom({}), kind: 'preset', name: 'HR', systemKey: 'hr' });
    expect((screen.getByTestId('role-name') as HTMLInputElement).disabled).toBe(true);
  });
});

describe('mergeNotes', () => {
  it('uses the first in-section item the user changed as the cause of a bulk change', () => {
    const notes = mergeNotes({}, 'leave', {}, { leave_balances: 'edit', leave_accrual: 'edit', people: 'read', departments: 'read' }, ['people', 'departments'], []);
    expect(notes).toEqual({ people: { kind: 'raised', by: 'leave_balances' }, departments: { kind: 'raised', by: 'leave_balances' } });
  });

  it('does not take a raised row of the same section as the cause', () => {
    const notes = mergeNotes({}, 'employees', {}, { passwords: 'edit', people: 'read' }, ['people'], []);
    expect(notes).toEqual({ people: { kind: 'raised', by: 'passwords' } });
  });

  it('drops the note of a row the user then sets', () => {
    const notes = mergeNotes({ people: { kind: 'raised', by: 'reports' } }, 'employees', { people: 'read' }, { people: 'edit' }, [], []);
    expect(notes).toEqual({});
  });
});
