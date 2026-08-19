/**
 * Pure HR report builders (FR-37). No I/O, no i18n — every label is injected, so
 * this module is exhaustively unit-testable and carries no translation
 * dependency.
 *
 * Every builder returns the same `ReportTable` shape. That is deliberate: one
 * table renderer and one CSV writer serve all five reports, so adding a sixth is
 * a builder plus a label block, not another screen.
 *
 * Durations are emitted as **decimal days**, not "۹ روز و ۴ ساعت". These rows end
 * up in a spreadsheet where HR will sum and sort them, and a formatted string
 * cannot be summed. The conversion still goes through the one workday constant
 * (`hoursPerDay`), per the days↔minutes convention in DATA_MODEL.
 */

export type ReportTable = {
  columns: string[];
  rows: (string | number)[][];
};

/** Minutes -> decimal days, rounded to 2dp so a spreadsheet can total them. */
export function minutesToDecimalDays(minutes: number, hoursPerDay: number): number {
  const perDay = hoursPerDay * 60;
  if (!perDay) return 0;
  return Math.round((minutes / perDay) * 100) / 100;
}

/** Whole days between two ISO dates, for the ageing report. */
export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

// ---------------------------------------------------------------------------

export type EmployeeRow = {
  id: string;
  fullName: string;
  employeeCode: string;
  personnelNo: string | null;
  departmentName: string | null;
  managerName: string | null;
  hireDate: string | null;
  active: boolean;
};

export type LedgerRow = {
  employeeId: string;
  leaveTypeId: string;
  balanceAfterMinutes: number;
  seq: number;
};

export type LeaveTypeRow = { id: string; name: string };

export type RequestRow = {
  id: string;
  employeeId: string;
  kind: 'leave' | 'errand';
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  startDate: string;
  endDate: string;
  requestedMinutes: number;
  unpaidMinutes: number;
  createdAt: string;
  leaveTypeName: string | null;
  /** Steps still waiting, for the ageing report. */
  outstanding?: string[];
};

// ---------------------------------------------------------------------------
// 1. Leave balance by employee
// ---------------------------------------------------------------------------

/**
 * One row per active employee, one column per leave type.
 *
 * "Latest" is by `seq`, never `created_at` — accrual posts several months in one
 * transaction where now() is frozen, so created_at ties and the winner would be
 * arbitrary (DATA_MODEL, migration 20260729130007).
 */
export function buildBalanceReport(input: {
  employees: EmployeeRow[];
  ledger: LedgerRow[];
  leaveTypes: LeaveTypeRow[];
  hoursPerDay: number;
  labels: { name: string; code: string; department: string; manager: string };
}): ReportTable {
  const { employees, ledger, leaveTypes, hoursPerDay, labels } = input;

  const latest = new Map<string, { minutes: number; seq: number }>();
  for (const row of ledger) {
    const key = `${row.employeeId}:${row.leaveTypeId}`;
    const prev = latest.get(key);
    if (!prev || row.seq > prev.seq) {
      latest.set(key, { minutes: row.balanceAfterMinutes, seq: row.seq });
    }
  }

  return {
    columns: [labels.name, labels.code, labels.department, labels.manager, ...leaveTypes.map((t) => t.name)],
    rows: employees
      .filter((e) => e.active)
      .map((e) => [
        e.fullName,
        e.personnelNo ?? e.employeeCode,
        e.departmentName ?? '—',
        e.managerName ?? '—',
        ...leaveTypes.map((t) =>
          minutesToDecimalDays(latest.get(`${e.id}:${t.id}`)?.minutes ?? 0, hoursPerDay)
        ),
      ]),
  };
}

// ---------------------------------------------------------------------------
// 2. Requests by period and status
// ---------------------------------------------------------------------------

/** Counts and total days per (kind, status) for requests overlapping the range. */
export function buildRequestSummary(input: {
  requests: RequestRow[];
  hoursPerDay: number;
  labels: {
    kind: string;
    status: string;
    count: string;
    days: string;
    unpaidDays: string;
    kindLeave: string;
    kindErrand: string;
    statuses: Record<string, string>;
  };
}): ReportTable {
  const { requests, hoursPerDay, labels } = input;

  const buckets = new Map<string, { count: number; minutes: number; unpaid: number }>();
  for (const r of requests) {
    const key = `${r.kind}:${r.status}`;
    const b = buckets.get(key) ?? { count: 0, minutes: 0, unpaid: 0 };
    b.count += 1;
    b.minutes += r.requestedMinutes;
    b.unpaid += r.unpaidMinutes;
    buckets.set(key, b);
  }

  // Stable order regardless of what the data happened to contain, so two runs
  // of the same report are diffable.
  const kinds: ('leave' | 'errand')[] = ['leave', 'errand'];
  const statuses = ['pending', 'approved', 'rejected', 'cancelled'];
  const rows: (string | number)[][] = [];
  for (const kind of kinds) {
    for (const status of statuses) {
      const b = buckets.get(`${kind}:${status}`);
      if (!b) continue;
      rows.push([
        kind === 'leave' ? labels.kindLeave : labels.kindErrand,
        labels.statuses[status] ?? status,
        b.count,
        minutesToDecimalDays(b.minutes, hoursPerDay),
        minutesToDecimalDays(b.unpaid, hoursPerDay),
      ]);
    }
  }

  return {
    columns: [labels.kind, labels.status, labels.count, labels.days, labels.unpaidDays],
    rows,
  };
}

