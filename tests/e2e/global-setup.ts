/**
 * Playwright global setup: put the SHARED company config back to its baseline
 * before the suite runs.
 *
 * Why this exists. Two settings are company-wide, are edited by some specs, and
 * are read by many others:
 *
 *   1. The demo admin's `language_pref`. Since FR-34 the stored preference — not
 *      the URL — decides the locale, and a `/fa/...` prefix cannot override it,
 *      because next-intl normalises the prefix away before the app sees it. So
 *      seventeen specs that assert Farsi text silently depend on this account
 *      being Farsi. `settings.spec` changes it as part of what it tests.
 *   2. `work_settings.weekend_days` / `biweekly_weekend_days`. `admin-settings`
 *      and `weekend-frequency` both edit these, and every leave spec's expected
 *      duration depends on them.
 *
 * Each of those specs restores what it changed — but a spec that FAILS partway
 * restores nothing, and the damage then lands on a different spec in the next
 * run, which reports a confusing failure in code that is not at fault. That
 * happened twice: `department.spec` and `hourly.spec` failed expecting Farsi and
 * getting English, and `weekend-frequency` failed because a fortnightly Thursday
 * was still configured from an earlier aborted run.
 *
 * Restoring at the START is what actually breaks that cycle — one bad run can no
 * longer poison every run after it. Per-spec cleanup stays as it is; this is the
 * floor beneath it, not a replacement.
 *
 * Best-effort by design: a setup failure must not fail an otherwise green suite,
 * and the suite is perfectly runnable against a database where this cannot reach.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const ADMIN_CODE = 'admin';
const ADMIN_PASSWORD = 'Admin!2026';

function loadEnv() {
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
}

export default async function globalSetup() {
  loadEnv();

  const url = process.env.E2E_BASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return;

  // The local self-host gateway presents Caddy's private CA, which this process
  // does not trust. The override is scoped as tightly as it can be here: only
  // when the operator has explicitly pointed the suite at that URL, and restored
  // in the `finally` below so it never outlives this function. It is never on for
  // a normal `localhost:3000` run. The proper fix is trusting the CA in the
  // runner — worth doing, and noted for whoever owns CI.
  const priorTlsSetting = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  if (process.env.E2E_BASE_URL) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  try {
    const supabase = createClient(url, anon);
    const { data: auth, error: signInError } = await supabase.auth.signInWithPassword({
      email: `${ADMIN_CODE}@bj-app.internal`,
      password: ADMIN_PASSWORD,
    });
    if (signInError || !auth.user) return;

    // Farsi is the seeded default and what the Farsi-asserting specs expect.
    // Written as the admin themselves — `enforce_profile_update_scope` allows a
    // self-update of language_pref, and there is no service_role key here.
    const { error: langError } = await supabase
      .from('profiles')
      .update({ language_pref: 'fa' })
      .eq('id', auth.user.id);

    // Friday off every week, nothing fortnightly — the seeded working week.
    const { data: profile } = await supabase
      .from('profiles')
      .select('company_id')
      .eq('id', auth.user.id)
      .single();

    let weekError: { message: string } | null = null;
    if (profile?.company_id) {
      const { error } = await supabase
        .from('work_settings')
        .update({
          weekend_days: [5],
          biweekly_weekend_days: [],
          biweekly_anchor: null,
        })
        .eq('company_id', profile.company_id);
      weekError = error;
    }

    const problems = [langError?.message, weekError?.message].filter(Boolean);
    console.log(
      problems.length
        ? `e2e setup: baseline partly restored (${problems.join('; ')})`
        : 'e2e setup: shared config restored to baseline (admin locale fa, Friday-only weekend).'
    );
    await supabase.auth.signOut();
  } catch (err) {
    console.warn('e2e setup skipped:', err instanceof Error ? err.message : err);
  } finally {
    if (priorTlsSetting === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = priorTlsSetting;
  }
}
