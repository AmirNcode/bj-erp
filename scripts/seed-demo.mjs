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
// Optional, demo/local only: lets the seed give an account a non-numeric login
// code (the app itself only issues personnel numbers, FR-31). The local Docker
// stack's key is SERVICE_ROLE_KEY in deploy/.env. Never used by the app.
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY');
  process.exit(1);
}

const ADMIN_CODE = 'admin';
const ADMIN_PASSWORD = 'Admin!2026';
const DEMO_PW = 'Demo!2026';
const CODE = {
  prodManager: '1001',
  qcManager: '1002',
  maintenanceManager: '1003',
  securitySupervisor: '1004',
  prodEmployee1: '2001',
  prodEmployee2: '2002',
  qcEmployee1: '2101',
  qcEmployee2: '2102',
  maintenanceEmployee1: '2201',
  maintenanceEmployee2: '2202',
  guard1: '3001',
  guard2: '3002',
  finance: '4002',
};
// Test HR account (owner, 2026-10-12): logs in as `hr-101`, personnel no. 101.
const HR_LOGIN = 'hr-101';
const HR_PERSONNEL_NO = '101';
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
    // Since 20260730130002 the personnel number is the login code; the former
    // p_employee_code RPC argument no longer exists.
    p_personnel_no: code,
    p_full_name: fullName,
    p_password: DEMO_PW,
    p_department_id: deptId,
    p_roles: roles,
    p_manager_id: managerId,
  });
  if (error) die(`create ${code} failed:`, error);
  console.log(`  created ${code} (${fullName})`);
  await clearPasswordFlag(data, code);
  return data;
}

// New accounts must replace their issued password at first login (FR-50). Demo
// accounts share a published password and are signed into by e2e, so the demo
// org skips that step.
async function clearPasswordFlag(id, code) {
  const { error } = await supa.from('profiles').update({ must_change_password: false }).eq('id', id);
  if (error) die(`clear password flag ${code} failed:`, error);
}

/**
 * Gives an account a login code other than its personnel number. The RPC can
 * only issue numeric codes, so the auth email is changed through GoTrue's admin
 * API (service key) and the profile's employee_code by the signed-in admin.
 */
async function renameLogin(id, fromCode, toCode) {
  if (!SERVICE_KEY) {
    console.warn(`  SUPABASE_SERVICE_ROLE_KEY not set: ${fromCode} keeps logging in as ${fromCode}, not ${toCode}`);
    return fromCode;
  }
  const admin = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { error: authErr } = await admin.auth.admin.updateUserById(id, {
    email: codeToEmail(toCode),
    email_confirm: true,
  });
  if (authErr) die(`rename login ${fromCode} -> ${toCode} failed:`, authErr);
  const { error } = await supa.from('profiles').update({ employee_code: toCode }).eq('id', id);
  if (error) die(`rename employee_code ${fromCode} -> ${toCode} failed:`, error);
  console.log(`  login ${fromCode} -> ${toCode}`);
  return toCode;
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
    // The ledger stores minutes; the demo world uses the 8h default day.
    p_minutes: Math.round(days * 8 * 60),
  });
  if (error) die('allocate failed:', error);
}

async function main() {
  const { data: signIn, error: signErr } = await supa.auth.signInWithPassword({
    email: codeToEmail(ADMIN_CODE),
    password: ADMIN_PASSWORD,
  });
  if (signErr) die('admin sign-in failed:', signErr);
  console.log('signed in as admin');
  await clearPasswordFlag(signIn.user.id, ADMIN_CODE);

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
  ids[CODE.prodManager] = await ensureUser(CODE.prodManager, 'Reza Karimi', DEPT.prodA, ['manager', 'employee'], null);
  ids[CODE.qcManager] = await ensureUser(CODE.qcManager, 'Maryam Hosseini', DEPT.qc, ['manager', 'employee'], null);
  ids[CODE.maintenanceManager] = await ensureUser(CODE.maintenanceManager, 'Mehdi Sadeghi', DEPT.maint, ['manager', 'employee'], null);
  ids[CODE.securitySupervisor] = await ensureUser(CODE.securitySupervisor, 'Naser Ebrahimi', DEPT.sec, ['security'], null);

  const reports = [
    [CODE.prodEmployee1, 'Ali Rezaei', DEPT.prodA, ['employee'], ids[CODE.prodManager]],
    [CODE.prodEmployee2, 'Hossein Ahmadi', DEPT.prodA, ['employee'], ids[CODE.prodManager]],
    [CODE.qcEmployee1, 'Zahra Mohammadi', DEPT.qc, ['employee'], ids[CODE.qcManager]],
    [CODE.qcEmployee2, 'Fatemeh Akbari', DEPT.qc, ['employee'], ids[CODE.qcManager]],
    [CODE.maintenanceEmployee1, 'Hassan Jafari', DEPT.maint, ['employee'], ids[CODE.maintenanceManager]],
    [CODE.maintenanceEmployee2, 'Saeed Bagheri', DEPT.maint, ['employee'], ids[CODE.maintenanceManager]],
    [CODE.guard1, 'Kazem Moradi', DEPT.sec, ['security'], ids[CODE.securitySupervisor]],
    [CODE.guard2, 'Javad Rostami', DEPT.sec, ['security'], ids[CODE.securitySupervisor]],
  ];
  for (const r of reports) ids[r[0]] = await ensureUser(...r);

  // HR test account. Looked up by its final login first so a re-run is a no-op.
  const { data: hrExisting } = await supa
    .from('profiles')
    .select('id')
    .eq('employee_code', HR_LOGIN)
    .maybeSingle();
  if (hrExisting) {
    ids[HR_LOGIN] = hrExisting.id;
  } else {
    const hrId = await ensureUser(HR_PERSONNEL_NO, 'Leila Hashemi', DEPT.prodA, ['hr', 'employee'], null);
    // Keyed by the code it ends up with, so the clean-up below keeps it.
    ids[await renameLogin(hrId, HR_PERSONNEL_NO, HR_LOGIN)] = hrId;
  }
  // Finance test account (FR-54 clearance, FR-62 completed approvals).
  ids[CODE.finance] = await ensureUser(CODE.finance, 'Omid Kazemi', DEPT.prodA, ['finance', 'employee'], null);

  // Allocations for every curated user.
  console.log('allocating leave…');
  for (const id of Object.values(ids)) {
    await ensureAllocation(id, annual, 26);
    await ensureAllocation(id, sick, 10);
  }

  // Team department managers.
  for (const [deptId, mgr] of [
    [DEPT.prodA, ids[CODE.prodManager]],
    [DEPT.qc, ids[CODE.qcManager]],
    [DEPT.maint, ids[CODE.maintenanceManager]],
    [DEPT.sec, ids[CODE.securitySupervisor]],
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
