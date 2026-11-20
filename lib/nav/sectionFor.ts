// Longest match wins, so `/manage/approval-steps` never reads as Approvals.
const SECTIONS = [
  ['/manage/approval-steps', 'approvalSteps'],
  ['/manage/employees', 'employees'],
  ['/manage/departments', 'departments'],
  ['/manage/approvals', 'approvals'],
  ['/manage/reports', 'reports'],
  ['/manage', 'manage'],
  ['/absences', 'absences'],
  ['/finance', 'finance'],
  ['/procurement', 'procurement'],
  ['/sales', 'erp'],
  ['/settings', 'settings'],
  ['/admin', 'admin'],
  ['/help', 'help'],
  ['/profile', 'profile'],
  ['/home', 'home'],
  ['/request', 'request'],
  ['/calendar', 'calendar'],
  ['/organization', 'organization'],
] as const;

/** The section a path belongs to. `path` has the locale prefix already stripped. */
export function sectionFor(path: string): { href: string; key: string } | null {
  const hit = SECTIONS.find(([href]) => path === href || path.startsWith(`${href}/`));
  return hit ? { href: hit[0], key: hit[1] } : null;
}
