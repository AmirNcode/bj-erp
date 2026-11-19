# Profile page tabs + self-service SMS mobile (FR-95) — design

Status: approved by owner 2026-11-19. Small change.

## Intent

The Profile page is one narrow stacked column with wide empty margins on desktop. The owner wants
it split into tabs like Admin / ERP, and wants **everyone** to be able to add or change their own
mobile number, because that number is where SMS notifications (FR-78) go.

## Goals

- Three tabs, in order: **Profile** · **Personal information** · **Account**.
- Profile tab: name, employee code, profile photo, SMS mobile (editable by everyone), saved signature.
- Personal information tab: the existing FR-53 form.
- Account tab: language, change password.
- Wider desktop layout; phone layout updated to the same arrangement.

## Non-goals

- No change to who may edit the other personal-info fields (`personal_info_own` still gates them),
  HR's Manage › Employees edit, or SMS dispatch.
- No SMS verification code; no test SMS after saving.

## Decisions (owner)

1. **Same number.** The Profile-tab phone is `employee_personal_info.mobile`, the column
   `private.sms_queue` already reads. Personal information shows the same value.
2. **Format check only:** `09xxxxxxxxx` (accept the usual input forms via `normalize_ir_mobile`),
   saved at once, written to `audit_log`.
3. **Phone layout:** the Organization / Help / Settings links and Logout sit **above the tabs**,
   visible on every tab. The "Profile" page title is not shown on phones (the `MobileTopBar` already
   shows the section name); desktop keeps it.
4. **Desktop Profile tab = two columns:** left name/code card then photo; right SMS phone then
   signature. Phones: one column in that order (name/code, photo, phone, signature).

## Approaches

- **Route tabs (picked):** `/profile`, `/profile/personal-info` (existing URL), `/profile/account`,
  sharing `profile/layout.tsx` with the tab bar (`lib/ui/tabs.ts`, like `AdminTabs`). Deep links and
  the back button work; each tab loads only its data; old links to personal-info keep working.
- **In-page client tabs:** one page, tab state in the client. Loads all three tabs' data at once and
  the back button doesn't move between tabs. Rejected.

## Design

- **Migration:** `public.app_set_my_mobile(p_mobile text)` — SECURITY DEFINER, active caller only,
  normalizes with `private.normalize_ir_mobile` (NULL / empty clears the number), raises
  `invalid mobile` (22023) on a bad value, upserts the caller's own `employee_personal_info` row
  (company from the caller's profile), writes `audit_log` (`personal_info.mobile_self`, no number in
  the body beyond what audit rows already hold for personal info). Grant to `authenticated` only.
  Rejected under View as (read-only requests).
- **Server action** `setMyMobile` in `lib/actions/personal-info.ts` (`requireCaller` first,
  client-side `normalizeIrMobile` pre-check, `revalidatePath` of the profile routes).
- **UI:** `profile/layout.tsx` (title on desktop, phone link row + Logout, `ProfileTabs`), tab pages;
  new `SmsMobileCard` client component; Logout on desktop at the end of the Account tab. Profile and
  Account pages use the wider page width; personal-info drops its "Back" link.
- **Strings:** `fa` + `en` for the tab labels, phone card, errors.

## Left to the builder

Exact widths/grid classes per `docs/DESIGN.md`, test ids, whether the Settings link is computed in
the layout or the page, e2e coverage scope.
