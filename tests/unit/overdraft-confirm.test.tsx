import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OverdraftConfirm } from '@/app/[locale]/(app)/request/_components/OverdraftConfirm';
import en from '@/messages/en.json';

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div>{children}</div> : null,
  AlertDialogContent: ({ children, ...rest }: { children: React.ReactNode }) => (
    <div {...rest}>{children}</div>
  ),
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  AlertDialogCancel: ({
    children,
    onClick,
    ...rest
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick} {...rest}>
      {children}
    </button>
  ),
  AlertDialogAction: ({
    children,
    onClick,
    ...rest
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick} {...rest}>
      {children}
    </button>
  ),
}));

function setup(props: Partial<Parameters<typeof OverdraftConfirm>[0]> = {}) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ leaveBalance: en.leaveBalance }}>
      <OverdraftConfirm
        open
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
        overLabel="3 days"
        availableLabel="2 days"
        afterLabel="-3 days"
        {...props}
      />
    </NextIntlClientProvider>
  );
  return { onConfirm, onOpenChange };
}

describe('OverdraftConfirm', () => {
  afterEach(cleanup);

  it('states the over amount, the available balance and the balance after', () => {
    setup();
    const body = screen.getByTestId('overdraft-confirm').textContent ?? '';
    expect(body).toContain('3 days');
    expect(body).toContain('2 days');
    expect(body).toContain('-3 days');
    expect(body).toContain('Request more than your balance?');
  });

  it('sends on confirm', () => {
    const { onConfirm, onOpenChange } = setup();
    fireEvent.click(screen.getByTestId('overdraft-confirm-send'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('goes back without sending', () => {
    const { onConfirm, onOpenChange } = setup();
    fireEvent.click(screen.getByTestId('overdraft-confirm-back'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
