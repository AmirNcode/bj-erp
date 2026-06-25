// =============================================================================
// scripts/seed-demo.mjs — demo org seed (idempotent).
//
// Signs in as the admin and uses the existing guarded RPCs (app_create_employee,
// allocate_leave) — no service_role secret. Creates a small realistic org
// (managers + employees + security), allocates leave, seeds a few holidays, links
// team managers, and deactivates throwaway profiles left by e2e runs.
//
// Run:  node scripts/seed-demo.mjs    (reads .env.local for the Supabase URL/key)
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

const ADMIN_CODE = 'admin';
const ADMIN_PASSWORD = 'Admin!2026';
const DEMO_PW = 'Demo!2026';
const COMPANY = '00000000-0000-0000-0000-0000000000c0';
const DEPT = {
  prodA: '00000000-0000-0000-0000-0000000000d1',
  qc: '00000000-0000-0000-0000-0000000000d2',
  maint: '00000000-0000-0000-0000-0000000000d3',
  sec: '00000000-0000-0000-0000-0000000000d4',
};
const codeToEmail = (code) => `${code.trim().toLowerCase()}@bj-app.internal`;

const supa = createClient(URL, ANON, { auth: { persistSession: false } });

function die(msg, err) {
  console.error(msg, err?.message ?? err ?? '');
  process.exit(1);
}

async function ensureUser(code, fullName, deptId, roles, managerId) {
  const { data: existing, error: selErr } = await supa
    .from('profiles')
    .select('id')
    .eq('employee_code', code)
    .maybeSingle();
  if (selErr) die(`lookup ${code} failed:`, selErr);
  if (existing) return existing.id;

  const { data, error } = await supa.rpc('app_create_employee', {
    p_company_id: COMPANY,
    p_employee_code: code,
    p_full_name: fullName,
    p_password: DEMO_PW,
    p_department_id: deptId,
    p_roles: roles,
    p_manager_id: managerId,
  });
  if (error) die(`create ${code} failed:`, error);
  console.log(`  created ${code} (${fullName})`);
  return data;
}

async function ensureAllocation(empId, leaveTypeId, days) {
  const { data: existing, error: selErr } = await supa
    .from('leave_ledger')
    .select('id')
    .eq('employee_id', empId)
    .eq('leave_type_id', leaveTypeId)
    .limit(1)
    .maybeSingle();
  if (selErr) die('ledger lookup failed:', selErr);
  if (existing) return;

  const { error } = await supa.rpc('allocate_leave', {
    p_employee_id: empId,
    p_leave_type_id: leaveTypeId,
    p_period_start: '2026-01-01',
    p_period_end: '2026-12-31',
    p_days: days,
  });
  if (error) die('allocate failed:', error);
}

