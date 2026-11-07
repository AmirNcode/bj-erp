/**
 * Server-only helpers shared by the leave actions. Not a 'use server' module:
 * nothing here is callable from the browser.
 */

import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { VIEW_AS_COOKIE } from '@/lib/supabase/constants';
import type { Database } from '@/lib/supabase/types';

export type DayPart = Database['public']['Enums']['day_part'];

/**
 * Post any months this employee has earned before a balance is read (spec §6.4).
 *
 * Accrual WRITES, so it cannot live in a view or an RLS select — it has to be an
 * RPC called first. Callers that only render a balance intentionally ignore a
 * returned error (a stale number is better than a blank page). Submit callers
 * propagate it, because silently continuing could reject leave that was just
 * earned. The next attempt is safe because accrual is idempotent.
 */
export async function accrueBeforeRead(
  supabase: Awaited<ReturnType<typeof createClient>>,
  employeeId?: string
): Promise<string | null> {
  // View as (FR-86): the viewed transaction is read-only, so accrual would only
  // fail and log on every balance read. Skip it while the cookie exists.
  if ((await cookies()).get(VIEW_AS_COOKIE)?.value) return null;
  const { error } = employeeId
    ? await supabase.rpc('accrue_employee_leave', { p_employee_id: employeeId })
    : await supabase.rpc('accrue_my_leave');
  if (error) {
    console.error('[accrual] skipped:', error.message);
    return error.message;
  }
  return null;
}
