import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { migrateDatabase, openKnowledgeDatabase } from "../src/database.mjs";

function tempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-management-"));
}

function closeAndRemove(directory, ...databases) {
  for (const database of databases) database?.close();
  fs.rmSync(directory, { recursive: true, force: true });
}

test("initializes the schema, enables WAL, and rolls back a failed migration", () => {
  const directory = tempDirectory();
  const databasePath = path.join(directory, "knowledge.sqlite");
  const database = openKnowledgeDatabase(databasePath);
  assert.equal(database.schemaVersion, 6);
  const backup = database.exportJson();
  assert.deepEqual(database.checkJsonBackup(backup).valid, true);
  database.close();
  assert.equal(fs.existsSync(`${databasePath}.startup.bak`), false);

  const reopened = openKnowledgeDatabase(databasePath);
  assert.equal(fs.existsSync(`${databasePath}.startup.bak`), true);
  reopened.close();

  const raw = new Database(databasePath);
  assert.equal(raw.pragma("journal_mode", { simple: true }), "wal");
  assert.throws(
    () =>
      migrateDatabase(raw, [
        { version: 1, up() {} },
        {
          version: 7,
          up(db) {
            db.exec("CREATE TABLE transient_migration_table (id INTEGER)");
            throw new Error("expected migration failure");
          },
        },
      ]),
    /数据库迁移失败/,
  );
  assert.equal(
    raw
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE name = 'transient_migration_table'",
      )
      .get(),
    undefined,
  );
  assert.equal(
    raw.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()
      .version,
    6,
  );
  raw.close();
  closeAndRemove(directory);
});

test("persists anchored annotations and remaps them across content versions", () => {
  const directory = tempDirectory();
  const database = openKnowledgeDatabase(
    path.join(directory, "knowledge.sqlite"),
    { startupBackup: false },
  );
  const initialBody = "脱敏开头。重复摘录。中间。重复摘录。脱敏结尾。";
  const initial = database.upsertDocument({
    source: "fixture",
    externalId: "annotation-fixture",
    title: "标注 fixture",
    body: initialBody,
  });
  const secondStart = initialBody.indexOf(
    "重复摘录",
    initialBody.indexOf("重复摘录") + 1,
  );
  const highlight = database.addHighlight({
    documentId: initial.documentId,
    documentVersionId: initial.versionId,
    exact: "重复摘录",
    prefix: "中间。",
    suffix: "。脱敏结尾。",
    start: secondStart,
    end: secondStart + 4,
    color: "blue",
  });
  assert.equal(highlight.startOffset, secondStart);
  assert.equal(highlight.status, "resolved");
  database.addNote({
    documentId: initial.documentId,
    documentVersionId: initial.versionId,
    body: "保留这个批注",
    exact: "重复摘录",
    prefix: "中间。",
    suffix: "。脱敏结尾。",
    start: secondStart,
    end: secondStart + 4,
  });

  const changedBody =
    "新增前缀。脱敏开头。重复摘录。中间。重复摘录。脱敏结尾。新增后缀。";
  const updated = database.upsertDocument({
    source: "fixture",
    externalId: "annotation-fixture",
    title: "标注 fixture",
    body: changedBody,
  });
  const current = database.getDocument(initial.documentId);
  assert.equal(updated.versionCreated, true);
  assert.equal(current.highlights[0].status, "resolved");
  assert.equal(
    current.highlights[0].resolvedStart,
    changedBody.indexOf("重复摘录", changedBody.indexOf("重复摘录") + 1),
  );
  assert.equal(current.notes[0].body, "保留这个批注");
  assert.equal(database.listDocumentVersions(initial.documentId).length, 2);
  assert.equal(
    database.getDocument(initial.documentId, initial.versionId)
      .isCurrentVersion,
    false,
  );

  database.updateHighlight(highlight.id, { color: "green" });
  database.updateNote(current.notes[0].id, { body: "已编辑批注" });
  const tag = database.addTag(initial.documentId, "可复用");
  const backup = database.exportJson();
  assert.equal(backup.tables.highlights[0].prefix, "中间。");
  assert.equal(backup.tables.notes[0].body, "已编辑批注");
  database.deleteHighlight(highlight.id);
  database.deleteNote(current.notes[0].id);
  database.removeTag(initial.documentId, tag.id);
  assert.equal(database.listTags().length, 0);
  assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM tags").get().count, 0);
  database.close();
  closeAndRemove(directory);
});

