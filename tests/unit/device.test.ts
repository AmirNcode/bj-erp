import { describe, it, expect } from 'vitest';
import { parseDeviceType } from '@/lib/device';

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
