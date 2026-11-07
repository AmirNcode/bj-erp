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

  const url = request.nextUrl.clone();
  url.search = '';
  if (view?.status === 'dead') {
    url.pathname = `/${locale}/admin/view-as`;
    url.searchParams.set('ended', '1');
  } else {
    url.pathname = `/${locale}/home`;
  }

  const response = NextResponse.redirect(url);
  if (view?.status === 'dead') {
    response.cookies.delete({ name: VIEW_AS_COOKIE, path: VIEW_AS_COOKIE_ATTRS.path });
  }
  return response;
}
