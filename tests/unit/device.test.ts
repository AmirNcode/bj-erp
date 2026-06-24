import { describe, it, expect } from 'vitest';
import { parseDeviceType, isMobileWidth } from '@/lib/device';

describe('parseDeviceType', () => {
  it('iPhone UA -> mobile', () => {
    expect(parseDeviceType('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile')).toBe(
      'mobile'
    );
  });
  it('Android UA -> mobile', () => {
    expect(parseDeviceType('Mozilla/5.0 (Linux; Android 14; Pixel) Mobile Safari')).toBe('mobile');
  });
  it('desktop Chrome -> desktop', () => {
    expect(parseDeviceType('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Chrome/120 Safari')).toBe(
      'desktop'
    );
  });
  it('null/undefined -> desktop (safe default)', () => {
    expect(parseDeviceType(null)).toBe('desktop');
    expect(parseDeviceType(undefined)).toBe('desktop');
  });
});

describe('isMobileWidth', () => {
  it('< 768 is mobile', () => expect(isMobileWidth(375)).toBe(true));
  it('768 is desktop (boundary)', () => expect(isMobileWidth(768)).toBe(false));
  it('1280 is desktop', () => expect(isMobileWidth(1280)).toBe(false));
  it('0 (SSR/pre-mount) -> not mobile', () => expect(isMobileWidth(0)).toBe(false));
});
