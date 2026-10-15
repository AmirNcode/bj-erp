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
  it('opens with the focus on the person search', async () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <TransferAdminDialog locale="en" />
      </NextIntlClientProvider>
    );
    fireEvent.click(screen.getByTestId('transfer-admin'));
    const search = await screen.findByTestId('transfer-person');
    await waitFor(() => expect(document.activeElement).toBe(search));
  });

  it('a person shown by employee code (no personnel number) gets a text keyboard', async () => {
    vi.mocked(listTransferCandidates).mockResolvedValueOnce({
      ok: true,
      people: [{ id: 'boot', name: 'System admin', personnelNo: 'admin' }],
    });
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <TransferAdminDialog locale="en" />
      </NextIntlClientProvider>
    );
    fireEvent.click(screen.getByTestId('transfer-admin'));
    const search = await screen.findByTestId('transfer-person');
    expect(screen.getByTestId('transfer-personnel-no').getAttribute('inputmode')).toBe('numeric');
    fireEvent.change(search, { target: { value: 'System' } });
    fireEvent.click(await screen.findByTestId('transfer-person-option'));
    expect(screen.getByTestId('transfer-personnel-no').getAttribute('inputmode')).toBe('text');
  });

  it('shows a wrong-password refusal under the password field', async () => {
    vi.mocked(transferAdmin).mockResolvedValueOnce({ ok: false, error: 'Wrong password.', field: 'password' });
    await openAndPick();
    fireEvent.change(screen.getByTestId('transfer-personnel-no'), { target: { value: '1201' } });
    fireEvent.change(screen.getByTestId('transfer-password'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByTestId('transfer-confirm'));
    expect((await screen.findByTestId('transfer-password-error')).textContent).toBe('Wrong password.');
    expect(screen.queryByTestId('transfer-error')).toBeNull();
  });

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

  describe('Farsi-keyboard input is normalized the way login and change-password do it', () => {
    const fieldValue = (testId: string) => (screen.getByTestId(testId) as HTMLInputElement).value;

    // Fills both fields, records what they show (the dialog closes on success), confirms.
    async function submit(personnelNo: string, password: string) {
      fireEvent.change(screen.getByTestId('transfer-personnel-no'), { target: { value: personnelNo } });
      fireEvent.change(screen.getByTestId('transfer-password'), { target: { value: password } });
      const shown = { personnelNo: fieldValue('transfer-personnel-no'), password: fieldValue('transfer-password') };
      fireEvent.click(screen.getByTestId('transfer-confirm'));
      await waitFor(() => expect(transferAdmin).toHaveBeenCalledTimes(1));
      return shown;
    }

    it('sends a password typed on a Persian layout as its latin form', async () => {
      await openAndPick();
      // Persian digits are what the layout emits for 1-2-3; a Persian letter (ش) can
      // never be in a stored password and is dropped, as toLatinPassword does.
      const shown = await submit('1201', 'Secret۱۲۳ش');
      expect(transferAdmin).toHaveBeenCalledWith({ targetId: 'p1', personnelNo: '1201', password: 'Secret123' });
      // The field holds what is sent.
      expect(shown.password).toBe('Secret123');
    });

    it('sends Persian digits in the personnel number as ASCII', async () => {
      await openAndPick();
      const shown = await submit(' ۱۲۰۱ ', 'secret');
      expect(transferAdmin).toHaveBeenCalledWith({ targetId: 'p1', personnelNo: '1201', password: 'secret' });
      expect(shown.personnelNo).toBe(' 1201 ');
    });

    it('sends Arabic-Indic digits in the personnel number as ASCII', async () => {
      await openAndPick();
      await submit('١٢٠١', 'secret');
      expect(transferAdmin).toHaveBeenCalledWith({ targetId: 'p1', personnelNo: '1201', password: 'secret' });
    });

    it('passes ordinary latin password and ASCII digits through unchanged', async () => {
      await openAndPick();
      await submit('1201', 'Pa ss!w0rd~');
      expect(transferAdmin).toHaveBeenCalledWith({ targetId: 'p1', personnelNo: '1201', password: 'Pa ss!w0rd~' });
    });

    it('sends a letter employee code (no personnel number) unchanged', async () => {
      vi.mocked(listTransferCandidates).mockResolvedValueOnce({
        ok: true,
        people: [{ id: 'boot', name: 'System admin', personnelNo: 'admin' }],
      });
      render(
        <NextIntlClientProvider locale="en" messages={en}>
          <TransferAdminDialog locale="en" />
        </NextIntlClientProvider>
      );
      fireEvent.click(screen.getByTestId('transfer-admin'));
      const search = await screen.findByTestId('transfer-person');
      fireEvent.change(search, { target: { value: 'System' } });
      fireEvent.click(await screen.findByTestId('transfer-person-option'));
      await submit(' admin ', 'secret');
      expect(transferAdmin).toHaveBeenCalledWith({ targetId: 'boot', personnelNo: 'admin', password: 'secret' });
    });
  });
});
