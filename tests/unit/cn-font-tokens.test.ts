import { describe, expect, it } from 'vitest';
import { cn } from '@/lib/utils';

describe('cn keeps the custom font-size tokens', () => {
  it.each(['text-10', 'text-11', 'text-13', 'text-15'])('%s survives a following colour class', (size) => {
    expect(cn(size, 'text-muted-foreground').split(' ')).toEqual([size, 'text-muted-foreground']);
    expect(cn(size, 'font-semibold text-primary')).toContain(size);
  });

  it('a later size still replaces an earlier one', () => {
    expect(cn('text-13', 'text-sm')).toBe('text-sm');
    expect(cn('text-sm', 'text-11')).toBe('text-11');
  });
});