test("filters documents by the intersection of selected tags", () => {
  const directory = tempDirectory();
  const database = openKnowledgeDatabase(path.join(directory, "knowledge.sqlite"), { startupBackup: false });
  const both = database.upsertDocument({ source: "fixture", externalId: "both", title: "Both", body: "body" });
  const onlyFirst = database.upsertDocument({ source: "fixture", externalId: "only-first", title: "Only first", body: "body" });
  const first = database.addTag(both.documentId, "摄影");
  const second = database.addTag(both.documentId, "算法");
  database.addTag(onlyFirst.documentId, "摄影");

  assert.deepEqual(database.listDocuments({ tagIds: [first.id] }).map((item) => item.title).sort(), ["Both", "Only first"]);
  assert.deepEqual(database.listDocuments({ tagIds: [first.id, second.id] }).map((item) => item.title), ["Both"]);
  closeAndRemove(directory, database);
});

test("filters inbox documents by their imported source", () => {
  const directory = tempDirectory();
  const database = openKnowledgeDatabase(path.join(directory, "knowledge.sqlite"), { startupBackup: false });
  const first = database.upsertDocument({ source: "zhihu", externalId: "first", title: "First", body: "body" });
  const second = database.upsertDocument({ source: "zhihu", externalId: "second", title: "Second", body: "body" });
  const source = database.upsertCollection({ source: "zhihu:column", externalId: "series", name: "计算摄影" });
  database.linkCollectionDocument(source.collectionId, first.documentId);

  assert.deepEqual(database.listSources(), [{ id: source.collectionId, name: "计算摄影", documentCount: 1 }]);
  assert.deepEqual(database.listDocuments({ filter: "inbox", sourceId: source.collectionId }).map((item) => item.title), ["First"]);
  assert.equal(database.listDocuments({ filter: "inbox" }).some((item) => item.id === second.documentId), true);
  closeAndRemove(directory, database);
});

test("lists highlights and notes across active documents for the annotation workspace", () => {
  const directory = tempDirectory();
  const database = openKnowledgeDatabase(path.join(directory, "knowledge.sqlite"), {
    startupBackup: false,
  });
  const document = database.upsertDocument({
    source: "fixture",
    externalId: "annotation-index",
    title: "量化文章",
    body: "开头。需要记住的结论。结尾。",
  });
  database.addHighlight({
    documentId: document.documentId,
    exact: "需要记住的结论",
    start: 3,
    end: 11,
    color: "blue",
  });
  database.addNote({
    documentId: document.documentId,
    exact: "需要记住的结论",
    start: 3,
    end: 11,
    body: "稍后复习",
  });
  assert.deepEqual(
    database.listAnnotations().map((item) => [item.kind, item.documentTitle]),
    [["note", "量化文章"], ["highlight", "量化文章"]],
  );
  assert.equal(database.listAnnotations({ kind: "note", query: "复习" }).length, 1);
  database.trashDocument(document.documentId);
  assert.equal(database.listAnnotations().length, 0);
  database.close();
  closeAndRemove(directory);
});

test("imports 5000 documents, searches FTS, versions content, and restores JSON backup", () => {
  const directory = tempDirectory();
  const databasePath = path.join(directory, "knowledge.sqlite");
  const database = openKnowledgeDatabase(databasePath);
  const documents = Array.from({ length: 5000 }, (_, index) => ({
    source: "fixture",
    externalId: `document-${index}`,
    title: `Sample document ${index}`,
    author: "Test Author",
    body: index === 4242 ? "alpha searchable body" : `sample body ${index}`,
    url: `https://example.test/${index}`,
  }));
  const imported = database.importDocuments(documents);
  assert.equal(imported.length, 5000);
  const first = imported[4242];
  database.addNote({
    documentId: first.documentId,
    documentVersionId: first.versionId,
    body: "keep this annotation",
  });
  database.addHighlight({
    documentId: first.documentId,
    documentVersionId: first.versionId,
    quote: "alpha",
  });
  database.addTag(first.documentId, "important");
  const updated = database.upsertDocument({
    ...documents[4242],
    body: "alpha searchable body changed",
  });
  assert.equal(updated.versionCreated, true);

  assert.ok(
    database.search("changed").some((row) => row.id === first.documentId),
  );
  assert.ok(
    database.search("important").some((row) => row.id === first.documentId),
  );
  assert.ok(database.search("keep").some((row) => row.id === first.documentId));
  assert.equal(database.listDocuments({ limit: 10 }).length, 10);
  const readingState = database.saveReadingState({
    documentId: first.documentId,
    tier: "medium",
    favorite: true,
    scrollTop: 320,
  });
  assert.deepEqual(readingState, {
    documentId: first.documentId,
    tier: "medium",
    favorite: true,
    scrollTop: 320,
    updatedAt: readingState.updatedAt,
  });
  database.saveReaderSession(first.documentId);
  assert.equal(
    database
      .listDocuments({ filter: "medium" })
      .some((row) => row.id === first.documentId),
    true,
  );
  assert.equal(
    database
      .listDocuments({ filter: "favorites" })
      .some((row) => row.id === first.documentId),
    true,
  );
  assert.equal(
    database.getReaderSession().selectedDocumentId,
    first.documentId,
  );
  assert.equal(database.getDocument(first.documentId).bodyState, "ok");

  const exported = database.exportJson();
  assert.equal(exported.tables.documents.length, 5000);
  assert.equal(exported.tables.document_versions.length, 5001);
  assert.equal(exported.tables.notes.length, 1);

  const restoredPath = path.join(directory, "restored.sqlite");
  const restored = openKnowledgeDatabase(restoredPath, {
    startupBackup: false,
  });
  const check = restored.restoreJsonBackup(exported);
  assert.equal(check.valid, true);
  assert.equal(restored.exportJson().tables.documents.length, 5000);
  assert.ok(
    restored.search("changed").some((row) => row.id === first.documentId),
  );
  assert.equal(
    restored.getReaderSession().selectedDocumentId,
    first.documentId,
  );
  assert.equal(restored.getDocument(first.documentId).scrollTop, 320);
  restored.close();
  database.close();
  closeAndRemove(directory);
});

