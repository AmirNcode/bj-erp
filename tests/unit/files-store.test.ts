import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DiskFileStore } from '@/lib/files/diskStore';
import { fileKey } from '@/lib/files/store';
import { TooLargeError } from '@/lib/files/limits';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';

function stream(...chunks: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({
    start(c) { chunks.forEach((x) => c.enqueue(x)); c.close(); },
  });
}
async function read(s: ReadableStream<Uint8Array>) {
  return Buffer.from(await new Response(s).arrayBuffer());
}

let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'files-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('DiskFileStore', () => {
  it('puts atomically, returns size and sha256, and gets the bytes back', async () => {
    const s = new DiskFileStore(dir);
    const key = fileKey(U1, U2, U3);
    const bytes = Buffer.from('hello world');
    const r = await s.put(key, stream(bytes.subarray(0, 4), bytes.subarray(4)), 100);
    expect(r).toEqual({ size: 11, sha256: createHash('sha256').update(bytes).digest('hex') });
    expect(await s.exists(key)).toBe(true);
    const got = await s.get(key);
    expect(got!.size).toBe(11);
    expect((await read(got!.stream)).equals(bytes)).toBe(true);
    expect(await readdir(path.join(dir, 'tmp'))).toEqual([]);
  });
  it('refuses a body over maxBytes and leaves nothing behind', async () => {
    const s = new DiskFileStore(dir);
    const key = fileKey(U1, U2, U3);
    await expect(s.put(key, stream(new Uint8Array(11)), 10)).rejects.toThrow(TooLargeError);
    expect(await s.exists(key)).toBe(false);
    expect(await readdir(path.join(dir, 'tmp'))).toEqual([]);
  });
  it('get of missing is null; remove of missing resolves; remove deletes', async () => {
    const s = new DiskFileStore(dir);
    const key = fileKey(U1, U2, U3);
    expect(await s.get(key)).toBeNull();
    await expect(s.remove(key)).resolves.toBeUndefined();
    await s.put(key, stream(Buffer.from('x')), 5);
    await s.remove(key);
    expect(await s.exists(key)).toBe(false);
    expect((await readFile(path.join(dir, '.keep')).catch(() => null))).toBeNull();
  });
  it('refuses keys that escape the root', async () => {
    const s = new DiskFileStore(dir);
    await expect(s.get('../x')).resolves.toBeNull();
    await expect(s.put('../x', stream(Buffer.from('x')), 5)).rejects.toThrow();
  });
});

describe('fileKey', () => {
  it('joins three uuids and rejects other parts', () => {
    expect(fileKey(U1, U2, U3)).toBe(`${U1}/${U2}/${U3}`);
    expect(() => fileKey('..', U2, U3)).toThrow();
    expect(() => fileKey(U1, 'a/b', U3)).toThrow();
  });
});
