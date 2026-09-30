/**
 * Supabase server client — for use in Server Components, Server Actions,
 * and Route Handlers (anything that runs on the server in Next.js App Router).
 *
 * Uses @supabase/ssr createServerClient with the getAll/setAll cookie API
 * (required by Next.js 15+ / Next.js 16 where `cookies()` is async).
 *
 * DO NOT use this in Client Components — import from ./client instead.
 */

import { createServerClient } from '@supabase/ssr'
import { cookies, headers } from 'next/headers'
import { AUTH_COOKIE_NAME, CLIENT_IP_HEADER } from './constants'
import type { Database } from './types'

// Self-host (deploy/): server-side calls use the internal plain-HTTP gateway
// URL (SUPABASE_URL) when set — the public HTTPS cert is a private CA the app
// container doesn't trust. Browser code keeps using NEXT_PUBLIC_SUPABASE_URL.
const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl) {
  throw new Error(
    'Missing env var NEXT_PUBLIC_SUPABASE_URL — add it to .env.local'
  )
}
if (!supabaseAnonKey) {
  throw new Error(
    'Missing env var NEXT_PUBLIC_SUPABASE_ANON_KEY — add it to .env.local'
  )
}

/**
 * Creates a Supabase client bound to the current request's cookies,
 * typed with the generated Database schema.
 * Must be called inside an async context (Server Component, Server Action, etc.)
 * because Next.js 16 `cookies()` is async.
 */
export async function createClient() {
  const cookieStore = await cookies()

  // Forward the gateway-stamped client IP so GoTrue attributes a session
  // refresh made on the user's behalf to that user, not to this container.
  // Absent outside the self-host gateway (local dev). Pinned GoTrue v2.170.0
  // skips its header-based limiter when this value is absent; keep the public
  // deployment behind the gateway so requests always carry its trusted stamp.
  let clientIp: string | null = null
  try {
    clientIp = (await headers()).get(CLIENT_IP_HEADER)
  } catch {
    // No request scope (e.g. build-time evaluation) — nothing to forward.
  }

  return createServerClient<Database>(supabaseUrl!, supabaseAnonKey!, {
    ...(clientIp ? { global: { headers: { [CLIENT_IP_HEADER]: clientIp } } } : {}),
    // Explicit name — browser and server clients may use different Supabase
    // URLs in the self-host package; the derived default would diverge.
    cookieOptions: { name: AUTH_COOKIE_NAME },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options)
          })
        } catch {
          // Server Components cannot set cookies; safe to ignore.
          // Session refresh still works in Server Actions / Route Handlers.
        }
      },
    },
  })
}
