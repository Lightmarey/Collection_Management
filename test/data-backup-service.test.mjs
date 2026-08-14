import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openKnowledgeDatabase } from "../src/database.mjs";
import { DataBackupService } from "../src/services/data-backup-service.ts";

test("backs up and restores the database together with content-addressed media", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "knowledge-full-backup-"));
  const dataRoot = path.join(root, "data");
  const media = path.join(dataRoot, "media");
  const target = path.join(root, "exports");
  await fs.mkdir(media, { recursive: true });
  await fs.mkdir(target, { recursive: true });
  const fileName = `${"a".repeat(64)}.png`;
  await fs.writeFile(path.join(media, fileName), Uint8Array.of(1, 2, 3));
  const database = openKnowledgeDatabase(path.join(dataRoot, "knowledge.sqlite"), {
    startupBackup: false,
  });
  try {
    database.upsertDocument({
      source: "fixture",
      externalId: "backed-up",
      title: "备份正文",
      body: "body",
      mediaRefs: [{ url: `km-media://asset/${fileName}`, mimeType: "image/png" }],
    });
    const service = new DataBackupService(database, dataRoot, media);
    const created = await service.create(target);
    assert.equal(created.mediaFiles, 1);
    assert.equal(
      JSON.parse(await fs.readFile(path.join(created.path, "manifest.json"), "utf8")).format,
      "knowledge-management-directory-backup",
    );
    database.upsertDocument({
      source: "fixture",
      externalId: "after-backup",
      title: "不应保留",
      body: "body",
    });
    await fs.rm(path.join(media, fileName));
    const restored = await service.restore(created.path);
    assert.equal(restored.mediaFiles, 1);
    assert.deepEqual(
      database.listDocuments({ filter: "inbox" }).map((item) => item.title),
      ["备份正文"],
    );
    assert.deepEqual(await fs.readFile(path.join(media, fileName)), Buffer.from([1, 2, 3]));
    assert.equal((await fs.readdir(path.join(dataRoot, "backups"))).length, 1);
  } finally {
    database.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
