import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';

const mocks = vi.hoisted(() => ({
  updatePrefs: vi.fn(),
  signOut: vi.fn(),
  replace: vi.fn(),
  toastError: vi.fn(),
  endRpc: vi.fn(),
  deleteCookie: vi.fn(),
}));
vi.mock('@/lib/actions/profile', () => ({ updateMyPrefs: mocks.updatePrefs, signOut: mocks.signOut }));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ replace: mocks.replace }), usePathname: () => '/home' }));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }));
vi.mock('@/lib/actions/view-as', () => ({ endViewAs: vi.fn() }));

import { ViewAsBar } from '@/app/[locale]/(app)/_components/ViewAsBar';
import { ViewAsProvider } from '@/app/[locale]/(app)/_components/ViewAsContext';
import { LanguageSwitch } from '@/app/[locale]/(app)/_components/LanguageSwitch';
import { LogoutButton } from '@/app/[locale]/(app)/profile/LogoutButton';
import { msUntilExpiry, viewAsLabel } from '@/lib/view-as/client';

const view = { name: 'Sara', personnelNo: '124', expiresAt: new Date(Date.now() + 3_600_000).toISOString() };

function wrap(ui: React.ReactNode, viewing: boolean) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ViewAsProvider value={viewing ? view : null}>{ui}</ViewAsProvider>
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updatePrefs.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe('view-as strip (FR-86)', () => {
  it('shows the person, Read-only, the language switch and Exit', () => {
    wrap(<ViewAsBar locale="en" />, true);
    expect(screen.getByText(/Viewing as Sara \(124\)/)).toBeTruthy();
    expect(screen.getByText('Read-only')).toBeTruthy();
    expect(screen.getByTestId('view-as-lang-fa')).toBeTruthy();
    expect(screen.getByTestId('view-as-lang-en')).toBeTruthy();
    expect(screen.getByTestId('view-as-exit').textContent).toBe('Exit');
  });

  it('shows no brackets for a person with no personnel number', () => {
    expect(viewAsLabel('Sara', null)).toBe('Sara');
    expect(viewAsLabel('Sara', '124')).toBe('Sara (124)');
  });

  it('renders nothing when not viewing', () => {
    wrap(<ViewAsBar locale="en" />, false);
    expect(screen.queryByTestId('view-as-bar')).toBeNull();
  });

  it('LanguageSwitch does not call updateMyPrefs while viewing', async () => {
    wrap(<LanguageSwitch locale="en" />, true);
    fireEvent.click(screen.getByTestId('nav-lang-fa'));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/home', { locale: 'fa' }));
    expect(mocks.updatePrefs).not.toHaveBeenCalled();
  });

  it('LanguageSwitch still saves when not viewing', async () => {
    wrap(<LanguageSwitch locale="en" />, false);
    fireEvent.click(screen.getByTestId('nav-lang-fa'));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalled());
    expect(mocks.updatePrefs).toHaveBeenCalledWith({ languagePref: 'fa' });
  });

  it('LogoutButton shows the read-only toast and does not call signOut while viewing', () => {
    wrap(<LogoutButton locale="en" />, true);
    fireEvent.click(screen.getByTestId('settings-logout'));
    fireEvent.click(screen.getByTestId('logout-confirm'));
    expect(mocks.toastError).toHaveBeenCalledWith('Read-only while viewing. Nothing was saved.');
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it('LogoutButton signs out when not viewing', async () => {
    wrap(<LogoutButton locale="en" />, false);
    fireEvent.click(screen.getByTestId('settings-logout'));
    fireEvent.click(screen.getByTestId('logout-confirm'));
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledWith('en'));
  });

  it('msUntilExpiry adds the margin', () => {
    expect(msUntilExpiry(new Date(10_000).toISOString(), 4_000)).toBe(6_000 + 1_500);
    expect(msUntilExpiry(new Date(1_000).toISOString(), 4_000)).toBe(1_500);
  });
});
