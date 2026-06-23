/**
 * Composed middleware: Supabase session refresh + next-intl i18n routing.
 *
 * Composition strategy (confirmed via Context7 for both libraries):
 * 1. Call next-intl's handleI18nRouting to get the response with locale
 *    headers/redirects applied.
 * 2. Create the Supabase server client using the *incoming* request cookies
 *    for getAll, and writing new cookies onto the next-intl response in setAll.
 *    This ensures neither middleware clobbers the other's cookie work.
 * 3. Call supabase.auth.getUser() to trigger the session refresh (which
 *    writes updated auth cookies back via setAll if the token was refreshed).
 * 4. Return the (now cookie-enriched) next-intl response.
 */

import createMiddleware from 'next-intl/middleware';
import { createServerClient } from '@supabase/ssr';
import { NextRequest } from 'next/server';
import { routing } from './i18n/routing';

const handleI18nRouting = createMiddleware(routing);

export default async function middleware(request: NextRequest) {
  // Step 1: Run next-intl routing to get locale redirects / rewrites.
  const response = handleI18nRouting(request);

  // Step 2: Create Supabase client — reads cookies from the request,
  // writes refreshed auth cookies onto the response from step 1.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          // Write cookies onto the response so the browser receives them.
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // Step 3: Trigger session refresh (no-op if session is still fresh;
  // writes updated tokens via setAll if refresh was needed).
  await supabase.auth.getUser();

  // Step 4: Return next-intl response (now carrying any refreshed cookies).
  return response;
}

export const config = {
  // Match all pathnames except api routes, _next internals, and static files.
  matcher: ['/((?!api|trpc|_next|_vercel|.*\\..*).*)'],
};
