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

/**
 * Header carrying the end user's real IP address, stamped by the Caddy gateway
 * from its own view of the connection (deploy/caddy/Caddyfile). Clients cannot
 * forge it — the gateway deletes any inbound copy before setting its own.
 *
 * GoTrue rate-limits the `/token` endpoint — which serves BOTH password logins
 * and background session refreshes — per client IP, reading the header named by
 * GOTRUE_RATE_LIMIT_HEADER. Most refreshes are issued by the app's own server
 * code on the user's behalf. Forward the trusted header: pinned GoTrue v2.170.0
 * skips its limiter when the configured header is absent. Overwriting it with
 * the app container's address would instead put everyone in one shared bucket.
 */
export const CLIENT_IP_HEADER = 'x-bj-client-ip';
