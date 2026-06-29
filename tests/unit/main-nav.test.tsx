import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MainNav } from '@/app/[locale]/(app)/_components/MainNav';

vi.mock('next/navigation', () => ({ usePathname: () => '/fa/home' }));

const labels = { home: 'خانه', request: 'درخواست', calendar: 'تقویم', profile: 'پروفایل', manage: 'مدیریت' };

describe('MainNav', () => {
  it('renders a link per role-visible tab with its testid', () => {
    render(<MainNav roles={['employee']} locale="fa" labels={labels} />);
    expect(screen.getByTestId('nav-home')).toBeTruthy();
    expect(screen.getByTestId('nav-profile')).toBeTruthy();
    expect(screen.queryByTestId('nav-manage')).toBeNull();
  });
  it('shows the manage tab for managers', () => {
    render(<MainNav roles={['manager']} locale="fa" labels={labels} />);
    expect(screen.getByTestId('nav-manage')).toBeTruthy();
  });
});
