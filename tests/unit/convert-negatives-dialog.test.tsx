import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { ConvertNegativesDialog } from '@/app/[locale]/(app)/manage/employees/ConvertNegativesDialog';
import { convertNegatives, getNegativeBalances } from '@/lib/actions/leave/unpaidConversions';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/actions/leave/unpaidConversions', () => ({
  getNegativeBalances: vi.fn(),
  convertNegatives: vi.fn(async () => ({ ok: true, converted: 2 })),
}));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const row = (id: string, name: string, balanceMinutes: number) => ({
  employeeId: id, fullName: name, personnelNo: id.toUpperCase(), departmentName: 'Ops', balanceMinutes,
});

function open(rows: ReturnType<typeof row>[]) {
  vi.mocked(getNegativeBalances).mockResolvedValue({ ok: true, rows });
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ConvertNegativesDialog hoursPerDay={8} />
    </NextIntlClientProvider>
  );
  fireEvent.click(screen.getByTestId('convert-negatives-open'));
}

describe('ConvertNegativesDialog', () => {
  it('selects all, unticks one, confirms with count and total, converts exactly the two ids', async () => {
    open([row('a1', 'Ana', -480), row('b2', 'Bob', -960), row('c3', 'Cy', -240)]);
    await screen.findByText('Ana');
    expect(getNegativeBalances).toHaveBeenCalled();
    const convert = screen.getByTestId('convert-negatives-submit');
    expect((convert as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('convert-select-all'));
    fireEvent.click(screen.getByTestId('convert-row-c3'));
    fireEvent.click(convert);
    const body = await screen.findByTestId('convert-confirm-body');
    expect(body.textContent).toContain('Convert 2 people');
    expect(body.textContent).toContain('3 days');
    fireEvent.click(screen.getByTestId('convert-confirm'));
    await waitFor(() => expect(convertNegatives).toHaveBeenCalledWith(['a1', 'b2']));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('says so when nobody is negative', async () => {
    open([]);
    expect((await screen.findByTestId('convert-empty')).textContent).toBe('No one has a negative balance.');
  });
});
