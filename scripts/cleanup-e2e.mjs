// =============================================================================
// scripts/cleanup-e2e.mjs — delete e2e throwaway users from the target project.
//
// Signs in as the admin and calls the admin-guarded app_cleanup_e2e_users()
// RPC (no service_role secret). The RPC only matches hardcoded test-code
// patterns (mgr/emp/cxl/auth/peer/lv/non/ov/e2e/set + 13-digit timestamp, or
// set/pwd + 6 digits), so real accounts can never be deleted.
//
// Run:  npm run cleanup:e2e        (reads .env.local for the Supabase URL/key)
// Also invoked automatically by the Playwright global teardown after e2e runs.
// =============================================================================

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

// --- minimal .env.local loader (no dotenv dep; run from the project root) ----
try {
  const txt = readFileSync('.env.local', 'utf8');
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_.]+)\s*=\s*(.*)\s*$/i);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
  }
} catch {
  /* env may already be in the environment */
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!URL || !ANON) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY');
  process.exit(1);
}

const ADMIN_CODE = process.env.E2E_ADMIN_CODE ?? 'admin';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Admin!2026';

const supa = createClient(URL, ANON, { auth: { persistSession: false } });

const { error: signErr } = await supa.auth.signInWithPassword({
  email: `${ADMIN_CODE.trim().toLowerCase()}@bj-app.internal`,
  password: ADMIN_PASSWORD,
});
if (signErr) {
  console.error('cleanup-e2e: admin sign-in failed:', signErr.message);
  process.exit(1);
}

const { data, error } = await supa.rpc('app_cleanup_e2e_users');
if (error) {
  console.error('cleanup-e2e: RPC failed:', error.message);
  process.exit(1);
}
console.log(`cleanup-e2e: deleted ${data} throwaway e2e user(s).`);

// --- throwaway departments (department.spec) --------------------------------
// Codes starting with `zz` are reserved for tests (tests/e2e/_helpers.ts
// nextTestDepartmentCode); real departments use meaningful prefixes. Runs
// after the user cleanup so no test account is left pointing at a deleted row.
// Plain DELETE under the existing departments_delete_admin RLS policy — no
// service_role, no new RPC.
const { data: deletedDepts, error: deptErr } = await supa
  .from('departments')
  .delete()
  .like('code', 'zz%')
  .select('id');
if (deptErr) {
  console.warn('cleanup-e2e: department cleanup skipped:', deptErr.message);
} else {
  console.log(`cleanup-e2e: deleted ${deletedDepts?.length ?? 0} throwaway e2e department(s).`);
}
