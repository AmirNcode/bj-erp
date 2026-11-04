import { describe, expect, it } from 'vitest';
import {
  PHOTO_MAX_LENGTH,
  QUALITY_STEPS,
  clampArea,
  encodeWithinLimit,
  fitWithin,
  isValidPhotoData,
} from '@/lib/photo/process';
import { avatarColor, initials } from '@/lib/photo/initials';

/** A JPEG-shaped data URL of exactly `length` characters (base64 part a multiple of 4). */
function jpeg(length: number) {
  const prefix = 'data:image/jpeg;base64,/9j/';
  const body = length - prefix.length;
  return prefix + 'A'.repeat(body - ((body + 4) % 4));
}

describe('isValidPhotoData', () => {
  it('accepts a JPEG data URL', () => expect(isValidPhotoData(jpeg(2000))).toBe(true));
  it('refuses PNG', () =>
    expect(isValidPhotoData('data:image/png;base64,iVBORw0KGgo' + 'A'.repeat(2000))).toBe(false));
  it('refuses over 80 000 characters', () => expect(isValidPhotoData(jpeg(80_004))).toBe(false));
  it('refuses tiny input', () => expect(isValidPhotoData(jpeg(100))).toBe(false));
  it('refuses junk', () => expect(isValidPhotoData(jpeg(2000) + '<x>')).toBe(false));
  it('refuses non-strings', () => expect(isValidPhotoData(null)).toBe(false));
});

describe('fitWithin', () => {
  it('scales a 48 MP selfie to the preview size', () =>
    expect(fitWithin(8000, 6000, 2048)).toEqual({ width: 2048, height: 1536 }));
  it('scales portrait on the long side', () =>
    expect(fitWithin(6000, 8000, 2048)).toEqual({ width: 1536, height: 2048 }));
  it('never upscales', () => expect(fitWithin(640, 480, 2048)).toEqual({ width: 640, height: 480 }));
});

describe('clampArea', () => {
  it('keeps the area inside the image', () =>
    expect(clampArea({ x: -3.2, y: 10.4, width: 600, height: 600 }, 500, 400)).toEqual({
      x: 0,
      y: 10,
      width: 500,
      height: 390,
    }));
});

describe('encodeWithinLimit', () => {
  it('stops at the first quality that fits', () => {
    const tried: number[] = [];
    const res = encodeWithinLimit((q) => {
      tried.push(q);
      return q > 0.7 ? jpeg(PHOTO_MAX_LENGTH + 400) : jpeg(20_000);
    });
    expect(res.ok).toBe(true);
    expect(tried).toEqual([0.85, 0.75, 0.65]);
  });
  it('gives up when even the lowest quality is too big', () => {
    let calls = 0;
    const res = encodeWithinLimit(() => {
      calls++;
      return jpeg(PHOTO_MAX_LENGTH + 400);
    });
    expect(res).toEqual({ ok: false, reason: 'tooLarge' });
    expect(calls).toBe(QUALITY_STEPS.length);
  });
  it('reports a browser that ignores the JPEG request', () =>
    expect(encodeWithinLimit(() => 'data:image/png;base64,iVBOR')).toEqual({ ok: false, reason: 'unsupported' }));
});

describe('initials', () => {
  it('takes first and last word', () => expect(initials('علی رضایی')).toBe('ع\u200cر'));
  it('skips the middle words', () => expect(initials('Mohammad Ali Karimi')).toBe('M\u200cK'));
  it('single word', () => expect(initials('admin')).toBe('A'));
  it('empty', () => expect(initials('  ')).toBe('؟'));
});

describe('avatarColor', () => {
  it('is stable per id', () => expect(avatarColor('abc')).toBe(avatarColor('abc')));
});
