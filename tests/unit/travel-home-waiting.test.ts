import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import fa from '@/messages/fa.json';

// FR-70 review: procurement's Home line is an ICU plural, given the raw count
// (TravelBookingCard), so ICU picks the form and localizes the digits.
describe('travel.homeWaiting', () => {
  const tEn = createTranslator({ locale: 'en', messages: en, namespace: 'travel' });
  const tFa = createTranslator({ locale: 'fa', messages: fa, namespace: 'travel' });

  it('is singular for one trip and plural otherwise in English', () => {
    expect(tEn('homeWaiting', { count: 1 })).toBe('1 trip waiting on procurement');
    expect(tEn('homeWaiting', { count: 3 })).toBe('3 trips waiting on procurement');
    expect(tEn('homeWaiting', { count: 1200 })).toBe('1,200 trips waiting on procurement');
  });

  it('renders Persian digits in Farsi', () => {
    expect(tFa('homeWaiting', { count: 1 })).toBe('۱ ماموریت در انتظار تدارکات');
    expect(tFa('homeWaiting', { count: 12 })).toBe('۱۲ ماموریت در انتظار تدارکات');
  });
});