async function main() {
  const { error: signErr } = await supa.auth.signInWithPassword({
    email: codeToEmail(ADMIN_CODE),
    password: ADMIN_PASSWORD,
  });
  if (signErr) die('admin sign-in failed:', signErr);
  console.log('signed in as admin');

  // Leave type ids (by name, so this works on a fresh DB too).
  const { data: types, error: typesErr } = await supa
    .from('leave_types')
    .select('id, name_en')
    .eq('company_id', COMPANY);
  if (typesErr) die('leave_types fetch failed:', typesErr);
  const annual = types.find((t) => t.name_en === 'Annual Leave')?.id;
  const sick = types.find((t) => t.name_en === 'Sick Leave')?.id;
  if (!annual || !sick) die('Annual/Sick leave types missing — run supabase/seed.sql first');

  // Managers first (so reports can link p_manager_id).
  console.log('seeding users…');
  const ids = {};
  ids['m-prod'] = await ensureUser('m-prod', 'Reza Karimi', DEPT.prodA, ['manager', 'employee'], null);
  ids['m-qc'] = await ensureUser('m-qc', 'Maryam Hosseini', DEPT.qc, ['manager', 'employee'], null);
  ids['m-maint'] = await ensureUser('m-maint', 'Mehdi Sadeghi', DEPT.maint, ['manager', 'employee'], null);
  ids['s-sup'] = await ensureUser('s-sup', 'Naser Ebrahimi', DEPT.sec, ['security'], null);

  const reports = [
    ['e-prod-1', 'Ali Rezaei', DEPT.prodA, ['employee'], ids['m-prod']],
    ['e-prod-2', 'Hossein Ahmadi', DEPT.prodA, ['employee'], ids['m-prod']],
    ['e-qc-1', 'Zahra Mohammadi', DEPT.qc, ['employee'], ids['m-qc']],
    ['e-qc-2', 'Fatemeh Akbari', DEPT.qc, ['employee'], ids['m-qc']],
    ['e-maint-1', 'Hassan Jafari', DEPT.maint, ['employee'], ids['m-maint']],
    ['e-maint-2', 'Saeed Bagheri', DEPT.maint, ['employee'], ids['m-maint']],
    ['g-01', 'Kazem Moradi', DEPT.sec, ['security'], ids['s-sup']],
    ['g-02', 'Javad Rostami', DEPT.sec, ['security'], ids['s-sup']],
  ];
  for (const r of reports) ids[r[0]] = await ensureUser(...r);

  // Allocations for every curated user.
  console.log('allocating leave…');
  for (const id of Object.values(ids)) {
    await ensureAllocation(id, annual, 26);
    await ensureAllocation(id, sick, 10);
  }

  // Team department managers.
  for (const [deptId, mgr] of [
    [DEPT.prodA, ids['m-prod']],
    [DEPT.qc, ids['m-qc']],
    [DEPT.maint, ids['m-maint']],
    [DEPT.sec, ids['s-sup']],
  ]) {
    const { error } = await supa.from('departments').update({ manager_id: mgr }).eq('id', deptId);
    if (error) die('dept manager update failed:', error);
  }

  // Minimal holidays (2026 Gregorian; approximate, admin-editable).
  console.log('seeding holidays…');
  const holidays = [
    ['2026-03-21', 'نوروز', 'Nowruz'],
    ['2026-03-22', 'نوروز', 'Nowruz'],
    ['2026-03-23', 'نوروز', 'Nowruz'],
    ['2026-03-24', 'نوروز', 'Nowruz'],
    ['2026-06-04', 'رحلت امام خمینی', 'Demise of Imam Khomeini'],
    ['2026-06-05', 'قیام ۱۵ خرداد', '15 Khordad Uprising'],
  ];
  for (const [date, fa, en] of holidays) {
    const { data: ex } = await supa
      .from('holidays')
      .select('id')
      .eq('company_id', COMPANY)
      .eq('holiday_date', date)
      .maybeSingle();
    if (!ex) {
      const { error } = await supa
        .from('holidays')
        .insert({ company_id: COMPANY, holiday_date: date, name_fa: fa, name_en: en });
      if (error) die(`holiday ${date} failed:`, error);
    }
  }

  // Deactivate every non-curated, non-admin profile (e2e throwaways) so the demo
  // shows only the curated org + admin. Non-destructive (active flag only).
  console.log('deactivating non-curated profiles…');
  const keepCodes = new Set([...Object.keys(ids), ADMIN_CODE]);
  const { data: actives, error: actErr } = await supa
    .from('profiles')
    .select('id, employee_code')
    .eq('active', true);
  if (actErr) die('active profiles fetch failed:', actErr);
  const toDeactivate = actives.filter((p) => !keepCodes.has(p.employee_code)).map((p) => p.id);
  if (toDeactivate.length) {
    const { error } = await supa.from('profiles').update({ active: false }).in('id', toDeactivate);
    if (error) die('deactivate failed:', error);
  }
  console.log(`  deactivated ${toDeactivate.length} throwaway profile(s)`);

  console.log(`\n✅ seed complete — ${Object.keys(ids).length} curated users, password ${DEMO_PW}`);
}

main().catch((e) => die('unexpected error:', e));
