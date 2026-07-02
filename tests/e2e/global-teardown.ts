/**
 * Playwright global teardown: delete the throwaway employees this run created
 * (codes like mgr<ts>/emp<ts>/ov<ts>/…) via the admin-guarded
 * app_cleanup_e2e_users() RPC, so repeated runs don't pollute the shared demo
 * project. Delegates to scripts/cleanup-e2e.mjs (single source of truth).
 *
 * Best-effort: a cleanup failure must not fail an otherwise green suite.
 */

import { execFileSync } from 'node:child_process';

export default function globalTeardown() {
  try {
    const out = execFileSync('node', ['scripts/cleanup-e2e.mjs'], {
      encoding: 'utf8',
      timeout: 60_000,
    });
    if (out.trim()) console.log(out.trim());
  } catch (err) {
    console.warn('e2e cleanup skipped:', err instanceof Error ? err.message : err);
  }
}
