# Implementation plan: Approvals and Finance usability

Status: approved by the owner on 2026-11-08; implementation complete, final verification recorded in AGENT-LOG.md.
Design: `docs/specs/2026-11-08-approvals-finance-layout-design.md`.
Branch: `codex/approvals-finance-layout`, from `6f20491`.

## 1. Scoped database and permission support

- Add `finance_forms` read-only permission, dependent on Finance read, to SQL catalog and TypeScript mirror. Add bilingual role labels/help. Default off for existing non-admin roles; admin implicit access remains.
- Add a versioned Finance RPC returning stored first_name, last_name and department_id alongside unchanged financial data. Keep the old RPC for rolling deployment compatibility.
- Add a narrowly scoped Finance print-read authorization path for eligible same-company work errands; cover context, signatures, extensions and corrections without granting approval rights or general employee/leave reads.
- Extend history query with review visibility, employee ID, HR-control fields and filters before pagination. Preserve its own-decision evidence for approvers and existing RPC compatibility.
- Build SQL tests on a throwaway clone, dry-run migrations, and regenerate only corresponding schema sections from the validated clone. Follow the repository migration ledger process, which takes priority over generic Supabase skill advice.

## 2. Consolidate Approvals

- Update `lib/nav/tabs.ts`, page guard and legacy archive redirect. Update Leave permission wording without renaming the underlying leave_requests key.
- Introduce shared URL-backed search/status/type filters; reset history page when filters change and retain filters when paging.
- Combine pending review/approval rows by request ID. Preserve existing queue presentation and exact decision authority; add read-only pending review rows where necessary.
- Extract archive HR action controls for reuse on pending/history items, preserving eligibility and viewer checks. Preserve trip extensions.
- Add avatars/personnel IDs, center history status/form actions, preserve decision notes and printable links.

## 3. Finance controls and tables

- Use existing PersianDateField controls with Gregorian ISO URL parameters, range validation and current default dates.
- Add actual first/last-name, ID and department columns, name/ID search and stable department filter.
- Add accessible sort headers for every data column; numeric/date/localized text sorting; shared sorting across both sections; consistent null handling.
- Keep filtered summary totals and CSV consistent with rows, including split name columns.
- Add complete-form links according to existing print rights or the new Finance permission.

## 4. Desktop width

- Add an explicit table breakout wrapper used only by Finance and Employees tables. Target 80% of the area beside the sidebar at wide desktop sizes; do not narrow existing tables at smaller desktop sizes.
- Keep page headers, filter bars, totals, other content and mobile layouts at their present widths. Check LTR/RTL centering and horizontal overflow.

## 5. Verification and documentation

- SQL: permission dependencies and revocation, cross-company and leave denial, complete print data, unchanged financial totals, merged history scope/filtering before pagination.
- Unit/component: filtering, sorting numeric and date fields, navigation and role catalog, date validation, visible controls under different capabilities.
- Browser: synthetic fixtures where possible; both locales, desktop/mobile, mini calendar, filters/sorts/CSV, status alignment, table-only width, full form links. Browser plugin is not available; use repository Playwright.
- Run lint, typecheck, unit suite and production build; resolve regressions caused by these changes.
- Update permissions/data model/requirements and session log. Do not commit, push or deploy unless requested.

## Documentation already consulted

Read local onboarding/current log/tasks and owning page/action/permission/schema sources. Context7 checked Next.js App Router navigation, react-multi-date-picker controlled Persian date fields, and Supabase function privileges. Bundled Next.js useRouter/redirect guides read. Supabase changelog markdown fetch was rejected by the web tool's content-type handling; retry via an appropriate text client if relevant platform behavior needs confirmation.
