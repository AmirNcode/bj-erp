import { describe, expect, it } from 'vitest';
import { archiveDisabled, canConfirm, countsParts } from '@/lib/sales/removeDialog';

describe('sales remove dialog rules', () => {
  it('Confirm stays disabled until a choice is made', () => {
    expect(canConfirm(null, 'open')).toBe(false);
    expect(canConfirm('archive', 'open')).toBe(true);
    expect(canConfirm('delete', 'open')).toBe(true);
  });

  it('Archive is disabled on an archived record, Delete still works', () => {
    expect(archiveDisabled('archived')).toBe(true);
    expect(archiveDisabled('open')).toBe(false);
    expect(canConfirm('archive', 'archived')).toBe(false);
    expect(canConfirm('delete', 'archived')).toBe(true);
  });

  it('the counts line lists only non-zero counts and is empty when all are zero', () => {
    expect(countsParts({ items: 0, payments: 0, files: 0 })).toEqual([]);
    expect(countsParts({ items: 3, payments: 0, files: 2 })).toEqual([{ key: 'items', count: 3 }, { key: 'files', count: 2 }]);
  });
});
