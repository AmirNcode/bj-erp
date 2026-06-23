import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  // Match all pathnames except for api routes, _next internals, and static files
  matcher: ['/((?!api|trpc|_next|_vercel|.*\\..*).*)'],
};
