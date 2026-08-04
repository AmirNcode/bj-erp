import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageHeader } from '@/app/[locale]/(app)/_components/PageHeader';
import {
  PageRefreshButton,
  formatUpdatedTime,
} from '@/app/[locale]/(app)/_components/PageRefreshButton';
import { refreshRoute } from '@/lib/actions/refresh';

const routerRefresh = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => '/en/home',
  useRouter: () => ({ refresh: routerRefresh }),
}));

vi.mock('@/lib/actions/refresh', () => ({
  refreshRoute: vi.fn(async () => ({ ok: true, refreshedAt: '2026-06-30T21:00:00.000Z' })),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const messages = {
  refresh: {
    updated: 'Updated {time}',
    pending: 'Updating...',
  },
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
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

describe('AppShell refresh placement', () => {
  const source = readFileSync(
    'app/[locale]/(app)/_components/AppShell.tsx',
    'utf8'
  );

  it('renders the only header refresh control immediately before the profile link', () => {
    const refreshIndex = source.indexOf('<PageRefreshButton');
    const profileIndex = source.indexOf('data-testid="nav-profile"');

    expect(refreshIndex).toBeGreaterThan(0);
    expect(refreshIndex).toBeLessThan(profileIndex);
    expect(source.match(/<PageRefreshButton/g)).toHaveLength(1);
    expect(source).toContain("dir={locale === 'fa' ? 'rtl' : 'ltr'}");
  });
});
