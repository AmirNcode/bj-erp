import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewAsTabSync } from '@/app/[locale]/(app)/_components/ViewAsTabSync';
import { VIEW_AS_TAB_ID, isOtherTabChange, postViewAsChange } from '@/lib/view-as/client';

/** A same-process BroadcastChannel: like the browser's, it delivers to every other object of the name. */
class FakeChannel {
  static all: FakeChannel[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  constructor(public name: string) {
    FakeChannel.all.push(this);
  }
  postMessage(data: unknown) {
    for (const ch of FakeChannel.all) if (ch !== this && ch.name === this.name) ch.onmessage?.({ data });
  }
  close() {
    FakeChannel.all = FakeChannel.all.filter((c) => c !== this);
  }
}

const reload = vi.fn();
beforeEach(() => {
  FakeChannel.all = [];
  reload.mockReset();
  vi.stubGlobal('BroadcastChannel', FakeChannel);
  vi.stubGlobal('location', { ...window.location, reload });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('view-as tab sync (FR-86)', () => {
  it('does not reload the tab that posted the change (its own start/exit navigation must win)', () => {
    render(<ViewAsTabSync />);
    postViewAsChange();
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads for a change posted by another tab', () => {
    render(<ViewAsTabSync />);
    new FakeChannel('bj-view-as').postMessage({ from: 'another-tab' });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('tells own, other and malformed messages apart', () => {
    expect(isOtherTabChange({ from: VIEW_AS_TAB_ID })).toBe(false);
    expect(isOtherTabChange({ from: 'x' })).toBe(true);
    expect(isOtherTabChange('changed')).toBe(false);
    expect(isOtherTabChange(null)).toBe(false);
  });
});
