import { describe, expect, it } from 'vitest';
import { contentDisposition } from '@/lib/files/contentDisposition';

describe('contentDisposition', () => {
  it('encodes Persian names with quotes safely', () => {
    const name = 'قرارداد "نهایی".pdf';
    const h = contentDisposition(name);
    expect(h.startsWith('attachment; filename="')).toBe(true);
    expect(h).toContain("filename*=UTF-8''" + encodeURIComponent(name));
    const fallback = /filename="([^"]*)"/.exec(h)![1];
    expect(fallback).toMatch(/^[\x20-\x7e]*$/);
    expect(fallback).not.toContain('"');
  });
  it('removes newlines and encodes RFC 5987 specials', () => {
    const h = contentDisposition("a\r\nb'(1)*.txt");
    expect(h).not.toMatch(/[\r\n]/);
    expect(h).toContain("filename*=UTF-8''ab%27%281%29%2A.txt");
  });
});
