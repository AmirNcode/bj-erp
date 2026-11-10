import { formatSerial } from './serial';

export type RequestFilters = { query: string; status: string; kind: string };
export function parseRequestFilters(sp: Record<string, string | string[] | undefined>): RequestFilters {
  const value = (key: string) => typeof sp[key] === 'string' ? sp[key] as string : '';
  return {
    query: value('q').trim().slice(0, 200),
    status: ['pending', 'approved', 'rejected', 'cancelled'].includes(value('status')) ? value('status') : 'all',
    kind: ['leave', 'errand'].includes(value('kind')) ? value('kind') : 'all',
  };
}
export function normalizeRequestSearch(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, c => String(c.charCodeAt(0) - (c >= '۰' ? 1776 : 1632))).toLowerCase().trim();
}
export function matchesRequest(r: {
  employee_name: string; personnel_no?: string | null; serial_year: number; serial_seq: number;
  kind: string; status: string;
}, filters: RequestFilters): boolean {
  return (filters.status === 'all' || r.status === filters.status)
    && (filters.kind === 'all' || r.kind === filters.kind)
    && normalizeRequestSearch([r.employee_name, r.personnel_no, formatSerial(r.serial_year, r.serial_seq)].join(' '))
      .includes(normalizeRequestSearch(filters.query));
}
export function approvalHref(locale: string, filters: RequestFilters, page = 1): string {
  const q = new URLSearchParams();
  if (filters.query) q.set('q', filters.query);
  if (filters.status !== 'all') q.set('status', filters.status);
  if (filters.kind !== 'all') q.set('kind', filters.kind);
  if (page > 1) q.set('history', String(page));
  return `/${locale}/manage/approvals${q.size ? `?${q}` : ''}`;
}
