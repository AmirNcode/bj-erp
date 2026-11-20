import { describe, expect, it } from 'vitest';
import { applyProductDefaults, productName, type ProductRowValues } from '@/lib/sales/products';
import type { Product } from '@/lib/sales/types';

const gate: Product = {
  id: 'p1', code: 'GV', name_fa: 'شیر دروازه‌ای', name_en: 'Gate valve', active: true, position: 1, used_count: 0,
  fields: [
    { field: 'size', default: '12in' },
    { field: 'x_body', default: 'WCB' },
    { field: 'qty', default: 5 },
    { field: 'unit', default: null },
  ],
};
const empty: ProductRowValues = { product_type: '', size: '6in', rating: '', qty: null, unit: '', custom: {} };

describe('applyProductDefaults', () => {
  it('fills empty cells only and keeps typed values', () => {
    const out = applyProductDefaults(empty, gate);
    expect(out.size).toBe('6in');
    expect(out.custom.x_body).toBe('WCB');
    expect(out.qty).toBe(5);
    expect(out.unit).toBe('');
    expect(out.product_id).toBe('p1');
    expect(out.product_type).toBe('Gate valve');
  });
  it('counts an empty string or null as empty, but 0 and false as filled', () => {
    const out = applyProductDefaults({ ...empty, qty: 0, custom: { x_body: '' } }, gate);
    expect(out.qty).toBe(0);
    expect(out.custom.x_body).toBe('WCB');
    const flag: Product = { ...gate, fields: [{ field: 'x_flag', default: true }, { field: 'x_n', default: 9 }] };
    const kept = applyProductDefaults({ ...empty, custom: { x_flag: false, x_n: 0 } }, flag);
    expect(kept.custom).toEqual({ x_flag: false, x_n: 0 });
  });
  it('does not change its input', () => {
    const before = JSON.stringify(empty);
    applyProductDefaults(empty, gate);
    expect(JSON.stringify(empty)).toBe(before);
  });
  it('falls back to the Persian name when there is no English one', () => {
    expect(productName({ ...gate, name_en: '' })).toBe('شیر دروازه‌ای');
  });
});
