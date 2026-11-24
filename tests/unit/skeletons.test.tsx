import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TableSkeleton } from '@/components/Skeletons';

afterEach(cleanup);

describe('TableSkeleton', () => {
  it('draws a data-table with the asked rows and cols', () => {
    const { container } = render(<TableSkeleton rows={4} cols={3} />);
    expect(container.querySelector('table.data-table')).not.toBeNull();
    expect(container.querySelectorAll('tbody tr').length).toBe(4);
    expect(container.querySelectorAll('tbody tr:first-child td').length).toBe(3);
  });

  it('is hidden from screen readers', () => {
    const { container } = render(<TableSkeleton />);
    expect(container.firstElementChild!.getAttribute('aria-hidden')).toBe('true');
  });
});
