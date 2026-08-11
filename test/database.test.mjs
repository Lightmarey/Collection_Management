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
  assert.equal(database.schemaVersion, 3);
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
    { version: 4, up(db) { db.exec('CREATE TABLE transient_migration_table (id INTEGER)'); throw new Error('expected migration failure'); } },
  ]), /数据库迁移失败/);
  assert.equal(raw.prepare("SELECT 1 FROM sqlite_master WHERE name = 'transient_migration_table'").get(), undefined);
  assert.equal(raw.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version, 3);
  raw.close();
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
