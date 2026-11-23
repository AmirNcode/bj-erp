# Self-service password reset by SMS

Approved design, 2026-11-22.

## Employee experience

1. Choose **Forgot password** on the Persian or English login page. Enter the usual login code, including any custom login code assigned by the administrator.
2. Show the registered SMS mobile in local format, for example `09•••••••42`. Ask the employee to enter the entire number. Use the existing Iranian mobile normalization rules and accept Persian numerals. The public form cannot add or change the destination.
3. For a match, generate a random temporary password and text it to the registered mobile. Return the employee to the regular sign-in flow with instructions to use their login code and the texted password.
4. Use the existing mandatory password-change flow. After the employee chooses a permanent password, the temporary password no longer works.

## Eligibility and assistance

Every active account with a valid registered SMS mobile qualifies except an account holding the administrator role, including an administrator who also holds another role. Recheck eligibility and the current mobile at issuance. Offer “Contact HR or your administrator” throughout recovery, including when the employee cannot access the registered number.

## Assisted resets

Settings → Roles → Employees gains a **Reset employee passwords** switch in both languages. All non-admin roles start with it off, including HR. After release, the administrator creates a custom role (for example, **HR Head**), enables the switch there, and assigns the role to the head of HR alone. Authorization follows the permission across the person’s assigned roles. The role name and job title have no special meaning. The administrator controls who holds the role and can revoke it later. Treat it as a sensitive, action-only permission that requires employee read access. Only the administrator may grant it or assign a role carrying it.

An authorized operator opens an eligible employee's record, verifies the employee's identity, and uses the single-person reset action. The operator can see the generated temporary password once and give it to the employee privately, including when their account has no mobile. The employee signs in and must choose a new password. Record the operator and target in the audit log without recording the password.

The administrator and the designated head of HR can perform assisted resets. The head of HR may reset any other active person in the company, including managers and other HR staff. Any target holding the administrator role is excluded from delegated resets, even when they also hold another role. This allows the operator who receives the temporary password to sign in as the target until the employee changes it. Bulk credential generation remains an administrator action.

## Implementation plan

1. Extend the database permission catalog and its TypeScript mirror, dependencies, translations and role-assignment checks. Verify the default is off for existing roles and assignments, including HR. Test two HR staff together: give one a custom role carrying the switch and verify only that person can reset passwords. Rename the custom role, remove it, and disable its switch in separate cases to verify that authorization follows the current grant.
2. Apply the target rule to the employee detail screen, server action and database authorization. Check effective permissions at execution. Test enable, revoke, mixed-role administrator, self, inactive and cross-company targets, bulk restrictions, and assisted reset without a phone.
3. Implement the public recovery steps and private issuance and dispatch rules below. Exercise the public and assisted routes independently, then verify both through normal sign-in and mandatory password change.

## Safeguards and acceptance tests

- Confirm that a custom login code works, a superseded code fails, and the hint reveals exactly four digits in both languages.
- For unknown, inactive, administrator, and missing-mobile accounts, use the same public interaction with a plausible masked hint. A wrong number or ineligible account must produce neither a password change nor an SMS.
- In ten minutes allow 30 lookups per source and ten per login code. Each request lasts ten minutes and allows five confirmations. Limit issuance to once per minute and three times per hour per account. Repeated clicks and concurrent submissions must issue at most one credential per allowed request.
- Use the existing password SMS configuration. When sending is disabled, simulated, or cannot be queued, preserve the current credential. Handle a later provider failure or unknown delivery status explicitly, offer assisted recovery, and avoid automatic password rotation on each retry.
- Keep the temporary password out of public responses, profile SMS history, administrator logs and audit entries. Test both successful and failed dispatch with a fake provider.
- The owner chose the existing SMS mobile as the recovery mobile. HR can correct it using existing employee information permissions. A correction immediately redirects future recovery and invalidates any still-current temporary password issued by public recovery for the old mobile.
- Verify the entire flow with a synthetic employee in both locales, including normal login, mandatory password change, and reuse of the spent temporary password.
