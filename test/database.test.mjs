import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migrateDatabase, openKnowledgeDatabase } from '../src/database.mjs';

function tempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-management-'));
}

function closeAndRemove(directory, ...databases) {
  for (const database of databases) database?.close();
  fs.rmSync(directory, { recursive: true, force: true });
}

test('initializes the schema, enables WAL, and rolls back a failed migration', () => {
  const directory = tempDirectory();
  const databasePath = path.join(directory, 'knowledge.sqlite');
  const database = openKnowledgeDatabase(databasePath);
  assert.equal(database.schemaVersion, 5);
  const backup = database.exportJson();
  assert.deepEqual(database.checkJsonBackup(backup).valid, true);
  database.close();
  assert.equal(fs.existsSync(`${databasePath}.startup.bak`), false);

  const reopened = openKnowledgeDatabase(databasePath);
  assert.equal(fs.existsSync(`${databasePath}.startup.bak`), true);
  reopened.close();

  const raw = new Database(databasePath);
  assert.equal(raw.pragma('journal_mode', { simple: true }), 'wal');
  assert.throws(() => migrateDatabase(raw, [
    { version: 1, up() {} },
    { version: 6, up(db) { db.exec('CREATE TABLE transient_migration_table (id INTEGER)'); throw new Error('expected migration failure'); } },
  ]), /数据库迁移失败/);
  assert.equal(raw.prepare("SELECT 1 FROM sqlite_master WHERE name = 'transient_migration_table'").get(), undefined);
  assert.equal(raw.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version, 5);
  raw.close();
  closeAndRemove(directory);
});

test('persists anchored annotations and remaps them across content versions', () => {
  const directory = tempDirectory();
  const database = openKnowledgeDatabase(path.join(directory, 'knowledge.sqlite'), { startupBackup: false });
  const initialBody = '脱敏开头。重复摘录。中间。重复摘录。脱敏结尾。';
  const initial = database.upsertDocument({ source: 'fixture', externalId: 'annotation-fixture', title: '标注 fixture', body: initialBody });
  const secondStart = initialBody.indexOf('重复摘录', initialBody.indexOf('重复摘录') + 1);
  const highlight = database.addHighlight({
    documentId: initial.documentId,
    documentVersionId: initial.versionId,
    exact: '重复摘录',
    prefix: '中间。',
    suffix: '。脱敏结尾。',
    start: secondStart,
    end: secondStart + 4,
    color: 'blue',
  });
  assert.equal(highlight.startOffset, secondStart);
  assert.equal(highlight.status, 'resolved');
  database.addNote({ documentId: initial.documentId, documentVersionId: initial.versionId, body: '保留这个批注', exact: '重复摘录', prefix: '中间。', suffix: '。脱敏结尾。', start: secondStart, end: secondStart + 4 });

  const changedBody = '新增前缀。脱敏开头。重复摘录。中间。重复摘录。脱敏结尾。新增后缀。';
  const updated = database.upsertDocument({ source: 'fixture', externalId: 'annotation-fixture', title: '标注 fixture', body: changedBody });
  const current = database.getDocument(initial.documentId);
  assert.equal(updated.versionCreated, true);
  assert.equal(current.highlights[0].status, 'resolved');
  assert.equal(current.highlights[0].resolvedStart, changedBody.indexOf('重复摘录', changedBody.indexOf('重复摘录') + 1));
  assert.equal(current.notes[0].body, '保留这个批注');
  assert.equal(database.listDocumentVersions(initial.documentId).length, 2);
  assert.equal(database.getDocument(initial.documentId, initial.versionId).isCurrentVersion, false);

  database.updateHighlight(highlight.id, { color: 'green' });
  database.updateNote(current.notes[0].id, { body: '已编辑批注' });
  database.addTag(initial.documentId, '可复用');
  const backup = database.exportJson();
  assert.equal(backup.tables.highlights[0].prefix, '中间。');
  assert.equal(backup.tables.notes[0].body, '已编辑批注');
  database.deleteHighlight(highlight.id);
  database.deleteNote(current.notes[0].id);
  database.close();
  closeAndRemove(directory);
});

