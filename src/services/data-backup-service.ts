import fs from "node:fs/promises";
import path from "node:path";
import type { Dirent } from "node:fs";

const MEDIA_FILE = /^[a-f0-9]{64}\.[a-z0-9]+$/;

type BackupStore = {
  schemaVersion: number;
  exportJson(): Record<string, unknown>;
  exportJsonBackup(filePath: string): Record<string, unknown>;
  checkJsonBackup(backup: Record<string, unknown>): Record<string, unknown>;
  restoreJsonBackup(backup: Record<string, unknown>): Record<string, unknown>;
};

function folderStamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

async function copyMedia(source: string, destination: string) {
  await fs.mkdir(destination, { recursive: true });
  let entries: Dirent<string>[] = [];
  try {
    entries = await fs.readdir(source, {
      withFileTypes: true,
      encoding: "utf8",
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
  let copied = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !MEDIA_FILE.test(entry.name)) continue;
    await fs.copyFile(
      path.join(source, entry.name),
      path.join(destination, entry.name),
    );
    copied += 1;
  }
  return copied;
}

export class DataBackupService {
  private readonly database: BackupStore;
  private readonly dataRoot: string;
  private readonly mediaDirectory: string;

  constructor(
    database: BackupStore,
    dataRoot: string,
    mediaDirectory: string,
  ) {
    this.database = database;
    this.dataRoot = dataRoot;
    this.mediaDirectory = mediaDirectory;
  }

  async create(parentDirectory: string) {
    const directory = path.join(
      path.resolve(parentDirectory),
      `ReaderBackup-${folderStamp()}`,
    );
    await fs.mkdir(directory, { recursive: false });
    const backup = this.database.exportJson();
    await fs.writeFile(
      path.join(directory, "database.json"),
      JSON.stringify(backup),
      "utf8",
    );
    const mediaFiles = await copyMedia(
      this.mediaDirectory,
      path.join(directory, "media"),
    );
    await fs.writeFile(
      path.join(directory, "manifest.json"),
      JSON.stringify({
        format: "knowledge-management-directory-backup",
        version: 1,
        createdAt: new Date().toISOString(),
        schemaVersion: this.database.schemaVersion,
        mediaFiles,
      }),
      "utf8",
    );
    return { path: directory, mediaFiles };
  }

  async restore(directory: string) {
    const source = path.resolve(directory);
    const manifest = JSON.parse(
      await fs.readFile(path.join(source, "manifest.json"), "utf8"),
    ) as { format?: unknown; version?: unknown };
    if (
      manifest.format !== "knowledge-management-directory-backup" ||
      manifest.version !== 1
    )
      throw Object.assign(new Error("备份格式无效"), { code: "BACKUP_INVALID" });
    const backup = JSON.parse(
      await fs.readFile(path.join(source, "database.json"), "utf8"),
    ) as Record<string, unknown>;
    const validation = this.database.checkJsonBackup(backup) as {
      valid?: boolean;
      reason?: string;
    };
    if (!validation.valid)
      throw Object.assign(new Error(validation.reason ?? "备份数据库无效"), {
        code: "BACKUP_INVALID",
      });

    const recoveryRoot = path.join(this.dataRoot, "backups");
    await fs.mkdir(recoveryRoot, { recursive: true });
    this.database.exportJsonBackup(
      path.join(recoveryRoot, `pre-restore-${folderStamp()}.json`),
    );
    const mediaFiles = await copyMedia(
      path.join(source, "media"),
      this.mediaDirectory,
    );
    const result = this.database.restoreJsonBackup(backup);
    return { ...result, mediaFiles };
  }
}