test("persists source-specific sync jobs, progress, and request pacing", () => {
  const directory = tempDirectory();
  const database = openKnowledgeDatabase(
    path.join(directory, "knowledge.sqlite"),
  );
  const source = database.upsertCollection({
    source: "zhihu:column",
    externalId: "crossin",
    name: "知乎专栏 crossin",
  });
  const job = database.createSyncJob({
    adapterId: "zhihu",
    type: "column",
    source: "zhihu:column",
    externalId: "crossin",
    url: "https://zhuanlan.zhihu.com/crossin",
  });
  assert.equal(job.status, "queued");
  assert.equal(job.payload.mode, "incremental");
  assert.equal(job.payload.source.adapterId, "zhihu");
  assert.equal(job.payload.source.type, "column");
  assert.equal(
    database.createSyncJob({
      type: "column",
      mode: "full",
      source: "zhihu:column",
      externalId: "crossin",
      url: "https://zhuanlan.zhihu.com/crossin",
    }).payload.mode,
    "full",
  );
  database.recordSyncRequest(job.id, {
    kind: "items",
    at: "2026-08-11T00:00:00.000Z",
    delayMs: null,
  });
  const updated = database.updateSyncJob(job.id, {
    status: "completed",
    payloadPatch: {
      progress: { total: 1, completed: 1, failed: 0, remaining: 0 },
    },
    incrementAttempts: true,
  });
  assert.equal(updated.status, "completed");
  assert.equal(updated.attempts, 1);
  assert.equal(updated.payload.progress.completed, 1);
  assert.equal(updated.payload.accessLog.length, 1);
  assert.equal(source.created, true);
  database.close();
  closeAndRemove(directory);
});

test("supports tiers, trash restore, permanent deletion, and shared media protection", () => {
  const directory = tempDirectory();
  const database = openKnowledgeDatabase(
    path.join(directory, "knowledge.sqlite"),
    { startupBackup: false },
  );
  const shared = {
    url: "km-media://asset/shared.png",
    mimeType: "image/png",
    alt: "cover",
  };
  const first = database.upsertDocument({
    source: "fixture",
    externalId: "trash-1",
    title: "Trash one",
    body: "offline body",
    mediaRefs: [shared],
  });
  const second = database.upsertDocument({
    source: "fixture",
    externalId: "trash-2",
    title: "Trash two",
    body: "other body",
    mediaRefs: [shared],
  });
  database.addTag(first.documentId, "keep relation");
  database.addHighlight({
    documentId: first.documentId,
    documentVersionId: first.versionId,
    quote: "offline",
  });
  database.saveReadingState({
    documentId: first.documentId,
    tier: "long",
    favorite: true,
  });

  database.trashDocument(first.documentId);
  assert.equal(database.listTags().length, 0);
  assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM tags").get().count, 1);
  assert.equal(
    database
      .listDocuments({ filter: "long" })
      .some((row) => row.id === first.documentId),
    false,
  );
  assert.equal(
    database
      .listDocuments({ filter: "trash" })
      .some((row) => row.id === first.documentId),
    true,
  );
  assert.equal(
    database.search("offline").some((row) => row.id === first.documentId),
    false,
  );
  database.upsertDocument({
    source: "fixture",
    externalId: "trash-1",
    title: "Trash one updated",
    body: "updated offline body",
    mediaRefs: [shared],
  });
  assert.equal(
    database
      .listDocuments({ filter: "trash" })
      .some((row) => row.id === first.documentId),
    true,
  );
  database.restoreDocument(first.documentId);
  assert.equal(database.listTags()[0].name, "keep relation");
  assert.equal(
    database
      .listDocuments({ filter: "long" })
      .some((row) => row.id === first.documentId),
    true,
  );

  database.trashDocument(first.documentId);
  const sharedDeletion = database.deleteDocumentPermanently(first.documentId);
  assert.deepEqual(sharedDeletion.orphanedMediaUrls, []);
  assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM tags").get().count, 0);
  database.trashDocument(second.documentId);
  const orphanDeletion = database.deleteDocumentPermanently(second.documentId);
  assert.deepEqual(orphanDeletion.orphanedMediaUrls, [shared.url]);
  database.close();
  closeAndRemove(directory);
});

