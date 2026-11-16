import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SmsSettingsForm } from '@/app/[locale]/(app)/admin/sms/SmsSettingsForm';
import type { SmsSettings } from '@/lib/admin/types';
import en from '@/messages/en.json';

// FR-78 addendum (2026-11-16): Melipayamak web service with the panel username + API key.
const mocks = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn() }));
vi.mock('@/lib/actions/admin', () => ({ saveSmsSettings: mocks.save }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

const base: SmsSettings = {
  mode: 'dry_run',
  provider: 'melipayamak',
  connection: 'webservice',
  username: null,
  sender_line: '50002710000000',
  send_method: 'line',
  body_approver_new: null,
  body_employee_decision: null,
  body_password_reset: null,
  notify_approver_new: true,
  notify_employee_decision: true,
  notify_password_reset: true,
  site_label: 'لغو11',
  header_label: 'سامانه پرسنلی بهسازان جنوب',
  has_api_key: true,
  api_key_hint: '…abcd',
  credit_amount: null,
  credit_checked_at: null,
  credit_error: null,
  credit_pending: false,
  auth_error: null,
  auth_error_at: null,
  updated_at: '2026-11-16T10:00:00Z',
};

const renderForm = (initial: Partial<SmsSettings> = {}) =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SmsSettingsForm initial={{ ...base, ...initial }} />
    </NextIntlClientProvider>
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.save.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe('SMS settings: connection', () => {
  it('shows the web-service choice with its panel hints', () => {
    renderForm();
    expect((screen.getByTestId('sms-connection-webservice') as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByText(/Developers › Web service settings: copy the API key/)).not.toBeNull();
    expect(screen.queryByText(en.admin.sms.usernameHintWebservice)).not.toBeNull();
  });

  it('switches the hints to the console key', () => {
    renderForm();
    fireEvent.click(screen.getByTestId('sms-connection-console'));
    expect(screen.queryByText(/Only if you registered at console\.melipayamak\.com/)).not.toBeNull();
    expect(screen.queryByText(en.admin.sms.usernameHint)).not.toBeNull();
  });

  it('refuses Live over the web service without a username', async () => {
    renderForm();
    fireEvent.click(screen.getByTestId('sms-mode-live'));
    fireEvent.click(screen.getByTestId('sms-save'));
    expect((await screen.findByRole('alert')).textContent).toBe(en.admin.sms.liveNeedsUsername);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('allows Live over the console key without a username', async () => {
    renderForm({ connection: 'console' });
    fireEvent.click(screen.getByTestId('sms-mode-live'));
    fireEvent.click(screen.getByTestId('sms-save'));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0][0]).toMatchObject({ mode: 'live', connection: 'console' });
  });

  it('sends the first and last line; both may be empty', async () => {
    renderForm();
    expect((screen.getByTestId('sms-header-label') as HTMLInputElement).value).toBe('سامانه پرسنلی بهسازان جنوب');
    fireEvent.change(screen.getByTestId('sms-site-label'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('sms-save'));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0][0]).toMatchObject({ headerLabel: 'سامانه پرسنلی بهسازان جنوب', siteLabel: '' });
  });

  it('sends the chosen connection and username', async () => {
    renderForm();
    fireEvent.change(screen.getByTestId('sms-username'), { target: { value: 'behsazan' } });
    fireEvent.click(screen.getByTestId('sms-mode-live'));
    fireEvent.click(screen.getByTestId('sms-save'));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0][0]).toMatchObject({ mode: 'live', connection: 'webservice', username: 'behsazan' });
  });
});
