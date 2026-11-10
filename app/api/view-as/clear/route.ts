/**
 * View as (FR-86): where a layout sends a dead view.
 *
 * A dead view (`getViewAs()` says `dead`) loses its cookie and lands on the View
 * as tab with a note. A live one keeps its cookie and goes Home: the check runs
 * again here, so a crafted link cannot strip a live view's cookie and leave the
 * open page running without the header. With no view at all, nothing to clear.
 *
 * A non-admin who inherited a stale cookie is sent on from /admin to Home by the
 * existing guard.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getViewAs } from '@/lib/auth/viewAs';
import { VIEW_AS_COOKIE, VIEW_AS_COOKIE_ATTRS } from '@/lib/supabase/constants';
import { DEFAULT_LOCALE, isAppLocale } from '@/lib/i18n/locale';

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('locale');
  const locale = isAppLocale(raw) ? raw : DEFAULT_LOCALE;
  const view = await getViewAs();

  // A relative Location on purpose: behind the gateway, request.nextUrl carries the
  // standalone server's own host (0.0.0.0:3000), which the browser cannot reach.
  // Route handlers, unlike the proxy, get no relative rewrite from Next.js.
  const location =
    view?.status === 'dead' ? `/${locale}/admin/view-as?ended=1` : `/${locale}/home`;
  const response = new NextResponse(null, { status: 307, headers: { Location: location } });
  if (view?.status === 'dead') {
    response.cookies.delete({ name: VIEW_AS_COOKIE, path: VIEW_AS_COOKIE_ATTRS.path });
  }
  return response;
}
