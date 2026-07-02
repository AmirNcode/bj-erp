/**
 * Per-request cached auth context.
 *
 * Session identity is established via `auth.getClaims()`, which verifies the
 * JWT signature **locally** (WebCrypto, asymmetric signing keys — this project
 * uses ES256) instead of `auth.getUser()`'s network round-trip to the Auth
 * server. The JWKS public key is fetched once per server process and cached.
 * If the access token is near expiry, getClaims refreshes the session first —
 * same behavior the middleware relies on.
 *
 * Roles come from the `app_roles` JWT claim (embedded by the
 * `custom_access_token_hook` Postgres function, migration 20260702150001).
 * Tokens issued before the hook was enabled lack the claim; those fall back to
 * one `user_roles` query. Consequence of claim-based roles: an admin's role
 * edit reaches the affected user on their next token refresh (≤1 h), not
 * instantly — accepted trade-off. RLS remains the real enforcement layer
 * either way; these helpers only shape the UI.
 *
 * Everything is wrapped in React `cache()` so the layout guard, page, and any
 * server actions in the same request share one result instead of re-fetching.
 *
 * Server-only. Never import from a Client Component.
 */

import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';

export type AuthUser = { id: string; email?: string };

/** Locally verified JWT claims (or null), computed at most once per request. */
const getCachedClaims = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  return data.claims;
});

/** The authenticated user (or null), verified at most once per request. */
export const getCachedUser = cache(async (): Promise<AuthUser | null> => {
  const claims = await getCachedClaims();
  if (!claims) return null;
  return { id: claims.sub, email: claims.email };
});

/** The caller's role slugs, read from the JWT claim (no DB round-trip). */
export const getCachedRoles = cache(async (userId: string): Promise<string[]> => {
  const claims = await getCachedClaims();
  const claimRoles = claims?.sub === userId ? claims.app_roles : undefined;
  if (Array.isArray(claimRoles)) {
    return claimRoles.filter((r): r is string => typeof r === 'string');
  }

  // Token predates the custom_access_token_hook (or the hook is disabled):
  // fall back to the pre-claim behavior, one user_roles query.
  const supabase = await createClient();
  const { data } = await supabase.from('user_roles').select('role').eq('user_id', userId);
  return (data ?? []).map((r) => r.role as string);
});

/** The caller's own profile row (all columns), fetched at most once per request. */
export const getCachedProfile = cache(async (userId: string) => {
  const supabase = await createClient();
  const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
  return data;
});
