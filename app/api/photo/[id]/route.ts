import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Profile photo bytes (FR-82). The caller's session cookie goes to app_profile_photo, which
 * returns a row only for an active person of the same company.
 *
 * `?v=<version>` URLs never change content, so they are cached for a year; the version comes
 * from app_profile_photo_versions on list screens. Without `v` the browser keeps it 5 minutes and
 * revalidates with the ETag.
 *
 * proxy.ts skips /api, so an expired access token is not refreshed here: the request gets 404
 * and the avatar shows initials until the next page load refreshes the session.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREFIX = 'data:image/jpeg;base64,';

function notFound() {
  return new Response(null, {
    status: 404,
    headers: { 'Cache-Control': 'private, max-age=60', 'X-Content-Type-Options': 'nosniff' },
  });
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!UUID_RE.test(id)) return notFound();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('app_profile_photo', { p_employee: id });
  const row = !error ? data?.[0] : undefined;
  if (!row || !row.photo_data.startsWith(PREFIX)) return notFound();

  const etag = `"${id}-${row.version}"`;
  const versioned = request.nextUrl.searchParams.get('v') === String(row.version);
  const headers: Record<string, string> = {
    ETag: etag,
    'Cache-Control': versioned ? 'private, max-age=31536000, immutable' : 'private, max-age=300',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'",
  };
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers });
  }
  const bytes = Buffer.from(row.photo_data.slice(PREFIX.length), 'base64');
  return new Response(bytes, {
    status: 200,
    headers: { ...headers, 'Content-Type': 'image/jpeg', 'Content-Length': String(bytes.length) },
  });
}
