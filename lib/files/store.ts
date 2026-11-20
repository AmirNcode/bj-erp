/** Storage interface for Sales files (disk now, S3 later). Server-only. */
import { DiskFileStore } from './diskStore';

export interface FileStore {
  put(key: string, body: ReadableStream<Uint8Array>, maxBytes: number): Promise<{ size: number; sha256: string }>;
  get(key: string): Promise<{ stream: ReadableStream<Uint8Array>; size: number } | null>;
  remove(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

export function fileKey(companyId: string, rfpId: string, fileId: string): string {
  for (const p of [companyId, rfpId, fileId]) {
    if (!UUID_RE.test(p)) throw new Error('invalid file key part');
  }
  return `${companyId}/${rfpId}/${fileId}`;
}

let store: FileStore | undefined;
export function getFileStore(): FileStore {
  return (store ??= new DiskFileStore(process.env.FILES_DIR || './.files'));
}
