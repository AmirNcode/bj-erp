import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { VIEW_AS_COOKIE } from '@/lib/supabase/constants';
import { contentDisposition } from '@/lib/files/contentDisposition';
import { fileKey, getFileStore, isUuid } from '@/lib/files/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status });
const notFound = () => json(404, { error: 'not found' });

/** Download. Any RPC error is a plain 404: a guessed id never learns whether it exists. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!isUuid(id)) return notFound();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return json(401, { error: 'unauthorized' });

  const { data, error } = await supabase.rpc('app_sales_file_get', { p_id: id });
  if (error || !data) return notFound();
  const f = data as { id: string; company_id: string; rfp_id: string; name: string; size_bytes: number };

  const found = await getFileStore().get(fileKey(f.company_id, f.rfp_id, f.id));
  if (!found) return json(410, { error: 'file missing' });
  return new Response(found.stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(found.size),
      'Content-Disposition': contentDisposition(f.name),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  if ((await cookies()).get(VIEW_AS_COOKIE)?.value) return json(403, { error: 'forbidden' });
  const { id } = await context.params;
  if (!isUuid(id)) return notFound();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return json(401, { error: 'unauthorized' });

  const { data, error } = await supabase.rpc('app_sales_file_delete', { p_id: id });
  if (error) {
    const c = error.code;
    if (c === '42501' || c === '25006') return json(403, { error: 'forbidden' });
    if (c === '22023') return json(400, { error: 'invalid input' });
    if (c === 'P0002') return notFound();
    return json(500, { error: 'error' });
  }
  const f = data as { company_id: string; rfp_id: string };
  try {
    await getFileStore().remove(fileKey(f.company_id, f.rfp_id, id));
  } catch { /* the row is gone; leftover bytes are caught by the clean-up */ }
  return new Response(null, { status: 204 });
}
