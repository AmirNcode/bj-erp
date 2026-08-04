import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequestCancelButton } from '@/app/[locale]/(app)/request/_components/RequestCancelButton';
import { cancelRequest } from '@/lib/actions/leave';

const routerRefresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: routerRefresh }),
}));

vi.mock('@/lib/actions/leave', () => ({
  cancelRequest: vi.fn(async () => ({ ok: true })),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  AlertDialogCancel: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  AlertDialogAction: ({
    children,
    onClick,
    'data-testid': testId,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    'data-testid'?: string;
  }) => (
    <button type="button" onClick={onClick} data-testid={testId}>
      {children}
    </button>
  ),
}));

const messages = {
  common: { dismiss: 'Dismiss' },
  request: {
    cancel: 'Cancel',
    cancelConfirm: 'Cancel this request?',
    cancelApprovedConfirm: 'Cancel approved request?',
    cancelSuccess: 'Request cancelled.',
  },
};

function renderButton(status: string, startDate = '2099-01-01') {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <RequestCancelButton requestId="request-1" status={status} startDate={startDate} />
    </NextIntlClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('RequestCancelButton', () => {
  it('cancels a pending request and refreshes the current page', async () => {
    renderButton('pending');

    fireEvent.click(screen.getByTestId('cancel-confirm-request-1'));

    await waitFor(() => {
      expect(cancelRequest).toHaveBeenCalledWith('request-1');
      expect(routerRefresh).toHaveBeenCalled();
    });
  });

  it('does not render for rejected requests or approved requests that started', () => {
    const { rerender } = renderButton('rejected');
    expect(screen.queryByTestId('cancel-btn-request-1')).toBeNull();

    rerender(
      <NextIntlClientProvider locale="en" messages={messages}>
        <RequestCancelButton
          requestId="request-1"
          status="approved"
          startDate="2000-01-01"
        />
      </NextIntlClientProvider>
    );
    expect(screen.queryByTestId('cancel-btn-request-1')).toBeNull();
  });
});
