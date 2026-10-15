/**
 * Who the caller may bulk-reset a password for (FR-55 review, Medium 2).
 *
 * The rule lives in one place, the database: `private.can_reset_password`
 * (migration 20261013200006), which both reset RPCs enforce. The Employees list
 * asks `app_password_reset_eligible` for the rows on screen and offers a checkbox
 * only on those, so a selection holds nobody the bulk RPC would refuse. A change
 * to the rule (the account-control decision) reaches the list without touching
 * this file. The RPCs stay authoritative: this only shapes the UI.
 */

import type { createClient } from '@/lib/supabase/server';

type Client = Awaited<ReturnType<typeof createClient>>;

/** The ids among `ids` the caller may bulk-reset; empty on any error (fails closed). */
export async function passwordResetEligibleIds(supabase: Client, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await supabase.rpc('app_password_reset_eligible', { p_ids: ids });
  if (error || !Array.isArray(data)) return new Set();
  return new Set(data.filter((id): id is string => typeof id === 'string'));
}

/** The rows a bulk selection may contain, in list order (row checkboxes and select-all). */
export function resetSelectableIds(rows: { id: string; canReset: boolean }[]): string[] {
  return rows.filter((r) => r.canReset).map((r) => r.id);
}
