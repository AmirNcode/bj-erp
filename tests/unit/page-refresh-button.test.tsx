import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageHeader } from '@/app/[locale]/(app)/_components/PageHeader';
import { PageRefreshButton } from '@/app/[locale]/(app)/_components/PageRefreshButton';
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
  it('renders the update pill before the page title', () => {
    renderWithIntl(<PageHeader title="Welcome, Amir" />);

    const button = screen.getByTestId('page-refresh-button');
    const heading = screen.getByRole('heading', { name: 'Welcome, Amir' });

    expect(button.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
