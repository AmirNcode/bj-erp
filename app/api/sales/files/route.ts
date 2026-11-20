import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { VIEW_AS_COOKIE } from '@/lib/supabase/constants';
import { checkDeclaredSize, cleanFileName, TooLargeError } from '@/lib/files/limits';
import { fileKey, getFileStore, isUuid } from '@/lib/files/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status });

/** Maps an RPC error to the HTTP answer; never echoes the message. */
function rpcStatus(code: string | undefined): Response {
  if (code === '42501' || code === '25006') return json(403, { error: 'forbidden' });
  if (code === '22023') return json(400, { error: 'invalid input' });
  if (code === 'P0002') return json(404, { error: 'not found' });
  return json(500, { error: 'error' });
}

/**
 * Upload: raw body POST (no multipart, nothing buffered). Order: View as -> session -> input ->
 * declared size -> begin -> put -> commit. Any failure after begin removes the bytes and the row.
 */
export async function POST(request: Request) {
  if ((await cookies()).get(VIEW_AS_COOKIE)?.value) return json(403, { error: 'forbidden' });

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return json(401, { error: 'unauthorized' });

  const url = new URL(request.url);
  const rfp = url.searchParams.get('rfp') ?? '';
  const stage = url.searchParams.get('stage') ?? '';
  const rawName = request.headers.get('x-file-name');
  if (!isUuid(rfp) || !isUuid(stage) || !rawName) return json(400, { error: 'invalid input' });
  let name: string;
  try {
    name = cleanFileName(decodeURIComponent(rawName));
  } catch {
    return json(400, { error: 'invalid input' });
  }

  const lengthHeader = request.headers.get('content-length');
  if (!lengthHeader) return json(411, { error: 'length required' });
  const size = Number(lengthHeader);
  try {
    checkDeclaredSize(size);
  } catch (e) {
    return e instanceof TooLargeError ? json(413, { error: 'too large' }) : json(400, { error: 'invalid input' });
  }
  if (!request.body) return json(400, { error: 'invalid input' });

  const mime = request.headers.get('x-file-type')?.slice(0, 200) || null;
  const begun = await supabase.rpc('app_sales_file_begin', {
    p_rfp: rfp, p_stage: stage, p_name: name, p_size: size, p_mime: mime,
  });
  if (begun.error) return rpcStatus(begun.error.code);
  const { id, company_id } = begun.data as { id: string; company_id: string };

  const store = getFileStore();
  const key = fileKey(company_id, rfp, id);
  let status = 500;
  try {
    const put = await store.put(key, request.body, size);
    if (put.size !== size) {
      status = 400;
      throw new Error('short body');
    }
    const done = await supabase.rpc('app_sales_file_commit', { p_id: id, p_size: size, p_sha256: put.sha256 });
    if (done.error) {
      status = rpcStatus(done.error.code).status;
      throw new Error('commit failed');
    }
    return json(201, { id });
  } catch (e) {
    if (e instanceof TooLargeError) status = 413;
    try { await store.remove(key); } catch { /* best effort; the daily clean-up catches leftovers */ }
    try { await supabase.rpc('app_sales_file_abort', { p_id: id }); } catch { /* same */ }
    return json(status, { error: status === 413 ? 'too large' : status === 400 ? 'invalid input' : 'error' });
  }
}
