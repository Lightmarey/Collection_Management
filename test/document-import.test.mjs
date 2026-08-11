import test from 'node:test';
import assert from 'node:assert/strict';
import { importUrl, parseDocument } from '../src/document-import.mjs';
import { openKnowledgeDatabase } from '../src/database.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('parses Markdown and sanitizes HTML, events, and unsafe links', () => {
  const markdown = parseDocument({
    kind: 'markdown',
    source: 'file',
    externalId: 'file:notes.md',
    content: '# Notes\n\nHello [safe](https://example.test/read) [unsafe](javascript:alert(1))',
  });
  assert.equal(markdown.status, 'ok');
  assert.equal(markdown.document.title, 'Notes');
  assert.match(markdown.document.body, /target="_blank"/);
  assert.match(markdown.document.body, /rel="noopener noreferrer"/);
  assert.doesNotMatch(markdown.document.body, /javascript:|on\w+\s*=/i);

  const html = parseDocument({
    kind: 'html',
    source: 'file',
    externalId: 'file:article.html',
    url: 'https://example.test/article',
    content: '<html><head><meta name="author" content="Sample Author"><meta property="article:published_time" content="2026-08-10"></head><body><article><h1>Article</h1><p>Body</p><img src="/image.png" onerror="alert(1)"></article><script>alert(1)</script></body></html>',
  });
  assert.equal(html.status, 'ok');
  assert.equal(html.document.author, 'Sample Author');
  assert.equal(html.document.publishedAt, '2026-08-10');
  assert.equal(html.document.mediaRefs[0].url, 'https://example.test/image.png');
  assert.doesNotMatch(html.document.body, /script|onerror/i);
});

test('classifies user-authorized URL failures and structure changes', async () => {
  const fetchHtml = (status, body) => async () => ({ status, body });
  assert.equal((await importUrl('https://www.zhihu.com/question/1/answer/2', { fetchHtml: fetchHtml(401, '') })).status, 'login_expired');
  assert.equal((await importUrl('https://zhuanlan.zhihu.com/p/1', { fetchHtml: fetchHtml(429, '') })).status, 'rate_limited');
  assert.equal((await importUrl('https://www.zhihu.com/question/1/answer/2', { fetchHtml: fetchHtml(403, '付费内容') })).status, 'paid_or_no_permission');
  assert.equal((await importUrl('https://www.zhihu.com/question/1/answer/2', { fetchHtml: fetchHtml(200, '<html><body><article><p>Answer</p></article><script>const message = "安全验证";</script></body></html>') })).status, 'ok');
  assert.equal((await importUrl('https://www.zhihu.com/question/1/answer/2', { fetchHtml: fetchHtml(200, '<html><body><div>安全验证</div></body></html>') })).status, 'captcha');
  assert.equal((await importUrl('https://www.zhihu.com/question/1/answer/2', { fetchHtml: fetchHtml(200, '<html><body><article><p>Answer</p></article></body></html>') })).status, 'ok');
  assert.equal((await importUrl('https://www.zhihu.com/question/1/answer/2?page=2', { fetchHtml: fetchHtml(200, '<html></html>') })).status, 'structure_changed');
  assert.equal((await importUrl('http://www.zhihu.com/question/1/answer/2', { fetchHtml: fetchHtml(200, '') })).status, 'unsupported_source');
});

test('records import metadata and errors without replacing the current version', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-management-import-'));
  const database = openKnowledgeDatabase(path.join(directory, 'knowledge.sqlite'), { startupBackup: false });
  const first = database.upsertDocument({
    source: 'zhihu',
    externalId: 'https://www.zhihu.com/question/1/answer/2',
    title: 'Answer',
    author: 'Author',
    url: 'https://www.zhihu.com/question/1/answer/2',
    publishedAt: '2026-08-10',
    fetchedAt: '2026-08-10T00:00:00.000Z',
    body: '<p>First</p>',
    mediaRefs: [{ type: 'img', url: 'https://example.test/image.png', alt: '' }],
  });
  database.addNote({ documentId: first.documentId, documentVersionId: first.versionId, body: 'Keep this note' });
  database.recordImportError({ source: 'zhihu', externalId: 'https://www.zhihu.com/question/1/answer/2', importError: 'paid_or_no_permission' });
  const raw = database.db.prepare('SELECT * FROM documents WHERE id = ?').get(first.documentId);
  assert.equal(raw.import_error, 'paid_or_no_permission');
  assert.equal(database.db.prepare('SELECT COUNT(*) AS count FROM document_versions WHERE document_id = ?').get(first.documentId).count, 1);
  assert.equal(database.db.prepare('SELECT COUNT(*) AS count FROM notes WHERE document_id = ?').get(first.documentId).count, 1);

  const second = database.upsertDocument({
    source: 'zhihu',
    externalId: 'https://www.zhihu.com/question/1/answer/2',
    title: 'Answer',
    author: 'Author',
    url: 'https://www.zhihu.com/question/1/answer/2',
    body: '<p>Second</p>',
    fetchedAt: '2026-08-10T00:01:00.000Z',
  });
  assert.equal(second.versionCreated, true);
  assert.equal(database.db.prepare('SELECT COUNT(*) AS count FROM document_versions WHERE document_id = ?').get(first.documentId).count, 2);
  assert.equal(database.db.prepare('SELECT import_error FROM documents WHERE id = ?').get(first.documentId).import_error, null);
  database.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
