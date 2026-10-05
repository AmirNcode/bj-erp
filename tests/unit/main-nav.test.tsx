import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import { MainNav } from '@/app/[locale]/(app)/_components/MainNav';

let mockPathname = '/fa/home';
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ refresh: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock('@/lib/actions/profile', () => ({ updateMyPrefs: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/actions/refresh', () => ({ refreshRoute: vi.fn() }));

afterEach(() => {
  mockPathname = '/fa/home';
  cleanup();
});

const labels = {
  home: 'خانه',
  request: 'درخواست',
  calendar: 'تقویم',
  profile: 'پروفایل',
  manage: 'مدیریت',
  manageGroup: 'مدیریت',
  employees: 'کارکنان',
  departments: 'واحدها',
  approvals: 'تأییدها',
  requests: 'بایگانی درخواست‌ها',
  approvalSteps: 'مراحل تأیید',
  reports: 'گزارش‌ها',
  settings: 'تنظیمات',
  language: 'زبان',
  langFa: 'فارسی',
  langEn: 'English',
};
const messages = {
  nav: { primary: 'ناوبری اصلی' },
  refresh: { updated: 'به‌روزرسانی {time}', pending: '...' },
};

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
    expect(screen.getByTestId('nav-calendar')).toBeTruthy();
    // Profile sits in the side-panel footer and, on mobile, in the bar.
    expect(screen.getByTestId('nav-profile')).toBeTruthy();
    expect(screen.getByTestId('nav-profile-tab')).toBeTruthy();
    expect(screen.queryByTestId('nav-manage')).toBeNull();
    expect(screen.queryByTestId('nav-manage-tab')).toBeNull();
    expect(screen.queryByTestId('nav-settings')).toBeNull();
  });
  it('shows the manage group for managers, without admin-only items', () => {
    renderWithIntl(<MainNav roles={['manager']} locale="fa" labels={labels} />);
    expect(screen.getByTestId('nav-manage').getAttribute('href')).toBe('/fa/manage/employees');
    expect(screen.getByTestId('nav-manage-tab').getAttribute('href')).toBe('/fa/manage');
    expect(screen.getByTestId('nav-approvals')).toBeTruthy();
    expect(screen.queryByTestId('nav-reports')).toBeNull();
    expect(screen.queryByTestId('nav-settings')).toBeNull();
  });
  it('admin gets settings as its own item', () => {
    renderWithIntl(<MainNav roles={['admin']} locale="fa" labels={labels} />);
    expect(screen.getByTestId('nav-settings')).toBeTruthy();
    expect(screen.getByTestId('nav-reports')).toBeTruthy();
  });
  it('keeps the manage tab active on any manage page', () => {
    mockPathname = '/fa/manage/approvals';
    renderWithIntl(<MainNav roles={['manager']} locale="fa" labels={labels} />);
    expect(screen.getByTestId('nav-manage-tab').getAttribute('aria-current')).toBe('page');
    expect(screen.getByTestId('nav-approvals').getAttribute('aria-current')).toBe('page');
    expect(screen.getByTestId('nav-manage').getAttribute('aria-current')).toBeNull();
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
  it('renders the language switch with the current locale pressed', () => {
    renderWithIntl(<MainNav roles={['employee']} locale="fa" labels={labels} />);
    expect(screen.getByTestId('nav-lang-fa').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('nav-lang-en').getAttribute('aria-pressed')).toBe('false');
  });
});
