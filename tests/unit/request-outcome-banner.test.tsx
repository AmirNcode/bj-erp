import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequestOutcomeBanner } from '@/app/[locale]/(app)/_components/RequestOutcomeBanner';
import { getMyRequestOutcomes, type WatchedRequest } from '@/lib/actions/leave/outcomes';

const routerPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
}));

vi.mock('@/lib/actions/leave/outcomes', () => ({
  getMyRequestOutcomes: vi.fn(),
}));

const fetchOutcomes = vi.mocked(getMyRequestOutcomes);

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const messages = {
  requestOutcome: {
    approved: 'Your request {label} was approved.',
    rejected: 'Your request {label} was rejected.',
    reason: 'Reason: {note}',
    show: 'Show',
  },
};

async function renderBanner(pending: WatchedRequest[]) {
  const ui = (list: WatchedRequest[]) => (
    <NextIntlClientProvider locale="en" messages={messages}>
      <RequestOutcomeBanner pending={Promise.resolve(list)} pollMs={1000} />
    </NextIntlClientProvider>
  );
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(ui(pending));
  });
  return {
    ...view,
    rerenderPending: async (next: WatchedRequest[]) => {
      await act(async () => {
        view.rerender(ui(next));
      });
    },
  };
}

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('RequestOutcomeBanner', () => {
  it('does not poll when nothing is pending', async () => {
    await renderBanner([]);
    await tick(3000);
    expect(fetchOutcomes).not.toHaveBeenCalled();
  });

  it('stays hidden while requests are still pending', async () => {
    fetchOutcomes.mockResolvedValue({ ok: true, outcomes: [] });
    await renderBanner([{ id: A, label: 'Annual (2026/10/14)' }]);

    await tick(1000);

    expect(fetchOutcomes).toHaveBeenCalledWith([A]);
    expect(screen.queryByTestId('request-outcome-banner')).toBeNull();
  });

  it('shows approvals and rejections, with the rejection reason', async () => {
    fetchOutcomes.mockResolvedValue({
      ok: true,
      outcomes: [
        { id: A, status: 'approved', note: null },
        { id: B, status: 'rejected', note: 'Short-staffed that week' },
      ],
    });
    await renderBanner([
      { id: A, label: 'Annual (2026/10/14)' },
      { id: B, label: 'Errand (2026/10/20)' },
    ]);

    await tick(1000);

    expect(screen.getByTestId(`request-outcome-${A}`).textContent).toContain(
      'Your request Annual (2026/10/14) was approved.'
    );
    const rejected = screen.getByTestId(`request-outcome-${B}`).textContent;
    expect(rejected).toContain('Your request Errand (2026/10/20) was rejected.');
    expect(rejected).toContain('Reason: Short-staffed that week');
  });

  it('stays after a refresh drops the request, until Show; then opens My Requests and never re-shows it', async () => {
    fetchOutcomes.mockResolvedValue({ ok: true, outcomes: [{ id: A, status: 'approved', note: null }] });
    const { rerenderPending } = await renderBanner([{ id: A, label: 'Annual (2026/10/14)' }]);
    await tick(1000);

    await rerenderPending([]);
    expect(screen.getByTestId('request-outcome-banner')).toBeTruthy();

    fireEvent.click(screen.getByTestId('request-outcome-show'));
    expect(routerPush).toHaveBeenCalledWith('/en/request?all=1');
    expect(screen.queryByTestId('request-outcome-banner')).toBeNull();

    // Even if a slow refresh still lists it as pending, it is not polled again.
    await rerenderPending([{ id: A, label: 'Annual (2026/10/14)' }]);
    fetchOutcomes.mockClear();
    await tick(3000);
    expect(fetchOutcomes).not.toHaveBeenCalled();
    expect(screen.queryByTestId('request-outcome-banner')).toBeNull();
  });
});
