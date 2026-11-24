import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const status = { pending: false };
vi.mock('next/link', () => ({ useLinkStatus: () => status }));

import { LinkPending } from '@/components/LinkPending';

afterEach(() => {
  cleanup();
  status.pending = false;
});

describe('LinkPending', () => {
  it('renders a hidden hint when idle', () => {
    const { container } = render(<LinkPending />);
    const s = container.querySelector('[data-slot="link-pending"]')!;
    expect(s.getAttribute('data-pending')).toBe('false');
    expect(s.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows the hint while the link is pending', () => {
    status.pending = true;
    const { container } = render(<LinkPending />);
    expect(container.querySelector('[data-slot="link-pending"]')!.getAttribute('data-pending')).toBe('true');
  });
});
