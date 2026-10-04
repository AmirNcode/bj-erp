import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '@/app/[locale]/(app)/_components/AppShell';
import { PageHeader } from '@/app/[locale]/(app)/_components/PageHeader';
import {
  PageRefreshButton,
  formatUpdatedTime,
} from '@/app/[locale]/(app)/_components/PageRefreshButton';
import { refreshRoute } from '@/lib/actions/refresh';

const routerRefresh = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => '/en/home',
  useRouter: () => ({ refresh: routerRefresh, prefetch: vi.fn() }),
}));

vi.mock('@/lib/actions/refresh', () => ({
  refreshRoute: vi.fn(async () => ({ ok: true, refreshedAt: '2026-06-30T21:00:00.000Z' })),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const messages = {
  nav: { primary: 'Primary' },
  refresh: {
    updated: 'Updated {time}',
    pending: 'Updating...',
  },
};

function renderWithIntl(ui: React.ReactElement, locale = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      {ui}
    </NextIntlClientProvider>
  );
}

describe('PageRefreshButton', () => {
  it('formats the server/client label in the company timezone', () => {
    expect(formatUpdatedTime(new Date('2026-07-30T04:30:00.000Z'), 'en')).toBe('8:00 AM');
  });

  it('invalidates the current path and refreshes the route when clicked', async () => {
    renderWithIntl(<PageRefreshButton />);

    fireEvent.click(screen.getByTestId('page-refresh-button'));

    await waitFor(() => {
      expect(refreshRoute).toHaveBeenCalledWith('/en/home');
      expect(routerRefresh).toHaveBeenCalled();
    });
  });
});

describe('PageHeader', () => {
  it('renders the page title without another update pill', () => {
    renderWithIntl(<PageHeader title="Welcome, Amir" />);

    expect(screen.getByRole('heading', { name: 'Welcome, Amir' })).toBeTruthy();
    expect(screen.queryByTestId('page-refresh-button')).toBeNull();
  });
});

describe('AppShell header', () => {
  const labels = {
    home: 'Home',
    request: 'Request',
    calendar: 'Calendar',
    profile: 'Profile',
    manage: 'Manage',
  };

  it.each([
    ['en', 'ltr'],
    ['fa', 'rtl'],
  ])('in %s, renders one refresh control just before the profile link (%s)', (locale, dir) => {
    renderWithIntl(
      <AppShell roles={['employee']} locale={locale} labels={labels} appName="BJ">
        <p>content</p>
      </AppShell>,
      locale
    );

    const refresh = screen.getAllByTestId('page-refresh-button');
    expect(refresh).toHaveLength(1);
    const profile = screen.getByTestId('nav-profile');
    const group = profile.parentElement as HTMLElement;
    expect(group.contains(refresh[0])).toBe(true);
    expect(
      refresh[0].compareDocumentPosition(profile) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(group.getAttribute('dir')).toBe(dir);
  });
});