test("empties trash in one transaction while preserving shared media", () => {
  const directory = tempDirectory();
  const database = openKnowledgeDatabase(path.join(directory, "knowledge.sqlite"), { startupBackup: false });
  const shared = { url: "km-media://asset/shared.png", mimeType: "image/png" };
  const orphan = { url: "km-media://asset/orphan.png", mimeType: "image/png" };
  database.upsertDocument({ source: "fixture", externalId: "active", title: "Active", body: "body", mediaRefs: [shared] });
  const first = database.upsertDocument({ source: "fixture", externalId: "trash-a", title: "A", body: "body", mediaRefs: [shared] });
  const second = database.upsertDocument({ source: "fixture", externalId: "trash-b", title: "B", body: "body", mediaRefs: [orphan] });
  database.addTag(second.documentId, "trash only");
  database.trashDocument(first.documentId);
  database.trashDocument(second.documentId);
  assert.deepEqual(database.emptyTrash(), { deleted: 2, orphanedMediaUrls: [orphan.url] });
  assert.equal(database.listDocuments({ filter: "trash" }).length, 0);
  assert.equal(database.listDocuments({ filter: "inbox" }).length, 1);
  assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM tags").get().count, 0);
  database.close();
  closeAndRemove(directory);
});

test("persists reader typography and view preferences within supported ranges", () => {
  const directory = tempDirectory();
  const database = openKnowledgeDatabase(
    path.join(directory, "knowledge.sqlite"),
    { startupBackup: false },
  );
  const preferences = database.saveReaderPreferences({
    fontFamily: "serif",
    fontSize: 100,
    lineHeight: 1,
    contentWidth: 800,
    pageMargin: 72,
    listView: "table",
    navWidth: 400,
    listWidth: 520,
    tocWidth: 260,
    infoWidth: 340,
  });
  assert.equal(preferences.fontSize, 32);
  assert.equal(preferences.lineHeight, 1.3);
  assert.equal(preferences.navWidth, 360);
  assert.equal(preferences.listWidth, 520);
  assert.equal(database.getReaderPreferences().listView, "table");
  const restored = openKnowledgeDatabase(
    path.join(directory, "restored.sqlite"),
    { startupBackup: false },
  );
  restored.restoreJsonBackup(database.exportJson());
  assert.equal(restored.getReaderPreferences().contentWidth, 800);
  restored.close();
  database.close();
  closeAndRemove(directory);
});

test("tracks and removes a document's remote collection memberships", () => {
  const directory = tempDirectory();
  const database = openKnowledgeDatabase(
    path.join(directory, "knowledge.sqlite"),
    { startupBackup: false },
  );
  const documentUrl = "https://www.zhihu.com/question/1/answer/42";
  const document = database.upsertDocument({
    source: "zhihu",
    externalId: "42",
    title: "answer",
    body: "body",
    url: documentUrl,
  });
  const collection = database.upsertCollection({
    source: "zhihu:collection",
    externalId: "99",
    name: "owned",
  });
  database.linkCollectionDocument(collection.collectionId, document.documentId, 0, "sync-hash");
  assert.equal(database.hasCompleteDocument("zhihu", document.documentId), true);
  assert.equal(database.hasCompleteDocument("zhihu", "42"), true);
  assert.equal(database.hasCompleteDocument("zhihu", documentUrl), true);
  assert.equal(database.getCollectionItemSyncHash(collection.collectionId, "42"), "sync-hash");
  assert.equal(database.getCollectionItemSyncHash(collection.collectionId, documentUrl), null);
  assert.deepEqual(
    database
      .getDocumentSourceMemberships(document.documentId)
      .map((item) => [item.sourceId, item.externalId]),
    [["99", "42"]],
  );
  assert.equal(
    database.unlinkCollectionDocument("zhihu", "99", "https://www.zhihu.com/question/1/answer/42"),
    1,
  );
  assert.deepEqual(
    database.getDocumentSourceMemberships(document.documentId),
    [],
  );
  database.close();
  closeAndRemove(directory);
});
