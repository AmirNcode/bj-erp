import { describe, it, expect } from 'vitest';
import { parseCsv, buildCsv } from '@/lib/csv/parse';

describe('parseCsv', () => {
  it('splits simple rows', () => {
    expect(parseCsv('a,b\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('handles CRLF and trailing newline', () => {
    expect(parseCsv('a,b\r\nc,d\r\n')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('strips the Excel BOM', () => {
    expect(parseCsv('﻿a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('handles quoted fields with commas and escaped quotes', () => {
    expect(parseCsv('"x, y",b\n"He said ""hi""",z')).toEqual([
      ['x, y', 'b'],
      ['He said "hi"', 'z'],
    ]);
  });

  it('keeps newlines inside quoted fields', () => {
    expect(parseCsv('"line1\nline2",b')).toEqual([['line1\nline2', 'b']]);
  });

  it('skips fully empty rows', () => {
    expect(parseCsv('a,b\n\n ,\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
  });
});

describe('buildCsv', () => {
  it('starts with a BOM and quotes only when needed', () => {
    const out = buildCsv([['نام', 'x,y'], ['ali', 'plain']]);
    expect(out.charCodeAt(0)).toBe(0xfeff);
    expect(out).toContain('نام,"x,y"');
    expect(out).toContain('ali,plain');
  });

  it('round-trips through parseCsv', () => {
    const rows = [['a"b', 'c,d'], ['سلام', '۱۲']];
    expect(parseCsv(buildCsv(rows))).toEqual(rows);
  });
});
