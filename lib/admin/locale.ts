/**
 * The admin panel is English only (owner, 2026-11-04), whatever the signed-in admin's app language:
 * the layout renders it LTR with the English catalog, pages translate and format with this locale,
 * and admin actions localize database errors with it. Links keep the route's own locale.
 * `messages/fa.json` therefore has no `admin` namespace (tests/unit/messages-parity.test.ts).
 */
export const ADMIN_LOCALE = 'en' as const;
