# Approvals consolidation and Finance usability

Status: approved by the owner on 2026-11-08; implemented locally, not deployed.
Branch: `codex/approvals-finance-layout` (from local `claude/view-as` at `6f20491`).

## Confirmed scope

### Table width

Finance and Employees desktop tables occupy 80% of the available area beside the sidebar. Only table containers widen: headers, filters, totals, forms and other page content retain their present widths. Mobile retains its existing responsive behavior. Wide tables scroll horizontally inside their own container. Avoid changing the global content width for unrelated pages; use an explicit table breakout container sized relative to the sidebar's remaining area. At narrower desktop sizes retain the present usable table width rather than shrink an existing table.

### One Approvals page

Remove Request archive from desktop and mobile navigation. Redirect its old URL to Approvals. Rename the Leave section's Request archive permission label to “Approvals — request review” (with matching Farsi); retain its existing `leave_requests` key and read/edit behavior. Its explanation distinguishes viewing requests and existing management operations from approval authority, which still comes from the approval chain.

Retain the existing Approvals card layout and two sections: pending requests and history. Add shared name/personnel-ID/tracking-number search and status/request-type filters, using the archive's existing choices. Filters affect both sections, before history pagination. Keep both section headings when a filter yields no matching rows; pending status naturally empties history, and a closed status empties pending.

The merged page is available to existing approvers OR archive readers. Archive readers retain all requests they can currently review, including their own. Approvers without archive permission retain their current scope. Deduplicate pending requests if both sources include the same ID. Never infer decision authority from read access: rows without approve/reject entitlements have review actions only.

Retain profile photos and add personnel IDs to every request item. History's status and View form group is vertically centered against the row; the badge and button are horizontally centered with one another. Preserve the existing approval dialogs, signature evidence, trip-extension workflow and history decision notes. Keep HR's Correct trip, travel booking and cancellation controls under their existing authorization and eligibility rules.

### Finance

Replace both month dropdowns with the existing Persian mini-calendar date fields, selecting exact inclusive start/end dates. Keep current default (first day of current Jalali month through last day of next month), URL date range and the database's 400-day limit. Reject invalid/reversed dates with translated feedback; do not issue an invalid range query.

Replace Employee with First Name, Last Name, ID and Department. Use actual stored name fields, not splitting full_name. Missing names or personnel IDs display a dash. Add name/ID search and department filtering, retaining hourly/daily type filtering. Department options identify departments by stable ID, with localized names. The options come from the full returned date-range dataset rather than shrinking when other filters change.

Every data column has keyboard-accessible ascending/descending sorting and an aria-sort indicator. Amounts and duration sort numerically; dates chronologically; names and other text with locale-aware collation; ID/tracking numbers naturally. Nulls sort consistently. Both approved and pending sections use the selected order. Form actions are not sortable data. Summary totals and CSV reflect filtered rows; CSV receives separate name columns and the visible order.

Add View/print form per visible work errand for authorized viewers, opening the existing complete printable form, including reason and signatures.

## Finance form permission design

New role setting in Finance: “View/print work-errand forms”, a read-only permission (`finance_forms`). It requires Finance read; enabling it raises that dependency using the existing role-editor behavior. Removing Finance read removes the dependent permission. Explain that it includes the request reason and signatures, but grants no approve/edit authority.

Approved initialization: off for all existing non-admin roles; admin retains implicit access. The owner can enable it for Finance or custom roles in Settings → Roles. Existing HR, requester, manager and approver print access remains governed by existing rights; this new toggle controls the additional Finance grant, not those independent rights.

The additional grant covers only same-company work errands eligible for the Finance list: pending, approved, or cancelled trips whose travel costs are settled. It must not grant leave access, approval power, employee-profile browsing or access to other companies. Reuse existing full print rendering. Prefer a dedicated print-read authorization path rather than widening the approval queue or general request-row RLS; validate every print data RPC (context, signatures, extensions and corrections) under the same scope.

The Finance list needs actual first/last names and department ID. Add a versioned guarded finance RPC retaining the old RPC during the deployment window, with the same financial calculations and date/status scope.

## Review and validation

This is not a deployment request. No commits, push, production changes or shared-roster mutations are included. Use isolated database clones for migration development and permission tests. Keep the existing uncommitted AGENTS.md change.

Test archive-only readers, approvers without archive access, combined access, self requests and unauthorized users; search across history pages; HR control eligibility; unchanged approve/reject workflow. Test Finance print permission off/on/revoked, exact request scope, cross-company denial, and unchanged signature/approval authority. Confirm financial totals and cancellation costs unchanged.

Verify desktop and mobile in English/LTR and Farsi/RTL; calendar interactions, table width versus unchanged surrounding content, all sorting types, search, department filtering, empty states, CSV and print links. Run relevant SQL and unit tests, lint, TypeScript and production build.
