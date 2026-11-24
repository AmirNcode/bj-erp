import { cache } from 'react';
import { getCachedClaims, getCachedProfile } from '@/lib/auth/context';
import { getViewAs } from '@/lib/auth/viewAs';
import { createRealClient } from '@/lib/supabase/server';
import { isFontStep, type FontStep } from '@/lib/prefs/fontScale';

/**
 * The signed-in person's saved text size. Reads with the admin's own identity
 * (`createRealClient`), so View as keeps the admin's size, not the viewed
 * person's. Any failure falls back to step 0.
 */
export const getOwnFontStep = cache(async (): Promise<FontStep> => {
  try {
    // Claims stay the admin's own during View as; no GoTrue round trip.
    const claims = await getCachedClaims();
    const uid = claims?.sub;
    if (!uid) return 0;
    // No live View as: the request client is the person's own, and the profile
    // row is already cached for this request.
    const view = await getViewAs();
    if (!view || view.status !== 'live') {
      const profile = await getCachedProfile(uid);
      const step = profile?.font_step;
      return isFontStep(step) ? step : 0;
    }
    const supabase = await createRealClient();
    const { data, error } = await supabase
      .from('profiles')
      .select('font_step')
      .eq('id', uid)
      .single();
    if (error || !data) return 0;
    return isFontStep(data.font_step) ? data.font_step : 0;
  } catch {
    return 0;
  }
});
