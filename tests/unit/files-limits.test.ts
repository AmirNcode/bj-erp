import { describe, expect, it } from 'vitest';
import { checkDeclaredSize, cleanFileName, TooLargeError } from '@/lib/files/limits';

describe('checkDeclaredSize', () => {
  it('accepts the cap, refuses above and zero', () => {
    expect(() => checkDeclaredSize(52428800)).not.toThrow();
    expect(() => checkDeclaredSize(52428801)).toThrow(TooLargeError);
    expect(() => checkDeclaredSize(0)).toThrow();
    expect(() => checkDeclaredSize(NaN)).toThrow();
  });
});

describe('cleanFileName', () => {
  it('keeps only the basename and drops control characters', () => {
    expect(cleanFileName('../../x.pdf')).toBe('x.pdf');
    expect(cleanFileName('a\\b\nc.txt')).toBe('bc.txt');
    expect(cleanFileName('')).toBe('file');
    expect(cleanFileName('dir/')).toBe('file');
    expect(cleanFileName('قرارداد "نهایی".pdf')).toBe('قرارداد "نهایی".pdf');
    expect(cleanFileName('x'.repeat(300)).length).toBe(255);
  });
});
