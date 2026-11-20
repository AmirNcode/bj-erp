import { beforeEach, describe, expect, it, vi } from 'vitest';

const U = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const COMPANY = U(1), RFP = U(2), STAGE = U(3), FID = U(4);

const calls: string[] = [];
let cookieValue: string | undefined;
let rpcImpl: (fn: string, args: unknown) => { data?: unknown; error?: { code: string } | null };
let user: { id: string } | null;
const store = {
  put: vi.fn(), get: vi.fn(), remove: vi.fn(), exists: vi.fn(),
};

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => (cookieValue ? { value: cookieValue } : undefined) }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    rpc: async (fn: string, args: unknown) => {
      calls.push(fn);
      return { data: null, error: null, ...rpcImpl(fn, args) };
    },
  }),
}));
vi.mock('@/lib/files/store', async (orig) => ({
  ...(await orig<typeof import('@/lib/files/store')>()),
  getFileStore: () => store,
}));

import { POST } from '@/app/api/sales/files/route';
import { GET, DELETE } from '@/app/api/sales/files/[id]/route';

function post(headers: Record<string, string> = {}, query = `rfp=${RFP}&stage=${STAGE}`) {
  return POST(new Request(`http://x/api/sales/files?${query}`, {
    method: 'POST',
    headers: { 'x-file-name': encodeURIComponent('../a "b".pdf'), 'content-length': '5', ...headers },
    body: new Uint8Array(5),
    // @ts-expect-error duplex is required by Node fetch for stream bodies
    duplex: 'half',
  }));
}

beforeEach(() => {
  calls.length = 0;
  cookieValue = undefined;
  user = { id: 'u' };
  Object.values(store).forEach((f) => f.mockReset());
  store.put.mockResolvedValue({ size: 5, sha256: 'a'.repeat(64) });
  rpcImpl = (fn) => (fn === 'app_sales_file_begin' ? { data: { id: FID, company_id: COMPANY } } : {});
});

describe('POST /api/sales/files', () => {
  it('403 under View as, before any RPC', async () => {
    cookieValue = 'sess';
    expect((await post()).status).toBe(403);
    expect(calls).toEqual([]);
  });
  it('401 without a session, 400 without X-File-Name', async () => {
    user = null;
    expect((await post()).status).toBe(401);
    user = { id: 'u' };
    expect((await post({ 'x-file-name': '' })).status).toBe(400);
    expect((await post({}, 'rfp=nope&stage=x')).status).toBe(400);
  });
  it('413 when the declared size is over the cap, without begin or put', async () => {
    expect((await post({ 'content-length': '52428801' })).status).toBe(413);
    expect(calls).toEqual([]);
    expect(store.put).not.toHaveBeenCalled();
  });
  it('begin -> put -> commit in order, cleaned name, 201', async () => {
    let beginArgs: { p_name: string } | undefined;
    rpcImpl = (fn, a) => { if (fn === 'app_sales_file_begin') { beginArgs = a as { p_name: string }; return { data: { id: FID, company_id: COMPANY } }; } return {}; };
    const res = await post();
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: FID });
    expect(calls).toEqual(['app_sales_file_begin', 'app_sales_file_commit']);
    expect(beginArgs?.p_name).toBe('a "b".pdf');
    expect(store.put.mock.calls[0][0]).toBe(`${COMPANY}/${RFP}/${FID}`);
    expect(store.put.mock.calls[0][2]).toBe(5);
    expect(store.remove).not.toHaveBeenCalled();
  });
  it('maps begin errors (42501 -> 403, P0002 -> 404) and never touches the store', async () => {
    rpcImpl = () => ({ error: { code: '42501' } });
    expect((await post()).status).toBe(403);
    rpcImpl = () => ({ error: { code: 'P0002' } });
    expect((await post()).status).toBe(404);
    expect(store.put).not.toHaveBeenCalled();
  });
  it('put failure: remove the bytes and abort the row', async () => {
    store.put.mockRejectedValue(new Error('disk'));
    expect((await post()).status).toBe(500);
    expect(store.remove).toHaveBeenCalledWith(`${COMPANY}/${RFP}/${FID}`);
    expect(calls).toEqual(['app_sales_file_begin', 'app_sales_file_abort']);
  });
  it('streamed body over the declared size: 413 with cleanup', async () => {
    const { TooLargeError } = await import('@/lib/files/limits');
    store.put.mockRejectedValue(new TooLargeError());
    expect((await post()).status).toBe(413);
    expect(store.remove).toHaveBeenCalled();
    expect(calls).toContain('app_sales_file_abort');
  });
  it('fewer bytes than declared: 400 with cleanup', async () => {
    store.put.mockResolvedValue({ size: 3, sha256: 'a'.repeat(64) });
    expect((await post()).status).toBe(400);
    expect(calls).toEqual(['app_sales_file_begin', 'app_sales_file_abort']);
    expect(store.remove).toHaveBeenCalled();
  });
  it('commit failure cleans up too', async () => {
    rpcImpl = (fn) => (fn === 'app_sales_file_begin' ? { data: { id: FID, company_id: COMPANY } }
      : fn === 'app_sales_file_commit' ? { error: { code: '22023' } } : {});
    expect((await post()).status).toBe(400);
    expect(calls).toEqual(['app_sales_file_begin', 'app_sales_file_commit', 'app_sales_file_abort']);
    expect(store.remove).toHaveBeenCalled();
  });
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe('GET /api/sales/files/[id]', () => {
  it('404 for a non-uuid without a DB call', async () => {
    expect((await GET(new Request('http://x'), ctx('nope'))).status).toBe(404);
    expect(calls).toEqual([]);
  });
  it.each(['P0002', '42501', 'XX000'])('404 on any get error (%s)', async (code) => {
    rpcImpl = () => ({ error: { code } });
    const res = await GET(new Request('http://x'), ctx(FID));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not found' });
  });
  it('streams as attachment with safe headers', async () => {
    rpcImpl = () => ({ data: { id: FID, company_id: COMPANY, rfp_id: RFP, name: 'قرارداد "نهایی".pdf', size_bytes: 5 } });
    store.get.mockResolvedValue({ stream: new Response('hello').body, size: 5 });
    const res = await GET(new Request('http://x'), ctx(FID));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.text()).toBe('hello');
  });
  it('410 when the row exists but the bytes are gone', async () => {
    rpcImpl = () => ({ data: { id: FID, company_id: COMPANY, rfp_id: RFP, name: 'a', size_bytes: 5 } });
    store.get.mockResolvedValue(null);
    expect((await GET(new Request('http://x'), ctx(FID))).status).toBe(410);
  });
});

describe('DELETE /api/sales/files/[id]', () => {
  it('403 under View as', async () => {
    cookieValue = 's';
    expect((await DELETE(new Request('http://x'), ctx(FID))).status).toBe(403);
    expect(calls).toEqual([]);
  });
  it('RPC first, then remove the bytes, 204', async () => {
    rpcImpl = () => ({ data: { company_id: COMPANY, rfp_id: RFP } });
    expect((await DELETE(new Request('http://x'), ctx(FID))).status).toBe(204);
    expect(store.remove).toHaveBeenCalledWith(`${COMPANY}/${RFP}/${FID}`);
  });
  it('keeps the bytes when the RPC refuses', async () => {
    rpcImpl = () => ({ error: { code: '42501' } });
    expect((await DELETE(new Request('http://x'), ctx(FID))).status).toBe(403);
    expect(store.remove).not.toHaveBeenCalled();
  });
});