// ---------------------------------------------------------------------------
// 3. Absence by department
// ---------------------------------------------------------------------------

/**
 * Approved LEAVE days per department in the range.
 *
 * Errands are excluded on purpose: an errand is work, not absence, and counting
 * it here would overstate how much time a department lost.
 */
export function buildAbsenceByDepartment(input: {
  requests: RequestRow[];
  employees: EmployeeRow[];
  hoursPerDay: number;
  labels: { department: string; people: string; requests: string; days: string };
}): ReportTable {
  const { requests, employees, hoursPerDay, labels } = input;
  const deptOf = new Map(employees.map((e) => [e.id, e.departmentName ?? '—']));

  const buckets = new Map<string, { people: Set<string>; count: number; minutes: number }>();
  for (const r of requests) {
    if (r.kind !== 'leave' || r.status !== 'approved') continue;
    const dept = deptOf.get(r.employeeId) ?? '—';
    const b = buckets.get(dept) ?? { people: new Set<string>(), count: 0, minutes: 0 };
    b.people.add(r.employeeId);
    b.count += 1;
    b.minutes += r.requestedMinutes;
    buckets.set(dept, b);
  }

  return {
    columns: [labels.department, labels.people, labels.requests, labels.days],
    rows: [...buckets.entries()]
      .sort((a, b) => b[1].minutes - a[1].minutes)
      .map(([dept, b]) => [dept, b.people.size, b.count, minutesToDecimalDays(b.minutes, hoursPerDay)]),
  };
}

// ---------------------------------------------------------------------------
// 4. Pending approvals ageing
// ---------------------------------------------------------------------------

/**
 * What is still waiting, on whom, and for how long — oldest first.
 *
 * "On whom" comes from the FR-36 chain: a request can be waiting on HR alone
 * because the manager already signed, and a queue that only said "pending" would
 * hide that.
 */
export function buildPendingAgeing(input: {
  requests: RequestRow[];
  employees: EmployeeRow[];
  today: string;
  hoursPerDay: number;
  labels: {
    name: string;
    department: string;
    submitted: string;
    waitingDays: string;
    days: string;
    waitingOn: string;
    stepLabels: Record<string, string>;
  };
}): ReportTable {
  const { requests, employees, today, hoursPerDay, labels } = input;
  const byId = new Map(employees.map((e) => [e.id, e]));

  return {
    columns: [
      labels.name,
      labels.department,
      labels.submitted,
      labels.waitingDays,
      labels.days,
      labels.waitingOn,
    ],
    rows: requests
      .filter((r) => r.status === 'pending')
      .map((r) => ({ r, age: daysBetween(r.createdAt.slice(0, 10), today) }))
      .sort((a, b) => b.age - a.age)
      .map(({ r, age }) => {
        const emp = byId.get(r.employeeId);
        return [
          emp?.fullName ?? '—',
          emp?.departmentName ?? '—',
          r.createdAt.slice(0, 10),
          age,
          minutesToDecimalDays(r.requestedMinutes, hoursPerDay),
          (r.outstanding ?? []).map((s) => labels.stepLabels[s] ?? s).join(' + ') || '—',
        ];
      }),
  };
}

// ---------------------------------------------------------------------------
// 5. Headcount by department
// ---------------------------------------------------------------------------

/** Active headcount per department, plus who joined inside the range. */
export function buildHeadcount(input: {
  employees: EmployeeRow[];
  rangeStart: string;
  rangeEnd: string;
  labels: { department: string; headcount: string; joiners: string };
}): ReportTable {
  const { employees, rangeStart, rangeEnd, labels } = input;

  const buckets = new Map<string, { total: number; joiners: number }>();
  for (const e of employees) {
    if (!e.active) continue;
    const dept = e.departmentName ?? '—';
    const b = buckets.get(dept) ?? { total: 0, joiners: 0 };
    b.total += 1;
    if (e.hireDate && e.hireDate >= rangeStart && e.hireDate <= rangeEnd) b.joiners += 1;
    buckets.set(dept, b);
  }

  return {
    columns: [labels.department, labels.headcount, labels.joiners],
    rows: [...buckets.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .map(([dept, b]) => [dept, b.total, b.joiners]),
  };
}

/** Everything a table needs to become a CSV: header row then body, as strings. */
export function tableToCsvRows(table: ReportTable): string[][] {
  return [table.columns, ...table.rows.map((r) => r.map((c) => String(c)))];
}
