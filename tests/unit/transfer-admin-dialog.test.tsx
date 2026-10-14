import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { TransferAdminDialog } from '@/app/[locale]/(app)/settings/roles/_components/TransferAdminDialog';
import { listTransferCandidates, transferAdmin } from '@/lib/actions/roles';

const replace = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh }) }));
vi.mock('@/lib/actions/roles', () => ({
  listTransferCandidates: vi.fn(async () => ({
    ok: true,
    people: [
      { id: 'p1', name: 'Sara Ahmadi', personnelNo: '1201' },
      { id: 'p2', name: 'Reza Karimi', personnelNo: '1305' },
    ],
  })),
  transferAdmin: vi.fn(async () => ({ ok: true })),
}));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const confirmDisabled = () => (screen.getByTestId('transfer-confirm') as HTMLButtonElement).disabled;

async function openAndPick() {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TransferAdminDialog locale="en" />
    </NextIntlClientProvider>
  );
  fireEvent.click(screen.getByTestId('transfer-admin'));
  await waitFor(() => expect(listTransferCandidates).toHaveBeenCalled());
  const search = await screen.findByTestId('transfer-person');
  // "Sar" matches one person, so PersonSearch would auto-pick after a pause; pick
  // directly from the list instead.
  fireEvent.focus(search);
  fireEvent.change(search, { target: { value: 'a' } });
  fireEvent.change(search, { target: { value: 'ar' } });
  const options = await screen.findAllByTestId('transfer-person-option');
  fireEvent.click(options.find((o) => o.textContent?.includes('Sara'))!);
}

describe('TransferAdminDialog', () => {
  it('keeps confirm disabled until person, personnel number and password are all filled', async () => {
    await openAndPick();
    expect(confirmDisabled()).toBe(true);
    fireEvent.change(screen.getByTestId('transfer-personnel-no'), { target: { value: '1201' } });
    expect(confirmDisabled()).toBe(true);
    fireEvent.change(screen.getByTestId('transfer-password'), { target: { value: 'secret' } });
    expect(confirmDisabled()).toBe(false);
    fireEvent.change(screen.getByTestId('transfer-personnel-no'), { target: { value: '  ' } });
    expect(confirmDisabled()).toBe(true);
    expect(screen.getByTestId('transfer-warning').textContent).toBe(en.rolesAdmin.transfer.warning);
  });

  it('transfers and goes home', async () => {
    await openAndPick();
    fireEvent.change(screen.getByTestId('transfer-personnel-no'), { target: { value: ' 1201 ' } });
    fireEvent.change(screen.getByTestId('transfer-password'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByTestId('transfer-confirm'));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/en/home'));
    expect(refresh).toHaveBeenCalled();
    expect(transferAdmin).toHaveBeenCalledWith({ targetId: 'p1', personnelNo: '1201', password: 'secret' });
  });

  it('shows a personnel-number refusal under that field', async () => {
    vi.mocked(transferAdmin).mockResolvedValueOnce({
      ok: false,
      error: 'That personnel number does not match an active employee.',
      field: 'personnel_no',
    });
    await openAndPick();
    fireEvent.change(screen.getByTestId('transfer-personnel-no'), { target: { value: '9999' } });
    fireEvent.change(screen.getByTestId('transfer-password'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByTestId('transfer-confirm'));
    expect((await screen.findByTestId('transfer-personnel-no-error')).textContent).toBe(
      'That personnel number does not match an active employee.'
    );
    expect(screen.queryByTestId('transfer-error')).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });
});
