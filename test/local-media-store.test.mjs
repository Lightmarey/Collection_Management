import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LocalMediaStore } from '../src/adapters/local-media-store.ts';
import { localizeDocumentMedia } from '../src/services/media-localizer.ts';
import { sanitizeSvg } from '../src/services/svg-sanitizer.mjs';

test('stores media outside SQLite with stable content-addressed URLs', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-media-'));
  try {
    const store = new LocalMediaStore(directory);
    const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const first = await store.put({ bytes, mimeType: 'image/png' });
    const second = await store.put({ bytes, mimeType: 'image/png' });
    assert.equal(first.url, second.url);
    assert.match(first.url, /^km-media:\/\/asset\/[a-f0-9]{64}\.png$/);
    assert.equal(first.byteLength, bytes.byteLength);
    assert.deepEqual(await store.read(first.url), { bytes: Buffer.from(bytes), mimeType: 'image/png' });
    assert.equal((await fs.readdir(directory)).length, 1);
    assert.equal(await store.read('km-media://asset/../../secret.png'), null);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('rejects empty and unsupported media instead of embedding it', async () => {
  const store = new LocalMediaStore(path.join(os.tmpdir(), 'knowledge-media-unused'));
  await assert.rejects(store.put({ bytes: new Uint8Array(), mimeType: 'image/png' }), /unsupported media/);
  await assert.rejects(store.put({ bytes: Uint8Array.of(1), mimeType: 'image/heic' }), /unsupported media/);
});

test('stores sanitized SVG as vector media and removes active content', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-svg-'));
  try {
    const source = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)"><script>alert(1)</script><defs><path id="x" d="M0 0h10v10z"/></defs><use href="#x"/><path fill="url(https://evil.invalid/fill)"/><image href="https://evil.invalid/x"/></svg>');
    const clean = sanitizeSvg(source);
    assert.ok(clean);
    assert.doesNotMatch(clean.toString(), /script|onload|evil\.invalid|<image/i);
    assert.match(clean.toString(), /viewBox="0 0 10 10"/);
    assert.match(clean.toString(), /href="#x"/);
    const store = new LocalMediaStore(directory);
    const stored = await store.put({ bytes: clean, mimeType: 'image/svg+xml' });
    assert.match(stored.url, /^km-media:\/\/asset\/[a-f0-9]{64}\.svg$/);
    assert.equal((await store.read(stored.url)).mimeType, 'image/svg+xml');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('rewrites document images to local URLs before database persistence', async () => {
  const writes = [];
  const store = {
    async put(input) {
      writes.push(input);
      return { url: 'km-media://asset/abc.png', contentHash: 'abc', mimeType: input.mimeType, byteLength: input.bytes.byteLength };
    },
  };
  const document = {
    source: 'test', externalId: '1', title: '', author: '', url: null, publishedAt: null,
    fetchedAt: new Date(0).toISOString(), importError: null,
    body: '<p>正文</p><img src="https://pic.example/a.png">',
    mediaRefs: [{ type: 'img', url: 'https://pic.example/a.png', alt: '' }],
  };
  const localized = await localizeDocumentMedia(document, store, async () => ({ bytes: Uint8Array.of(1, 2, 3), mimeType: 'image/png' }));
  assert.equal(writes.length, 1);
  assert.match(localized.body, /src="km-media:\/\/asset\/abc\.png"/);
  assert.doesNotMatch(localized.body, /data:image|base64|https:\/\/pic\.example/);
  assert.equal(localized.mediaRefs[0].originalUrl, 'https://pic.example/a.png');
  assert.equal(localized.mediaRefs[0].local, true);
});

test('keeps正文 when one image cannot be stored locally', async () => {
  const document = {
    source: 'test', externalId: '1', title: '正文优先', author: '', url: null, publishedAt: null,
    fetchedAt: new Date(0).toISOString(), importError: null,
    body: '<p>正文仍应保存</p><img src="https://pic.example/vector.svg">',
    mediaRefs: [{ type: 'img', url: 'https://pic.example/vector.svg', alt: '' }],
  };
  const localized = await localizeDocumentMedia(document, { async put() { throw new Error('unsupported media'); } }, async () => ({ bytes: Uint8Array.of(1), mimeType: 'image/svg+xml' }));
  assert.match(localized.body, /正文仍应保存/);
  assert.equal(localized.mediaRefs[0].local, false);
});
