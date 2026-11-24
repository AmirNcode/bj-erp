import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import { ProfileTabs } from '@/app/[locale]/(app)/profile/_components/ProfileTabs';

let mockPathname = '/profile';
vi.mock('next/navigation', () => ({ usePathname: () => mockPathname }));

afterEach(() => {
  mockPathname = '/profile';
  cleanup();
});

const messages = {
  profile: {
    title: 'پروفایل',
    tabs: { profile: 'پروفایل', personalInfo: 'اطلاعات شخصی', preferences: 'ترجیحات', security: 'امنیت حساب' },
  },
};

function renderTabs() {
  return render(
    <NextIntlClientProvider locale="fa" messages={messages}>
      <ProfileTabs locale="fa" />
    </NextIntlClientProvider>,
  );
}

describe('ProfileTabs', () => {
  it('renders four links in order', () => {
    renderTabs();
    const links = screen.getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/fa/profile',
      '/fa/profile/personal-info',
      '/fa/profile/preferences',
      '/fa/profile/security',
    ]);
  });

  it('marks the security tab active on a prefix-less Farsi pathname', () => {
    mockPathname = '/profile/security';
    renderTabs();
    expect(screen.getByTestId('profile-tab-security').getAttribute('aria-current')).toBe('page');
    expect(screen.getByTestId('profile-tab-profile').getAttribute('aria-current')).toBeNull();
    expect(screen.getByTestId('profile-tab-preferences').getAttribute('aria-current')).toBeNull();
  });
});
