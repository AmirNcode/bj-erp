import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';

const mocks = vi.hoisted(() => ({ setMyMobile: vi.fn(), refresh: vi.fn() }));
vi.mock('@/lib/actions/personal-info', () => ({ setMyMobile: mocks.setMyMobile }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

import { SmsMobileCard } from '@/components/profile/SmsMobileCard';
import { ViewAsProvider } from '@/app/[locale]/(app)/_components/ViewAsContext';
import type { MySms } from '@/lib/actions/personal-info';

const sms = (id: string, status: MySms['status'], body: string): MySms => ({
  id, event: 'test', to_mobile: '09121112233', body, status,
  created_at: '2026-11-19T10:00:00Z', sent_at: status === 'sent' ? '2026-11-19T10:00:05Z' : null,
});

function wrap(props: { initial: string | null; history?: MySms[] }, viewing = false) {
  const view = { name: 'Sara', personnelNo: '124', expiresAt: new Date(Date.now() + 3_600_000).toISOString() };
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ViewAsProvider value={viewing ? view : null}>
        <SmsMobileCard initial={props.initial} history={props.history ?? []} />
      </ViewAsProvider>
    </NextIntlClientProvider>
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('Profile › Mobile for SMS (FR-96)', () => {
  it('shows the number as text with Edit, no input', () => {
    wrap({ initial: '09121112233' });
    expect(screen.getByTestId('sms-mobile-current').textContent).toContain('09121112233');
    expect(screen.queryByTestId('sms-mobile-input')).toBeNull();
    expect(screen.getByTestId('sms-mobile-edit').textContent).toContain('Edit');
  });

  it('offers Add number when there is none', () => {
    wrap({ initial: null });
    expect(screen.getByTestId('sms-mobile-edit').textContent).toContain('Add number');
  });

  it('Edit swaps in the input; Save stays disabled until the value changes', () => {
    wrap({ initial: '09121112233' });
    fireEvent.click(screen.getByTestId('sms-mobile-edit'));
    const input = screen.getByTestId('sms-mobile-input') as HTMLInputElement;
    const save = screen.getByTestId('sms-mobile-save') as HTMLButtonElement;
    expect(input.value).toBe('09121112233');
    expect(save.disabled).toBe(true);
    fireEvent.change(input, { target: { value: '0912 111 2233' } });
    expect(save.disabled).toBe(true); // same number once normalized
    fireEvent.change(input, { target: { value: '09351234567' } });
    expect(save.disabled).toBe(false);
  });

  it('Discard drops the change and returns to text', () => {
    wrap({ initial: '09121112233' });
    fireEvent.click(screen.getByTestId('sms-mobile-edit'));
    fireEvent.change(screen.getByTestId('sms-mobile-input'), { target: { value: '09351234567' } });
    fireEvent.click(screen.getByTestId('sms-mobile-discard'));
    expect(screen.queryByTestId('sms-mobile-input')).toBeNull();
    expect(screen.getByTestId('sms-mobile-current').textContent).toContain('09121112233');
    expect(mocks.setMyMobile).not.toHaveBeenCalled();
  });

  it('saves after confirmation and returns to text with the new number', async () => {
    mocks.setMyMobile.mockResolvedValue({ ok: true, mobile: '09351234567' });
    wrap({ initial: '09121112233' });
    fireEvent.click(screen.getByTestId('sms-mobile-edit'));
    fireEvent.change(screen.getByTestId('sms-mobile-input'), { target: { value: '09351234567' } });
    fireEvent.click(screen.getByTestId('sms-mobile-save'));
    expect(screen.getByTestId('sms-mobile-confirm-number').textContent).toBe('09351234567');
    fireEvent.click(screen.getByTestId('sms-mobile-confirm'));
    await waitFor(() => expect(screen.queryByTestId('sms-mobile-input')).toBeNull());
    expect(mocks.setMyMobile).toHaveBeenCalledWith('09351234567');
    expect(screen.getByTestId('sms-mobile-current').textContent).toContain('09351234567');
  });

  it('Edit is disabled while viewing as someone else', () => {
    wrap({ initial: '09121112233' }, true);
    expect((screen.getByTestId('sms-mobile-edit') as HTMLButtonElement).disabled).toBe(true);
  });

  it('lists recent texts with their status, or an empty note', () => {
    wrap({ initial: '09121112233', history: [sms('a', 'sent', 'Your leave was approved'), sms('b', 'failed', 'New request')] });
    const rows = screen.getAllByTestId('sms-history-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Your leave was approved');
    expect(rows[0].textContent).toContain('Sent');
    expect(rows[1].textContent).toContain('Not delivered');
    cleanup();
    wrap({ initial: '09121112233' });
    expect(screen.getByTestId('sms-history').textContent).toContain('No texts sent to you yet.');
  });
});
