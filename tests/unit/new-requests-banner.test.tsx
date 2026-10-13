import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NewRequestsBanner } from '@/app/[locale]/(app)/_components/NewRequestsBanner';
import { getPendingApprovalIds } from '@/lib/actions/leave/approvals';
import { refreshRoute } from '@/lib/actions/refresh';

const routerRefresh = vi.fn();
const routerPush = vi.fn();
let pathname = '/home';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: routerRefresh, push: routerPush }),
}));
vi.mock('@/i18n/navigation', () => ({ usePathname: () => pathname }));
vi.mock('@/lib/actions/refresh', () => ({
  refreshRoute: vi.fn(async () => ({ ok: true, refreshedAt: '2026-10-13T10:00:00.000Z' })),
}));

vi.mock('@/lib/actions/leave/approvals', () => ({
  getPendingApprovalIds: vi.fn(),
}));

const fetchIds = vi.mocked(getPendingApprovalIds);

const messages = {
  refresh: {
    newRequests: '{count, plural, one {# new request} other {# new requests}}',
    show: 'Show',
  },
};

function renderBanner(ids: string[], pollMs = 1000) {
  const ui = (current: string[]) => (
    <NextIntlClientProvider locale="en" messages={messages}>
      <NewRequestsBanner currentIds={current} pollMs={pollMs} />
    </NextIntlClientProvider>
  );
  const view = render(ui(ids));
  return { ...view, rerenderIds: (next: string[]) => view.rerender(ui(next)) };
}

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

beforeEach(() => {
  pathname = '/home';
  vi.useFakeTimers();
  setVisibility('visible');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('NewRequestsBanner', () => {
  it('stays hidden while the queue is unchanged', async () => {
    fetchIds.mockResolvedValue({ ok: true, ids: ['a', 'b'] });
    renderBanner(['a', 'b']);

    await tick(1000);

    expect(fetchIds).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('new-requests-banner')).toBeNull();
  });

  it('counts only requests the page has not shown, ignoring ones decided elsewhere', async () => {
    fetchIds.mockResolvedValue({ ok: true, ids: ['b', 'c', 'd'] });
    renderBanner(['a', 'b']);

    await tick(1000);

    expect(screen.getByTestId('new-requests-banner').textContent).toContain('2 new requests');
  });

  it('refreshes silently when a shown request leaves the queue (cancelled or decided elsewhere)', async () => {
    fetchIds.mockResolvedValue({ ok: true, ids: ['b'] });
    renderBanner(['a', 'b']);

    await tick(1000);

    expect(routerRefresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('new-requests-banner')).toBeNull();
  });

  it('does not count a request this approver just decided as new', async () => {
    fetchIds.mockResolvedValue({ ok: true, ids: ['a', 'b'] });
    const { rerenderIds } = renderBanner(['a', 'b']);
    await tick(1000);

    // Decision on 'a' → server render drops it, before the next poll.
    rerenderIds(['b']);

    expect(screen.queryByTestId('new-requests-banner')).toBeNull();
    expect(routerRefresh).not.toHaveBeenCalled();
  });

  it('on tap, drops the cached approvals page and goes there', async () => {
    fetchIds.mockResolvedValue({ ok: true, ids: ['a', 'c'] });
    renderBanner(['a']);
    await tick(1000);

    await act(async () => {
      fireEvent.click(screen.getByTestId('new-requests-banner'));
    });

    expect(refreshRoute).toHaveBeenCalledWith('/en/manage/approvals');
    expect(routerPush).toHaveBeenCalledWith('/en/manage/approvals');
    expect(routerRefresh).not.toHaveBeenCalled();
  });

  it('on the approvals page, refreshes it and takes the next server queue as the baseline', async () => {
    pathname = '/manage/approvals';
    fetchIds.mockResolvedValue({ ok: true, ids: ['a', 'c'] });
    const { rerenderIds } = renderBanner(['a']);

    await tick(1000);
    await act(async () => {
      fireEvent.click(screen.getByTestId('new-requests-banner'));
    });
    expect(routerRefresh).toHaveBeenCalledTimes(1);
    expect(routerPush).not.toHaveBeenCalled();
    expect(screen.queryByTestId('new-requests-banner')).toBeNull();

    rerenderIds(['a', 'c']);
    await tick(1000);
    expect(screen.queryByTestId('new-requests-banner')).toBeNull();
  });

  it('does not poll while the app is in the background, and checks on return', async () => {
    fetchIds.mockResolvedValue({ ok: true, ids: ['a', 'new'] });
    setVisibility('hidden');
    renderBanner(['a']);

    await tick(3000);
    expect(fetchIds).not.toHaveBeenCalled();

    setVisibility('visible');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(fetchIds).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('new-requests-banner').textContent).toContain('1 new request');
  });

  it('stays quiet when the check fails', async () => {
    fetchIds.mockRejectedValue(new Error('offline'));
    renderBanner(['a']);

    await tick(1000);

    expect(screen.queryByTestId('new-requests-banner')).toBeNull();
  });
});
