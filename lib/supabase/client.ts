/**
 * Supabase browser client — for use in Client Components ('use client').
 *
 * Uses @supabase/ssr createBrowserClient which manages its own cookie storage
 * in the browser (document.cookie).
 *
 * Do NOT import from this file in Server Components or Server Actions —
 * use ./server instead.
 */

'use client'

import { createBrowserClient } from '@supabase/ssr'
import type { Database } from './types'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
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
 * Creates a Supabase browser client typed with the generated Database schema.
 *
 * Call this inside a Client Component — each call returns the same singleton
 * instance (createBrowserClient handles deduplication internally).
 */
export function createClient() {
  return createBrowserClient<Database>(supabaseUrl!, supabaseAnonKey!)
}
