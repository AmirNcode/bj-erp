import { describe, expect, it } from 'vitest';
import { filterFinanceRows, sortFinanceRows, validFinanceRange } from '@/lib/finance/list';
import { matchesRequest, parseRequestFilters, approvalHref } from '@/lib/leave/requestFilters';
import type { FinanceRow } from '@/lib/actions/finance';
const row = (id: string, extra: Partial<FinanceRow> = {}): FinanceRow => ({
 id, serial_year: 1405, serial_seq: 1, kind: 'errand', employee_name: 'Sara Test', first_name: 'Sara', last_name: 'Test',
 personnel_no: '12', department_id: 'd1', department_name_fa: 'الف', department_name_en: 'A',
 leave_type_name_fa: null, leave_type_name_en: null, is_paid: null, unit: 'day', status: 'approved',
 start_date: '2026-11-01', end_date: '2026-11-02', start_time: null, end_time: null, requested_minutes: 480,
 unpaid_minutes: 0, errand_location: null, per_diem_rials: 100, per_diem_by_requester: false, decided_at: null,
 travel_state: null, transport: null, flight_cost_rials: null, hotel_cost_rials: null, lost_rials: null,
 waiting_step: null, corrected_at: null, can_print: false, ...extra,
});
describe('Finance table controls', () => {
 it('combines search, department and type; normalizes Persian IDs', () => {
  const rows = [row('a'), row('b', { department_id:'d2' }), row('c', { unit:'hour' })];
  expect(filterFinanceRows(rows,'۱۲','d1','day').map(r=>r.id)).toEqual(['a']);
  expect(filterFinanceRows(rows,'sara test','all','all')).toHaveLength(3);
 });
 it('sorts numeric amounts, natural IDs and dates, putting missing values last in both directions', () => {
  const rows = [row('a', { per_diem_rials: 20, personnel_no:'10' }), row('b', { per_diem_rials: 100, personnel_no:'2' }), row('c',{per_diem_rials:null})];
  expect(sortFinanceRows(rows,'perDiem','asc','en').map(r=>r.id)).toEqual(['a','b','c']);
  expect(sortFinanceRows(rows,'perDiem','desc','en').map(r=>r.id)).toEqual(['b','a','c']);
  expect(sortFinanceRows(rows,'personnelId','asc','en').map(r=>r.id)).toEqual(['b','a','c']);
  expect(sortFinanceRows([row('a',{start_date:'2026-12-01'}),row('b')],'dates','asc','fa').map(r=>r.id)).toEqual(['b','a']);
 });
 it('validates calendar boundaries and maximum span', () => {
  expect(validFinanceRange('2026-02-30','2026-03-01')).toBe(false);
  expect(validFinanceRange('2026-11-02','2026-11-01')).toBe(false);
  expect(validFinanceRange('2026-01-01','2027-02-05')).toBe(true);
  expect(validFinanceRange('2026-01-01','2027-02-06')).toBe(false);
  expect(validFinanceRange('2026-11-01','2026-11-01')).toBe(true);
 });
});
describe('merged request filters', () => {
 it('matches personnel numbers and tracking numbers while respecting section status', () => {
  const filters = { query:'۱۴۰۵-۰۰۰۱', status:'pending', kind:'all' };
  expect(matchesRequest(row('a'),filters)).toBe(false);
  expect(matchesRequest(row('a',{status:'pending'}),filters)).toBe(true);
 });
 it('sanitizes unknown choices and retains filters in history links', () => {
  expect(parseRequestFilters({status:'bogus',kind:['errand']})).toEqual({query:'',status:'all',kind:'all'});
  expect(approvalHref('en',{query:'Sara & Ali',status:'approved',kind:'errand'},2)).toContain('q=Sara+%26+Ali&status=approved&kind=errand&history=2');
 });
});