test('imports 5000 documents, searches FTS, versions content, and restores JSON backup', () => {
  const directory = tempDirectory();
  const databasePath = path.join(directory, 'knowledge.sqlite');
  const database = openKnowledgeDatabase(databasePath);
  const documents = Array.from({ length: 5000 }, (_, index) => ({
    source: 'fixture',
    externalId: `document-${index}`,
    title: `Sample document ${index}`,
    author: 'Test Author',
    body: index === 4242 ? 'alpha searchable body' : `sample body ${index}`,
    url: `https://example.test/${index}`,
  }));
  const imported = database.importDocuments(documents);
  assert.equal(imported.length, 5000);
  const first = imported[4242];
  database.addNote({ documentId: first.documentId, documentVersionId: first.versionId, body: 'keep this annotation' });
  database.addHighlight({ documentId: first.documentId, documentVersionId: first.versionId, quote: 'alpha' });
  database.addTag(first.documentId, 'important');
  const updated = database.upsertDocument({ ...documents[4242], body: 'alpha searchable body changed' });
  assert.equal(updated.versionCreated, true);

  assert.ok(database.search('changed').some((row) => row.id === first.documentId));
  assert.ok(database.search('important').some((row) => row.id === first.documentId));
  assert.ok(database.search('keep').some((row) => row.id === first.documentId));
  assert.equal(database.listDocuments({ limit: 10 }).length, 10);
  const readingState = database.saveReadingState({ documentId: first.documentId, status: 'reading', favorite: true, knowledgeLevel: 'medium', scrollTop: 320 });
  assert.deepEqual(readingState, { documentId: first.documentId, status: 'reading', favorite: true, knowledgeLevel: 'medium', scrollTop: 320, updatedAt: readingState.updatedAt });
  database.saveReaderSession(first.documentId);
  assert.equal(database.listDocuments({ filter: 'reading' }).some((row) => row.id === first.documentId), true);
  assert.equal(database.listDocuments({ filter: 'favorites' }).some((row) => row.id === first.documentId), true);
  assert.equal(database.getReaderSession().selectedDocumentId, first.documentId);
  assert.equal(database.getDocument(first.documentId).bodyState, 'ok');

  const exported = database.exportJson();
  assert.equal(exported.tables.documents.length, 5000);
  assert.equal(exported.tables.document_versions.length, 5001);
  assert.equal(exported.tables.notes.length, 1);

  const restoredPath = path.join(directory, 'restored.sqlite');
  const restored = openKnowledgeDatabase(restoredPath, { startupBackup: false });
  const check = restored.restoreJsonBackup(exported);
  assert.equal(check.valid, true);
  assert.equal(restored.exportJson().tables.documents.length, 5000);
  assert.ok(restored.search('changed').some((row) => row.id === first.documentId));
  assert.equal(restored.getReaderSession().selectedDocumentId, first.documentId);
  assert.equal(restored.getDocument(first.documentId).scrollTop, 320);
  restored.close();
  database.close();
  closeAndRemove(directory);
});

test('persists source-specific sync jobs, progress, and request pacing', () => {
  const directory = tempDirectory();
  const database = openKnowledgeDatabase(path.join(directory, 'knowledge.sqlite'));
  const source = database.upsertCollection({ source: 'zhihu:column', externalId: 'crossin', name: '知乎专栏 crossin' });
  const job = database.createSyncJob({ type: 'column', source: 'zhihu:column', externalId: 'crossin', url: 'https://zhuanlan.zhihu.com/crossin' });
  assert.equal(job.status, 'queued');
  assert.equal(job.payload.source.type, 'column');
  database.recordSyncRequest(job.id, { kind: 'items', at: '2026-08-11T00:00:00.000Z', delayMs: null });
  const updated = database.updateSyncJob(job.id, {
    status: 'completed',
    payloadPatch: { progress: { total: 1, completed: 1, failed: 0, remaining: 0 } },
    incrementAttempts: true,
  });
  assert.equal(updated.status, 'completed');
  assert.equal(updated.attempts, 1);
  assert.equal(updated.payload.progress.completed, 1);
  assert.equal(updated.payload.accessLog.length, 1);
  assert.equal(source.created, true);
  database.close();
  closeAndRemove(directory);
});
