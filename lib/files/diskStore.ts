import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { TooLargeError } from './limits';
import type { FileStore } from './store';

export class DiskFileStore implements FileStore {
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error('invalid key');
    return full;
  }

  async put(key: string, body: ReadableStream<Uint8Array>, maxBytes: number) {
    const dest = this.resolve(key);
    const tmpDir = path.resolve(this.root, 'tmp');
    await mkdir(tmpDir, { recursive: true });
    const tmp = path.join(tmpDir, randomUUID());
    const hash = createHash('sha256');
    let size = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        size += chunk.length;
        if (size > maxBytes) return cb(new TooLargeError());
        hash.update(chunk);
        cb(null, chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(body as never), counter, createWriteStream(tmp, { flags: 'wx' }));
      await mkdir(path.dirname(dest), { recursive: true });
      await rename(tmp, dest);
    } catch (e) {
      await rm(tmp, { force: true });
      throw e;
    }
    return { size, sha256: hash.digest('hex') };
  }

  async get(key: string) {
    try {
      const file = this.resolve(key);
      const s = await stat(file);
      if (!s.isFile()) return null;
      return { stream: Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>, size: s.size };
    } catch {
      return null;
    }
  }

  async remove(key: string) {
    await rm(this.resolve(key), { force: true });
  }

  async exists(key: string) {
    try {
      return (await stat(this.resolve(key))).isFile();
    } catch {
      return false;
    }
  }
}
