/**
 * Shared Supabase client constants (importable from client + server code).
 *
 * AUTH_COOKIE_NAME pins the session cookie name explicitly. Without it,
 * @supabase/ssr derives the name from the Supabase URL's first host label
 * (`sb-<label>-auth-token`) — and in the self-host package the browser client
 * (public HTTPS URL) and the server client (internal gateway URL) see
 * DIFFERENT hosts, so they'd read/write different cookies and every login
 * would bounce straight back to /login.
 */
export const AUTH_COOKIE_NAME = 'bj-auth';
