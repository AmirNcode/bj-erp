'use server';

import { requireCaller } from '@/lib/auth/context';
import { dbErr, type DbErrorResult } from '@/lib/errors/db-error';
import { invalidateAppCache } from '@/lib/cache/invalidate-app';
import { addDays } from '@/lib/leave/isoDate';
import { todayInAppTz } from '@/lib/appDate';
import { AUDIT_PAGE_SIZE, SMS_PAGE_SIZE, normalizeIrMobile, type OverviewRange } from '@/lib/admin/format';
import { ADMIN_LOCALE } from '@/lib/admin/locale';
import type {
  AdminOverview,
  AdminSignIns,
  AuditPerson,
  AdminSystemDb,
  AuditPage,
  ServiceCheck,
  SmsLog,
  SmsMode,
  SmsSendMethod,
  SmsSettings,
  SmsStatus,
  SmsEvent,
} from '@/lib/admin/types';

/**
 * FR-77 admin panel and FR-78 SMS settings. The admin alone: each action fails fast here and
 * every database function refuses anyone else (42501), so the guard never rests on the UI.
 */
const requireAdmin = () => requireCaller({ anyOf: ['admin'] });

/** The panel is English only (lib/admin/locale.ts), so its errors are too. */
const adminErr = (raw: string) => dbErr(raw, { locale: ADMIN_LOCALE });

export async function getAdminOverview(
  range: OverviewRange
): Promise<{ ok: true; overview: AdminOverview; from: string; to: string } | DbErrorResult> {
  const c = await requireAdmin();
  if (!c.ok) return c;
  const to = todayInAppTz();
  const from = addDays(to, -(range - 1));
  const { data, error } = await c.supabase.rpc('app_admin_overview', { p_from: from, p_to: to });
  if (error) return adminErr(error.message);
  return { ok: true, overview: data as unknown as AdminOverview, from, to };
}

/** Times one probe; any thrown error or non-2xx reply counts as down. */
async function probe(name: ServiceCheck['name'], run: () => Promise<boolean>): Promise<ServiceCheck> {
  const started = performance.now();
  try {
    const ok = await run();
    return { name, ok, ms: Math.round(performance.now() - started) };
  } catch {
    return { name, ok: false, ms: null };
  }
}

export async function getAdminSystem(): Promise<
  | { ok: true; db: AdminSystemDb; services: ServiceCheck[]; version: string; builtAt: string | null }
  | DbErrorResult
> {
  const c = await requireAdmin();
  if (!c.ok) return c;
  const base = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  const signal = () => AbortSignal.timeout(5000);
  const [system, ...services] = await Promise.all([
    c.supabase.rpc('app_admin_system'),
    probe('database', async () => {
      const { data, error } = await c.supabase.rpc('app_health');
      return !error && data === true;
    }),
    probe('auth', async () => (await fetch(`${base}/auth/v1/health`, { cache: 'no-store', signal: signal() })).ok),
    probe('rest', async () =>
      (await fetch(`${base}/rest/v1/`, { cache: 'no-store', headers: { apikey: anon }, signal: signal() })).ok),
  ]);
  if (system.error) return adminErr(system.error.message);
  return {
    ok: true,
    db: system.data as unknown as AdminSystemDb,
    services,
    version: process.env.APP_VERSION || 'dev',
    builtAt: process.env.APP_BUILT_AT || null,
  };
}

export type AuditFilters = {
  from?: string | null;
  to?: string | null;
  entity?: string | null;
  action?: string | null;
  /** Who did it (FR-77 v2). */
  actor?: string | null;
  /** Whom it was about (FR-77 v2). */
  target?: string | null;
  page: number;
};

export async function getAuditLog(filters: AuditFilters): Promise<{ ok: true; log: AuditPage } | DbErrorResult> {
  const c = await requireAdmin();
  if (!c.ok) return c;
  const { data, error } = await c.supabase.rpc('app_audit_log', {
    p_from: filters.from || null,
    p_to: filters.to || null,
    p_entity: filters.entity || null,
    p_action: filters.action || null,
    p_actor: filters.actor || null,
    p_target: filters.target || null,
    p_limit: AUDIT_PAGE_SIZE,
    p_offset: (filters.page - 1) * AUDIT_PAGE_SIZE,
  });
  if (error) return adminErr(error.message);
  return { ok: true, log: data as unknown as AuditPage };
}

/** Everyone in the company, inactive included, for the audit log's person pickers. */
export async function getAuditPeople(): Promise<{ ok: true; people: AuditPerson[] } | DbErrorResult> {
  const c = await requireCaller({ anyOf: ['admin'], company: true });
  if (!c.ok) return c;
  const { data, error } = await c.supabase
    .from('profiles')
    .select('id, full_name, personnel_no')
    .eq('company_id', c.companyId)
    .order('full_name');
  if (error) return adminErr(error.message);
  return {
    ok: true,
    people: (data ?? []).map((p) => ({ id: p.id, name: p.full_name, personnelNo: p.personnel_no })),
  };
}

