/** Shapes of the FR-77 / FR-78 admin functions' JSON (see the 20261103140000/…01 migrations). */

export type OverviewPeople = {
  active: number;
  inactive: number;
  never_signed_in: number;
  must_change_password: number;
  signed_in_7d: number;
  signed_in_30d: number;
};

export type OverviewRequestCount = {
  kind: 'leave' | 'errand';
  unit: 'day' | 'hour';
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  count: number;
};

export type StuckRequest = {
  id: string;
  serial_year: number;
  serial_seq: number;
  kind: 'leave' | 'errand';
  unit: 'day' | 'hour';
  employee_name: string;
  created_at: string;
  days_waiting: number;
  waiting_on: { step_role: string; manager_scope: string; step_order: number } | null;
};

export type DepartmentLeave = {
  department_id: string | null;
  name_fa: string | null;
  name_en: string | null;
  requests: number;
  minutes: number;
};

export type AdminOverview = {
  people: OverviewPeople;
  requests: OverviewRequestCount[];
  speed: { decided: number; median_hours: number | null; p90_hours: number | null };
  stuck: StuckRequest[];
  leave_by_department: DepartmentLeave[];
  minutes_per_day: number;
  approval_order_enforced: boolean;
};

export type CronJob = {
  jobname: string;
  schedule: string;
  active: boolean;
  last_status: string | null;
  last_start: string | null;
  last_end: string | null;
  last_message: string | null;
  failures_24h: number;
};

export type AdminSystemDb = {
  database_bytes: number;
  postgres_version: string;
  tables: { name: string; rows: number; bytes: number }[];
  migrations: { filename: string; applied_at?: string; [key: string]: unknown }[];
  migration_count: number;
  jobs: CronJob[];
  backups: { file_name: string; size_bytes: number; finished_at: string }[];
};

export type ServiceCheck = { name: 'database' | 'auth' | 'rest'; ok: boolean; ms: number | null };

export type AuditRow = {
  id: string;
  created_at: string;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  entity_label: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

export type AuditPage = { total: number; rows: AuditRow[]; entities: string[]; actions: string[] };

export type SmsMode = 'off' | 'dry_run' | 'live';
export type SmsSendMethod = 'line' | 'pattern';
export type SmsEvent = 'approver_new' | 'employee_decision' | 'password_reset' | 'test';
export type SmsStatus = 'queued' | 'sending' | 'sent' | 'dry_run' | 'failed' | 'skipped';

export type SmsSettings = {
  mode: SmsMode;
  provider: 'melipayamak';
  username: string | null;
  sender_line: string | null;
  send_method: SmsSendMethod;
  body_approver_new: number | null;
  body_employee_decision: number | null;
  body_password_reset: number | null;
  notify_approver_new: boolean;
  notify_employee_decision: boolean;
  notify_password_reset: boolean;
  site_label: string;
  has_api_key: boolean;
  api_key_hint: string | null;
  credit_amount: number | null;
  credit_checked_at: string | null;
  credit_error: string | null;
  credit_pending: boolean;
  updated_at: string;
};

export type SmsLogRow = {
  id: string;
  event: SmsEvent;
  recipient_id: string | null;
  recipient_name: string | null;
  request_id: string | null;
  to_mobile: string | null;
  body: string;
  status: SmsStatus;
  skip_reason: string | null;
  attempts: number;
  error: string | null;
  provider_ref: string | null;
  created_at: string;
  sent_at: string | null;
};

export type SmsLog = { total: number; rows: SmsLogRow[]; counts: Partial<Record<SmsStatus, number>> };

/** What the reset-password flow reports about its optional SMS. */
export type PasswordSmsResult = 'queued' | 'skipped' | 'off' | 'failed' | null;
