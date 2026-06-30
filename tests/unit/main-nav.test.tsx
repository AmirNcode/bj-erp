import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import { MainNav } from '@/app/[locale]/(app)/_components/MainNav';

vi.mock('next/navigation', () => ({ usePathname: () => '/fa/home' }));

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
});
