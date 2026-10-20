import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadCsv, fileDateStamp } from '@/lib/csv/download';

afterEach(() => vi.restoreAllMocks());

describe('downloadCsv', () => {
  it('clicks a download link for a BOM-prefixed CSV blob and releases its URL', async () => {
    let blob: Blob | undefined;
    URL.createObjectURL = vi.fn((b: Blob) => {
      blob = b;
      return 'blob:test';
    });
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('out.csv');
      expect(this.href).toBe('blob:test');
    });

    downloadCsv([['a', 'b,c']], 'out.csv');

    expect(click).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test');
    expect(blob?.type).toBe('text/csv;charset=utf-8');
    // Blob.text() strips a BOM, so check the bytes: EF BB BF is the UTF-8 BOM Excel needs.
    const bytes = new Uint8Array(await blob!.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes.slice(3))).toBe('a,"b,c"\r\n');
  });
});

describe('fileDateStamp', () => {
  it('is the UTC date as YYYYMMDD', () => {
    expect(fileDateStamp(new Date('2026-10-20T23:30:00Z'))).toBe('20261020');
  });
});
