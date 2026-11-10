import type { FinanceRow } from '@/lib/actions/finance';
import { tripTotal } from '@/lib/travel/totals';
import { normalizeRequestSearch } from '@/lib/leave/requestFilters';
import { isValidIsoDate } from '@/lib/leave/settings-validation';

export type FinanceSort = 'trackingNo' | 'firstName' | 'lastName' | 'personnelId' | 'department' | 'type' | 'dates' | 'duration' | 'location' | 'perDiem' | 'transport' | 'flightCost' | 'hotelCost' | 'lost' | 'total';
export const FINANCE_COLUMNS: FinanceSort[] = ['trackingNo','firstName','lastName','personnelId','department','type','dates','duration','location','perDiem','transport','flightCost','hotelCost','lost','total'];
export function validFinanceRange(from: string, to: string): boolean {
  return isValidIsoDate(from) && isValidIsoDate(to) && to >= from
    && Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) <= 400 * 86400000;
}
export function financeDepartment(r: FinanceRow, locale: string): string {
  return (locale === 'fa' ? r.department_name_fa ?? r.department_name_en : r.department_name_en ?? r.department_name_fa) ?? '—';
}
export function filterFinanceRows(rows: FinanceRow[], query: string, department: string, unit: string): FinanceRow[] {
  const q = normalizeRequestSearch(query);
  return rows.filter(r => (unit === 'all' || r.unit === unit)
    && (department === 'all' || (r.department_id ?? 'none') === department)
    && normalizeRequestSearch([r.first_name,r.last_name,r.employee_name,r.personnel_no].join(' ')).includes(q));
}
export function sortFinanceRows(rows: FinanceRow[], key: FinanceSort, direction: 'asc' | 'desc', locale: string,
  labels?: { type: (r: FinanceRow) => string; transport: (r: FinanceRow) => string }): FinanceRow[] {
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
  const value = (r: FinanceRow): string | number | null => {
    switch (key) {
      case 'trackingNo': return r.serial_year * 1000000000 + r.serial_seq;
      case 'firstName': return r.first_name;
      case 'lastName': return r.last_name;
      case 'personnelId': return r.personnel_no;
      case 'department': return r.department_id ? financeDepartment(r, locale) : null;
      case 'type': return labels?.type(r) ?? r.unit;
      case 'dates': return `${r.start_date} ${r.start_time ?? ''} ${r.end_date} ${r.end_time ?? ''}`;
      case 'duration': return r.requested_minutes;
      case 'location': return r.errand_location;
      case 'perDiem': return r.per_diem_rials;
      case 'transport': return labels?.transport(r) ?? r.transport;
      case 'flightCost': return r.flight_cost_rials;
      case 'hotelCost': return r.hotel_cost_rials;
      case 'lost': return r.lost_rials;
      case 'total': return tripTotal(r);
    }
  };
  return [...rows].sort((a,b) => {
    const av = value(a), bv = value(b);
    if (av == null || av === '') return bv == null || bv === '' ? 0 : 1;
    if (bv == null || bv === '') return -1;
    const cmp = typeof av === 'number' && typeof bv === 'number' ? av-bv : collator.compare(String(av),String(bv));
    return (direction === 'asc' ? cmp : -cmp) || a.id.localeCompare(b.id);
  });
}
