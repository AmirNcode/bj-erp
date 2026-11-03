'use server';

import { requireCaller } from '@/lib/auth/context';
import { dbErr, type DbErrorResult } from '@/lib/errors/db-error';
import { invalidateAppCache } from '@/lib/cache/invalidate-app';
import { addDays } from '@/lib/leave/isoDate';
import { todayInAppTz } from '@/lib/appDate';
import { AUDIT_PAGE_SIZE, SMS_PAGE_SIZE, normalizeIrMobile, type OverviewRange } from '@/lib/admin/format';
import type {
  AdminOverview,
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

export async function getAdminOverview(
  range: OverviewRange
): Promise<{ ok: true; overview: AdminOverview; from: string; to: string } | DbErrorResult> {
  const c = await requireAdmin();
  if (!c.ok) return c;
  const to = todayInAppTz();
  const from = addDays(to, -(range - 1));
  const { data, error } = await c.supabase.rpc('app_admin_overview', { p_from: from, p_to: to });
  if (error) return dbErr(error.message);
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
  if (system.error) return dbErr(system.error.message);
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
    p_limit: AUDIT_PAGE_SIZE,
    p_offset: (filters.page - 1) * AUDIT_PAGE_SIZE,
  });
  if (error) return dbErr(error.message);
  return { ok: true, log: data as unknown as AuditPage };
}

// ── SMS (FR-78) ─────────────────────────────────────────────────────────────

export async function getSmsSettings(): Promise<{ ok: true; settings: SmsSettings } | DbErrorResult> {
  const c = await requireAdmin();
  if (!c.ok) return c;
  const { data, error } = await c.supabase.rpc('app_sms_settings');
  if (error) return dbErr(error.message);
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
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true };
}

export async function sendSmsTest(mobile: string): Promise<{ ok: true } | DbErrorResult> {
  const c = await requireAdmin();
  if (!c.ok) return c;
  const normalized = normalizeIrMobile(mobile);
  if (!normalized) return dbErr('invalid mobile');
  const { error } = await c.supabase.rpc('app_sms_test', { p_mobile: normalized });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true };
}

export async function checkSmsCredit(): Promise<{ ok: true } | DbErrorResult> {
  const c = await requireAdmin();
  if (!c.ok) return c;
  const { error } = await c.supabase.rpc('app_sms_check_credit');
  if (error) return dbErr(error.message);
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
  if (error) return dbErr(error.message);
  return { ok: true, log: data as unknown as SmsLog };
}
