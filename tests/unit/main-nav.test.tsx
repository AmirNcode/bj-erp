import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import { MainNav } from '@/app/[locale]/(app)/_components/MainNav';

let mockPathname = '/fa/home';
vi.mock('next/navigation', () => ({ usePathname: () => mockPathname }));

afterEach(() => {
  mockPathname = '/fa/home';
  cleanup();
});

const labels = { home: 'خانه', request: 'درخواست', calendar: 'تقویم', profile: 'پروفایل', manage: 'مدیریت' };
const messages = { nav: { primary: 'ناوبری اصلی' } };

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="fa" messages={messages}>
      {ui}
    </NextIntlClientProvider>
  );
}

describe('MainNav', () => {
  it('renders a link per role-visible tab with its testid', () => {
    renderWithIntl(<MainNav roles={['employee']} locale="fa" labels={labels} />);
    expect(screen.getByTestId('nav-home')).toBeTruthy();
    expect(screen.getByTestId('nav-profile')).toBeTruthy();
    expect(screen.queryByTestId('nav-manage')).toBeNull();
  });
  it('shows the manage tab for managers', () => {
    renderWithIntl(<MainNav roles={['manager']} locale="fa" labels={labels} />);
    expect(screen.getByTestId('nav-manage')).toBeTruthy();
  });
  it('highlights the active tab and marks it as the current page', () => {
    renderWithIntl(<MainNav roles={['employee']} locale="fa" labels={labels} />);

    const homeLink = screen.getByTestId('nav-home');
    expect(homeLink.className).toMatch(/bg-primary\/10/);
    expect(homeLink.getAttribute('aria-current')).toBe('page');
  });
  it('also highlights active tabs when next-intl returns an unprefixed pathname', () => {
    mockPathname = '/home';

    renderWithIntl(<MainNav roles={['employee']} locale="fa" labels={labels} />);

    expect(screen.getByTestId('nav-home').getAttribute('aria-current')).toBe('page');
  });
});
