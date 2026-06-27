import { describe, it, expect } from 'vitest';
import { isCancellable } from '@/lib/leave/cancellable';

const TODAY = '2026-06-26';

describe('isCancellable', () => {
  it('pending is always cancellable', () => {
    expect(isCancellable('pending', '2026-06-01', TODAY)).toBe(true); // even past pending
    expect(isCancellable('pending', '2026-07-01', TODAY)).toBe(true);
  });
  it('approved is cancellable only before it starts', () => {
    expect(isCancellable('approved', '2026-06-27', TODAY)).toBe(true); // future
    expect(isCancellable('approved', '2026-06-26', TODAY)).toBe(false); // starts today
    expect(isCancellable('approved', '2026-06-20', TODAY)).toBe(false); // already started/past
  });
  it('rejected and cancelled are never cancellable', () => {
    expect(isCancellable('rejected', '2026-07-01', TODAY)).toBe(false);
    expect(isCancellable('cancelled', '2026-07-01', TODAY)).toBe(false);
  });
});