// ── Sign-ins and sign-out (FR-79) ───────────────────────────────────────────

export async function getAdminSignIns(): Promise<{ ok: true; signIns: AdminSignIns; me: string } | DbErrorResult> {
  const c = await requireAdmin();
  if (!c.ok) return c;
  const { data, error } = await c.supabase.rpc('app_admin_sign_ins', { p_limit: 100 });
  if (error) return adminErr(error.message);
  return { ok: true, signIns: data as unknown as AdminSignIns, me: c.user.id };
}

/** Deletes the person's sessions; pages already open keep working until their token expires (≤ 60 min). */
export async function revokeSessions(userId: string): Promise<{ ok: true; count: number } | DbErrorResult> {
  const c = await requireAdmin();
  if (!c.ok) return c;
  const { data, error } = await c.supabase.rpc('app_revoke_sessions', { p_user: userId });
  if (error) return adminErr(error.message);
  invalidateAppCache();
  return { ok: true, count: data ?? 0 };
}

/** Everyone in the company except the admin. */
export async function revokeAllSessions(): Promise<{ ok: true; count: number } | DbErrorResult> {
  const c = await requireAdmin();
  if (!c.ok) return c;
  const { data, error } = await c.supabase.rpc('app_revoke_all_sessions');
  if (error) return adminErr(error.message);
  invalidateAppCache();
  return { ok: true, count: data ?? 0 };
}

// ── SMS (FR-78) ─────────────────────────────────────────────────────────────

export async function getSmsSettings(): Promise<{ ok: true; settings: SmsSettings } | DbErrorResult> {
  const c = await requireAdmin();
  if (!c.ok) return c;
  const { data, error } = await c.supabase.rpc('app_sms_settings');
  if (error) return adminErr(error.message);
  return { ok: true, settings: data as unknown as SmsSettings };
}

export type SmsSettingsInput = {
  mode: SmsMode;
  username: string;
  senderLine: string;
  sendMethod: SmsSendMethod;
  bodyApproverNew: string;
  bodyEmployeeDecision: string;
  bodyPasswordReset: string;
  notifyApproverNew: boolean;
  notifyEmployeeDecision: boolean;
  notifyPasswordReset: boolean;
  siteLabel: string;
  /** Empty keeps the saved key. */
  apiKey: string;
  clearApiKey: boolean;
};

const bodyId = (value: string): number | null => {
  const n = Number.parseInt(value.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export async function saveSmsSettings(input: SmsSettingsInput): Promise<{ ok: true } | DbErrorResult> {
  const c = await requireAdmin();
  if (!c.ok) return c;
  const { error } = await c.supabase.rpc('app_set_sms_settings', {
    p_mode: input.mode,
    p_username: input.username.trim() || null,
    p_sender_line: input.senderLine.trim() || null,
    p_send_method: input.sendMethod,
    p_body_approver_new: bodyId(input.bodyApproverNew),
    p_body_employee_decision: bodyId(input.bodyEmployeeDecision),
    p_body_password_reset: bodyId(input.bodyPasswordReset),
    p_notify_approver_new: input.notifyApproverNew,
    p_notify_employee_decision: input.notifyEmployeeDecision,
    p_notify_password_reset: input.notifyPasswordReset,
    p_site_label: input.siteLabel.trim() || 'bjeng.app',
    p_api_key: input.apiKey.trim() || null,
    p_clear_api_key: input.clearApiKey,
  });
  if (error) return adminErr(error.message);
  invalidateAppCache();
  return { ok: true };
}

export async function sendSmsTest(mobile: string): Promise<{ ok: true } | DbErrorResult> {
  const c = await requireAdmin();
  if (!c.ok) return c;
  const normalized = normalizeIrMobile(mobile);
  if (!normalized) return adminErr('invalid mobile');
  const { error } = await c.supabase.rpc('app_sms_test', { p_mobile: normalized });
  if (error) return adminErr(error.message);
  invalidateAppCache();
  return { ok: true };
}

export async function checkSmsCredit(): Promise<{ ok: true } | DbErrorResult> {
  const c = await requireAdmin();
  if (!c.ok) return c;
  const { error } = await c.supabase.rpc('app_sms_check_credit');
  if (error) return adminErr(error.message);
  invalidateAppCache();
  return { ok: true };
}

export async function getSmsLog(filters: {
  status?: SmsStatus | null;
  event?: SmsEvent | null;
  page: number;
}): Promise<{ ok: true; log: SmsLog } | DbErrorResult> {
  const c = await requireAdmin();
  if (!c.ok) return c;
  const { data, error } = await c.supabase.rpc('app_sms_log', {
    p_status: filters.status ?? null,
    p_event: filters.event ?? null,
    p_limit: SMS_PAGE_SIZE,
    p_offset: (filters.page - 1) * SMS_PAGE_SIZE,
  });
  if (error) return adminErr(error.message);
  return { ok: true, log: data as unknown as SmsLog };
}
