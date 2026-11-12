import { describe, it, expect } from 'vitest';
import { parseCsv, buildCsv, guardCsvCell } from '@/lib/csv/parse';

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

  it('guards cells that spreadsheets would run as formulas', () => {
    const out = buildCsv([['=SUM(A1)', '+98912', '@x', '-cmd', '\tx', '-3', '-1.5', 'a=b', '']]);
    expect(out).toContain("'=SUM(A1),'+98912,'@x,'-cmd,'\tx,-3,-1.5,a=b,");
  });

  it('leaves plain negative numbers and ordinary text alone', () => {
    expect(guardCsvCell('-12')).toBe('-12');
    expect(guardCsvCell('-12.5')).toBe('-12.5');
    expect(guardCsvCell('-')).toBe("'-");
    expect(guardCsvCell('-5%')).toBe("'-5%");
    expect(guardCsvCell('علی')).toBe('علی');
  });

  it('parseCsv strips the guard, so an exported file re-imports unchanged', () => {
    const rows = [['=1+1', '+98912', '@x', '-cmd', 'plain', '-3']];
    expect(parseCsv(buildCsv(rows))).toEqual(rows);
  });

  it('can skip the guard for machine-generated values', () => {
    expect(buildCsv([['@Ab3$x']], { guard: false })).toContain('@Ab3$x');
    expect(buildCsv([['@Ab3$x']], { guard: false })).not.toContain("'@");
  });
});
