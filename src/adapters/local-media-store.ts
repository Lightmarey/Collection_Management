import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { MediaReadResult, MediaStore, StoredMedia } from '../ports/media-store';

const MIME_EXTENSIONS = new Map([
  ['image/avif', 'avif'], ['image/bmp', 'bmp'], ['image/gif', 'gif'],
  ['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/svg+xml', 'svg'], ['image/webp', 'webp'],
  ['font/woff', 'woff'], ['font/woff2', 'woff2'], ['font/ttf', 'ttf'], ['font/otf', 'otf'],
]);
const EXTENSION_MIMES = new Map([...MIME_EXTENSIONS].map(([mime, extension]) => [extension, mime]));
const MEDIA_URL = /^km-media:\/\/asset\/([a-f0-9]{64})\.([a-z0-9]+)$/;

export class LocalMediaStore implements MediaStore {
  private readonly directory: string;

  constructor(directory: string) {
    this.directory = directory;
  }

  async put({ bytes, mimeType }: { bytes: Uint8Array; mimeType: string }): Promise<StoredMedia> {
    const extension = MIME_EXTENSIONS.get(mimeType.toLowerCase());
    if (!extension || !bytes.byteLength) throw new Error('unsupported media');
    const contentHash = createHash('sha256').update(bytes).digest('hex');
    const fileName = `${contentHash}.${extension}`;
    const target = path.join(this.directory, fileName);
    await fs.mkdir(this.directory, { recursive: true });
    try {
      await fs.access(target);
    } catch {
      const temporary = path.join(this.directory, `.${randomUUID()}.tmp`);
      await fs.writeFile(temporary, bytes, { flag: 'wx' });
      try { await fs.rename(temporary, target); }
      catch (error) { await fs.rm(temporary, { force: true }); if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    }
    return { url: `km-media://asset/${fileName}`, contentHash, mimeType, byteLength: bytes.byteLength };
  }

  async read(url: string): Promise<MediaReadResult | null> {
    const match = url.match(MEDIA_URL);
    if (!match) return null;
    const mimeType = EXTENSION_MIMES.get(match[2]);
    if (!mimeType) return null;
    try {
      const bytes = await fs.readFile(path.join(this.directory, `${match[1]}.${match[2]}`));
      return { bytes, mimeType };
    } catch {
      return null;
    }
  }

  async remove(url: string) {
    const match = url.match(MEDIA_URL);
    if (!match) return false;
    try { await fs.rm(path.join(this.directory, `${match[1]}.${match[2]}`)); return true; }
    catch { return false; }
  }
}
