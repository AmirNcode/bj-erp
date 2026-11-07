'use server';

import { cookies } from 'next/headers';
import { createRealClient } from '@/lib/supabase/server';
import { VIEW_AS_COOKIE, VIEW_AS_COOKIE_ATTRS } from '@/lib/supabase/constants';

/** End the view: close the session in the database, then drop the cookie either way. */
export async function endViewAs(): Promise<void> {
  const supabase = await createRealClient();
  await supabase.rpc('app_view_as_end');
  (await cookies()).delete({ name: VIEW_AS_COOKIE, path: VIEW_AS_COOKIE_ATTRS.path });
}
