import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PermissionSection } from '@/app/[locale]/(app)/settings/roles/_components/PermissionSection';
import { ALL_KEYS, type PermKey } from '@/lib/permissions/catalog';

// jsdom lacks these; Radix menus and pointer handling call them.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.scrollIntoView ??= () => {};

afterEach(cleanup);

const t = {
  sensitive: 'Sensitive when allowed',
  title: 'Leave',
  items: Object.fromEntries(ALL_KEYS.map((k) => [k, { label: `L:${k}`, description: `D:${k}` }])) as Record<PermKey, { label: string; description: string }>,
  levels: { edit: 'Allowed', read: 'Read only', none: 'Not allowed', noRead: 'No read', noEdit: 'View only', yes: 'Yes', no: 'No' },
  summary: { custom: 'Custom', allow: 'Allowed', read: 'Read only', none: 'Not allowed' },
  raisedBy: (by: string) => `Raised by ${by}`,
  loweredBy: (by: string) => `Lowered by ${by}`,
};

function openMenu(section: string) {
  fireEvent.pointerDown(screen.getByTestId(`perm-section-${section}`), { button: 0, ctrlKey: false });
}

describe('PermissionSection', () => {
  it('marks write-capable permissions even when off, but not read-only permissions', () => {
    render(<PermissionSection section="leave" perms={{}} onChange={() => {}} notes={{}} t={t} defaultOpen />);
    expect(screen.getByTestId('perm-sensitive-leave_balances').textContent).toContain(t.sensitive);
    expect(screen.queryByTestId('perm-sensitive-reports')).toBeNull();
    expect(screen.queryByTestId('perm-sensitive-calendar')).toBeNull();
  });
  it('header shows Custom when the section is mixed', () => {
    render(<PermissionSection section="leave" perms={{ leave_balances: 'edit' }} onChange={() => {}} notes={{}} t={t} defaultOpen />);
    expect(screen.getByTestId('perm-section-leave').textContent).toContain('Custom');
  });

  it('shows the item count badge and a row per item', () => {
    render(<PermissionSection section="leave" perms={{}} onChange={() => {}} notes={{}} t={t} defaultOpen />);
    expect(screen.getByTestId('perm-section-count-leave').textContent).toBe('7');
    expect(screen.getByTestId('perm-row-calendar')).toBeTruthy();
    expect(screen.queryByTestId('perm-row-people')).toBeNull();
  });

  it('bulk Allowed sets every leave item to its highest level and reports raised people', () => {
    const onChange = vi.fn();
    render(<PermissionSection section="leave" perms={{}} onChange={onChange} notes={{}} t={t} defaultOpen />);
    openMenu('leave');
    fireEvent.click(screen.getByTestId('perm-section-leave-allow'));
    const [perms, raised, lowered] = onChange.mock.calls[0];
    expect(perms).toMatchObject({ leave_balances: 'edit', leave_accrual: 'edit', leave_requests: 'edit', calendar: 'read', reports: 'read', people: 'read', departments: 'read' });
    expect([...raised].sort()).toEqual(['departments', 'people']);
    expect(lowered).toEqual([]);
  });

  it('bulk Not allowed in a section lowers dependants outside it and reports them', () => {
    const onChange = vi.fn();
    render(
      <PermissionSection section="employees" perms={{ people: 'edit', departments: 'read', leave_requests: 'read' }}
        onChange={onChange} notes={{}} t={{ ...t, title: 'Employees' }} defaultOpen />
    );
    openMenu('employees');
    fireEvent.click(screen.getByTestId('perm-section-employees-none'));
    const [perms, raised, lowered] = onChange.mock.calls[0];
    expect(perms).toEqual({});
    expect(raised).toEqual([]);
    expect([...lowered].sort()).toEqual(['departments', 'leave_requests']);
  });

  it('bulk Read only passes through the items it lowers', () => {
    const onChange = vi.fn();
    render(
      <PermissionSection section="employees" perms={{ people: 'edit', people_create: 'edit' }}
        onChange={onChange} notes={{}} t={{ ...t, title: 'Employees' }} defaultOpen />
    );
    openMenu('employees');
    fireEvent.click(screen.getByTestId('perm-section-employees-read'));
    const [perms, , lowered] = onChange.mock.calls[0];
    expect(perms).toEqual({ people: 'read', personal_info: 'read', clearance: 'read' });
    expect(lowered).toEqual([]);
  });

  it('a row toggle change goes through applyLevel', () => {
    const onChange = vi.fn();
    render(<PermissionSection section="leave" perms={{}} onChange={onChange} notes={{}} t={t} defaultOpen />);
    fireEvent.click(screen.getByTestId('perm-reports-read'));
    expect(onChange.mock.calls[0][0]).toMatchObject({ reports: 'read', people: 'read', leave_balances: 'read', leave_requests: 'read' });
    expect([...onChange.mock.calls[0][1]].sort()).toEqual(['leave_balances', 'leave_requests', 'people']);
  });

  it('turning a row off passes the dependants it removed as lowered', () => {
    const onChange = vi.fn();
    render(
      <PermissionSection section="leave" perms={{ people: 'read', leave_balances: 'read', leave_requests: 'read', reports: 'read' }}
        onChange={onChange} notes={{}} t={t} defaultOpen />
    );
    fireEvent.click(screen.getByTestId('perm-leave_balances-none'));
    const [perms, raised, lowered] = onChange.mock.calls[0];
    expect(perms).toEqual({ people: 'read', leave_requests: 'read' });
    expect(raised).toEqual([]);
    expect(lowered).toEqual(['reports']);
  });

  it('a raised row shows who raised it', () => {
    render(
      <PermissionSection section="leave" perms={{ reports: 'read', leave_balances: 'read', leave_requests: 'read', people: 'read' }}
        onChange={() => {}} notes={{ leave_balances: { kind: 'raised', by: 'reports' } }} t={t} defaultOpen />
    );
    expect(screen.getByTestId('perm-row-leave_balances').textContent).toContain('Raised by L:reports');
  });

  it('a lowered row shows what was turned off', () => {
    render(
      <PermissionSection section="leave" perms={{}} onChange={() => {}}
        notes={{ reports: { kind: 'lowered', by: 'leave_balances' } }} t={t} defaultOpen />
    );
    const row = screen.getByTestId('perm-row-reports');
    expect(row.textContent).toContain('Lowered by L:leave_balances');
    expect(row.textContent).not.toContain('Raised by');
  });
});


describe('approval delegation permission', () => {
  it('offers exactly Yes and No with no disabled Read segment', () => {
    const onChange = vi.fn();
    render(<PermissionSection section="approvalChain" perms={{}} onChange={onChange} notes={{}} t={t} defaultOpen />);
    const toggle = screen.getByTestId('perm-approval_delegate');
    expect(within(toggle).getAllByRole('radio')).toHaveLength(2);
    expect(screen.queryByTestId('perm-approval_delegate-read')).toBeNull();
    fireEvent.click(within(toggle).getByRole('radio', { name: 'Yes' }));
    expect(onChange.mock.calls[0]).toEqual([{ approval_delegate: 'edit' }, [], []]);
  });

  it('section Read turns delegation off without inventing a read grant', () => {
    const onChange = vi.fn();
    render(<PermissionSection section="approvalChain" perms={{ approval_delegate: 'edit' }} onChange={onChange} notes={{}} t={t} defaultOpen />);
    openMenu('approvalChain');
    fireEvent.click(screen.getByTestId('perm-section-approvalChain-read'));
    expect(onChange.mock.calls[0][0]).toEqual({ approval_steps: 'read', people: 'read' });
  });
});
