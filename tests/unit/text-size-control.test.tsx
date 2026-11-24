import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import fa from '@/messages/fa.json';
import { TextSizeControl } from '@/components/profile/TextSizeControl';

const mocks = vi.hoisted(() => ({ update: vi.fn(), refresh: vi.fn(), viewAs: vi.fn() }));
vi.mock('@/lib/actions/profile', () => ({ updateMyPrefs: mocks.update }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/app/[locale]/(app)/_components/ViewAsContext', () => ({ useViewAs: mocks.viewAs }));

function renderControl(locale: 'fa' | 'en', initialStep: 0 | 1 | 2 | 3 | 4 = 0) {
  render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : fa}>
      <TextSizeControl initialStep={initialStep} />
    </NextIntlClientProvider>
  );
}
const slide = (n: number) => fireEvent.change(screen.getByTestId('text-size-slider'), { target: { value: String(n) } });
const save = () => screen.getByTestId('text-size-save') as HTMLButtonElement;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.update.mockResolvedValue({ ok: true });
  mocks.viewAs.mockReturnValue(null);
});
afterEach(cleanup);

describe('TextSizeControl', () => {
  it.each([
    ['en', '1.2'],
    ['fa', '1.2'],
  ] as const)('step 2 scales the sample only (%s)', (locale, scale) => {
    renderControl(locale);
    slide(2);
    expect(screen.getByTestId('text-size-sample').style.getPropertyValue('--font-scale')).toBe(scale);
    expect(document.documentElement.style.getPropertyValue('--font-scale')).toBe('');
    expect(screen.getByTestId('text-size-slider').getAttribute('aria-valuetext')).toBe('120%');
  });

  it('Save is disabled at the initial step, enabled after a change; click saves and refreshes', async () => {
    renderControl('en');
    expect(save().disabled).toBe(true);
    slide(2);
    expect(save().disabled).toBe(false);
    fireEvent.click(save());
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({ fontStep: 2 }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    expect(await screen.findByText('Saved')).toBeTruthy();
  });

  it('shows the error when saving fails', async () => {
    mocks.update.mockResolvedValue({ ok: false, error: 'boom' });
    renderControl('en');
    slide(1);
    fireEvent.click(save());
    expect(await screen.findByText('boom')).toBeTruthy();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('save disabled under View as', () => {
    mocks.viewAs.mockReturnValue({ name: 'X', personnelNo: null, expiresAt: '' });
    renderControl('en');
    slide(3);
    expect(save().disabled).toBe(true);
    expect(screen.getByText('Not available while viewing as someone else.')).toBeTruthy();
  });
});
