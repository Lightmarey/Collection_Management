import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  createTextAnchor,
  locateTextAnchor,
  plainText,
} from "./annotation-anchor.mjs";

export const CURRENT_SCHEMA_VERSION = 6;

const BACKUP_TABLES = [
  "documents",
  "document_versions",
  "collections",
  "collection_items",
  "highlights",
  "notes",
  "tags",
  "document_tags",
  "processing_results",
  "relations",
  "tasks",
  "jobs",
  "reading_states",
  "reader_session",
  "reader_preferences",
];

const TABLE_COLUMNS = {
  documents: [
    "id",
    "source",
    "external_id",
    "current_version_id",
    "title",
    "author",
    "url",
    "published_at",
    "fetched_at",
    "media_json",
    "import_error",
    "deleted_at",
    "created_at",
    "updated_at",
  ],
  document_versions: [
    "id",
    "document_id",
    "version_number",
    "title",
    "author",
    "body",
    "content_hash",
    "published_at",
    "fetched_at",
    "media_json",
    "import_error",
    "created_at",
  ],
  collections: [
    "id",
    "source",
    "external_id",
    "name",
    "description",
    "created_at",
    "updated_at",
  ],
  collection_items: [
    "collection_id",
    "document_id",
    "position",
    "sync_hash",
    "created_at",
  ],
  highlights: [
    "id",
    "document_id",
    "document_version_id",
    "quote",
    "exact",
    "prefix",
    "suffix",
    "start_offset",
    "end_offset",
    "resolved_start",
    "resolved_end",
    "status",
    "color",
    "created_at",
    "updated_at",
  ],
  notes: [
    "id",
    "document_id",
    "document_version_id",
    "body",
    "exact",
    "prefix",
    "suffix",
    "start_offset",
    "end_offset",
    "resolved_start",
    "resolved_end",
    "status",
    "created_at",
    "updated_at",
  ],
  tags: ["id", "name", "created_at"],
  document_tags: ["document_id", "tag_id", "created_at"],
  processing_results: [
    "id",
    "document_id",
    "document_version_id",
    "kind",
    "status",
    "payload_json",
    "created_at",
  ],
  relations: [
    "id",
    "from_document_id",
    "to_document_id",
    "relation_type",
    "created_at",
  ],
  tasks: [
    "id",
    "task_type",
    "status",
    "payload_json",
    "created_at",
    "updated_at",
  ],
  jobs: [
    "id",
    "task_id",
    "status",
    "attempts",
    "last_error",
    "created_at",
    "updated_at",
  ],
  reading_states: [
    "document_id",
    "tier",
    "favorite",
    "scroll_top",
    "updated_at",
  ],
  reader_session: ["id", "selected_document_id", "updated_at"],
  reader_preferences: ["id", "payload_json", "updated_at"],
};

const MIGRATIONS = [
  {
    version: 1,
    up(db) {
      db.exec(`
        CREATE TABLE documents (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          external_id TEXT NOT NULL,
          current_version_id TEXT,
          title TEXT NOT NULL DEFAULT '',
          author TEXT NOT NULL DEFAULT '',
          url TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (source, external_id),
          FOREIGN KEY (current_version_id) REFERENCES document_versions(id)
        );

        CREATE TABLE document_versions (
          id TEXT PRIMARY KEY,
          document_id TEXT NOT NULL,
          version_number INTEGER NOT NULL,
          title TEXT NOT NULL DEFAULT '',
          author TEXT NOT NULL DEFAULT '',
          body TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE (document_id, version_number),
          FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
        );
        CREATE INDEX document_versions_document_idx ON document_versions(document_id, version_number DESC);

        CREATE TABLE collections (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          external_id TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (source, external_id)
        );

        CREATE TABLE collection_items (
          collection_id TEXT NOT NULL,
          document_id TEXT NOT NULL,
          position INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          PRIMARY KEY (collection_id, document_id),
          FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
          FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
        );

        CREATE TABLE highlights (
          id TEXT PRIMARY KEY,
          document_id TEXT NOT NULL,
          document_version_id TEXT,
          quote TEXT NOT NULL,
          start_offset INTEGER,
          end_offset INTEGER,
          color TEXT NOT NULL DEFAULT 'yellow',
          created_at TEXT NOT NULL,
          FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
          FOREIGN KEY (document_version_id) REFERENCES document_versions(id) ON DELETE SET NULL
        );

        CREATE TABLE notes (
          id TEXT PRIMARY KEY,
          document_id TEXT NOT NULL,
          document_version_id TEXT,
          body TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
          FOREIGN KEY (document_version_id) REFERENCES document_versions(id) ON DELETE SET NULL
        );

        CREATE TABLE tags (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL
        );

        CREATE TABLE document_tags (
          document_id TEXT NOT NULL,
          tag_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (document_id, tag_id),
          FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
          FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
        );

        CREATE TABLE processing_results (
          id TEXT PRIMARY KEY,
          document_id TEXT NOT NULL,
          document_version_id TEXT,
          kind TEXT NOT NULL,
          status TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
          FOREIGN KEY (document_version_id) REFERENCES document_versions(id) ON DELETE SET NULL
        );

        CREATE TABLE relations (
          id TEXT PRIMARY KEY,
          from_document_id TEXT NOT NULL,
          to_document_id TEXT NOT NULL,
          relation_type TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE (from_document_id, to_document_id, relation_type),
          FOREIGN KEY (from_document_id) REFERENCES documents(id) ON DELETE CASCADE,
          FOREIGN KEY (to_document_id) REFERENCES documents(id) ON DELETE CASCADE
        );

        CREATE TABLE tasks (
          id TEXT PRIMARY KEY,
          task_type TEXT NOT NULL,
          status TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE jobs (
          id TEXT PRIMARY KEY,
          task_id TEXT,
          status TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
        );

        CREATE VIRTUAL TABLE search_index USING fts5(
          document_id UNINDEXED,
          title,
          author,
          body,
          tags,
          annotations,
          tokenize = 'unicode61'
        );
      `);
    },
  },
  {
    version: 2,
    up(db) {
      db.exec(`
        ALTER TABLE documents ADD COLUMN published_at TEXT;
        ALTER TABLE documents ADD COLUMN fetched_at TEXT;
        ALTER TABLE documents ADD COLUMN media_json TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE documents ADD COLUMN import_error TEXT;
        ALTER TABLE document_versions ADD COLUMN published_at TEXT;
        ALTER TABLE document_versions ADD COLUMN fetched_at TEXT;
        ALTER TABLE document_versions ADD COLUMN media_json TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE document_versions ADD COLUMN import_error TEXT;
      `);
    },
  },
  {
    version: 3,
    up(db) {
      db.exec(`
        CREATE TABLE reading_states (
          document_id TEXT PRIMARY KEY,
          status TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'reading', 'processed', 'archived')),
          favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
          knowledge_level TEXT NOT NULL DEFAULT '',
          scroll_top REAL NOT NULL DEFAULT 0 CHECK (scroll_top >= 0),
          updated_at TEXT NOT NULL,
          FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
        );
        CREATE INDEX reading_states_status_idx ON reading_states(status);
        CREATE INDEX reading_states_level_idx ON reading_states(knowledge_level);
        CREATE TABLE reader_session (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          selected_document_id TEXT,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (selected_document_id) REFERENCES documents(id) ON DELETE SET NULL
        );
      `);
    },
  },
  {
    version: 4,
    up(db) {
      db.exec(`
        ALTER TABLE highlights ADD COLUMN exact TEXT NOT NULL DEFAULT '';
        ALTER TABLE highlights ADD COLUMN prefix TEXT NOT NULL DEFAULT '';
        ALTER TABLE highlights ADD COLUMN suffix TEXT NOT NULL DEFAULT '';
        ALTER TABLE highlights ADD COLUMN resolved_start INTEGER;
        ALTER TABLE highlights ADD COLUMN resolved_end INTEGER;
        ALTER TABLE highlights ADD COLUMN status TEXT NOT NULL DEFAULT 'needs_repair';
        ALTER TABLE highlights ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
        ALTER TABLE notes ADD COLUMN exact TEXT NOT NULL DEFAULT '';
        ALTER TABLE notes ADD COLUMN prefix TEXT NOT NULL DEFAULT '';
        ALTER TABLE notes ADD COLUMN suffix TEXT NOT NULL DEFAULT '';
        ALTER TABLE notes ADD COLUMN start_offset INTEGER;
        ALTER TABLE notes ADD COLUMN end_offset INTEGER;
        ALTER TABLE notes ADD COLUMN resolved_start INTEGER;
        ALTER TABLE notes ADD COLUMN resolved_end INTEGER;
        ALTER TABLE notes ADD COLUMN status TEXT NOT NULL DEFAULT 'unanchored';
        UPDATE highlights SET exact = quote, resolved_start = start_offset, resolved_end = end_offset,
          status = CASE WHEN start_offset IS NULL THEN 'needs_repair' ELSE 'resolved' END,
          updated_at = created_at WHERE exact = '';
      `);
    },
  },
  {
    version: 5,
    up(db) {
      db.exec("ALTER TABLE collection_items ADD COLUMN sync_hash TEXT");
    },
  },
  {
    version: 6,
    up(db) {
      db.exec(`
        ALTER TABLE documents ADD COLUMN deleted_at TEXT;
        ALTER TABLE reading_states RENAME TO reading_states_v5;
        CREATE TABLE reading_states (
          document_id TEXT PRIMARY KEY,
          tier TEXT NOT NULL DEFAULT 'inbox' CHECK (tier IN ('inbox', 'short', 'medium', 'long', 'archived')),
          favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
          scroll_top REAL NOT NULL DEFAULT 0 CHECK (scroll_top >= 0),
          updated_at TEXT NOT NULL,
          FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
        );
        INSERT INTO reading_states (document_id, tier, favorite, scroll_top, updated_at)
          SELECT document_id,
            CASE WHEN status = 'archived' THEN 'archived'
              WHEN knowledge_level IN ('short', 'medium', 'long') THEN knowledge_level
              ELSE 'inbox' END,
            favorite, scroll_top, updated_at FROM reading_states_v5;
        DROP TABLE reading_states_v5;
        CREATE INDEX reading_states_tier_idx ON reading_states(tier);
        CREATE TABLE reader_preferences (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          payload_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
    },
  },
];

const TIERS = new Set(["inbox", "short", "medium", "long", "archived"]);
const DEFAULT_READER_PREFERENCES = Object.freeze({
  locale: "zh-CN",
  theme: "system",
  fontFamily: "wenkai",
  fontSize: 20,
  lineHeight: 1.75,
  paragraphSpacing: 0.8,
  contentWidth: 760,
  pageMargin: 48,
  listView: "list",
  sidebarCollapsed: false,
  tocHidden: false,
  infoHidden: false,
  rightTab: "body",
  navWidth: 220,
  listWidth: 440,
  tocWidth: 250,
  infoWidth: 330,
});

export class DatabaseError extends Error {
  constructor(message, code = "DATABASE_ERROR", options = {}) {
    super(message, options);
    this.name = "DatabaseError";
    this.code = code;
  }
}

function now() {
  return new Date().toISOString();
}

function text(value) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function contentHash(body) {
  return createHash("sha256").update(body).digest("hex");
}

function nullableText(value) {
  if (value == null || value === "") return null;
  return text(value);
}

function safeJson(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function searchMatch(value) {
  return value
    .split(/\s+/)
    .map((part) => `"${part.replaceAll('"', '""')}"*`)
    .join(" ");
}

function mediaJson(value) {
  return JSON.stringify(Array.isArray(value) ? value : []);
}

function firstCover(value) {
  const media = safeJson(value, []);
  const cover = Array.isArray(media)
    ? media.find((item) => {
        const url = text(item?.url);
        const alt = text(item?.alt);
        return (
          item?.type === "img" &&
          url.startsWith("km-media://asset/") &&
          !/(latex|tex|formula|equation|公式)|\\[A-Za-z]+|[_^{}]/i.test(
            `${alt} ${text(item?.sourceUrl)}`,
          )
        );
      })
    : null;
  return cover?.url ?? null;
}

function summaryText(value) {
  const payload = safeJson(value, null);
  if (typeof payload === "string") return payload.trim() || null;
  if (payload && typeof payload === "object") {
    for (const key of ["summary", "text", "content"])
      if (typeof payload[key] === "string" && payload[key].trim())
        return payload[key].trim();
  }
  return null;
}

function dbError(operation, error) {
  if (error instanceof DatabaseError) return error;
  return new DatabaseError(
    `数据库${operation}失败，请重试或检查本地磁盘空间`,
    "DATABASE_ERROR",
    { cause: error },
  );
}

function schemaMigrationsExist(db) {
  return Boolean(
    db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
      )
      .get(),
  );
}

function parsePayload(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

export function migrateDatabase(db, migrations = MIGRATIONS) {
  try {
    if (!schemaMigrationsExist(db)) {
      const first = migrations[0];
      if (!first || first.version !== 1)
        throw new DatabaseError("数据库迁移版本无效", "MIGRATION_INVALID");
      db.transaction(() => {
        db.exec(
          "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
        );
        first.up(db);
        db.prepare(
          "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
        ).run(first.version, now());
        db.pragma(`user_version = ${first.version}`);
      })();
    }

    let current = Number(
      db
        .prepare(
          "SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations",
        )
        .get().version,
    );
    for (const migration of migrations
      .filter(({ version }) => version > current)
      .sort((a, b) => a.version - b.version)) {
      if (migration.version !== current + 1)
        throw new DatabaseError(
          `数据库迁移缺少版本 ${current + 1}`,
          "MIGRATION_INVALID",
        );
      db.transaction(() => {
        migration.up(db);
        db.prepare(
          "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
        ).run(migration.version, now());
        db.pragma(`user_version = ${migration.version}`);
      })();
      current = migration.version;
    }
    return current;
  } catch (error) {
    throw dbError("迁移", error);
  }
}

function validateBackup(backup) {
  if (!backup || typeof backup !== "object" || Array.isArray(backup))
    return { valid: false, reason: "备份格式不是对象" };
  const schemaVersion = Number(backup.schemaVersion);
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1)
    return { valid: false, reason: "备份版本无效" };
  if (schemaVersion > CURRENT_SCHEMA_VERSION)
    return { valid: false, reason: "备份版本高于当前数据库" };
  if (!backup.tables || typeof backup.tables !== "object")
    return { valid: false, reason: "备份缺少 tables" };
  for (const table of BACKUP_TABLES) {
    const optionalLegacyTable =
      (schemaVersion < 3 &&
        ["reading_states", "reader_session"].includes(table)) ||
      (schemaVersion < 6 && table === "reader_preferences");
    if (!Array.isArray(backup.tables[table]) && !optionalLegacyTable) {
      return { valid: false, reason: `备份缺少表 ${table}` };
    }
  }
  return { valid: true };
}

export class KnowledgeDatabase {
  constructor(db, dbPath) {
    this.db = db;
    this.dbPath = dbPath;
    this.upsertDocument = this.upsertDocument.bind(this);
    this.importDocuments = this.importDocuments.bind(this);
  }

  get schemaVersion() {
    return Number(
      this.db
        .prepare(
          "SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations",
        )
        .get().version,
    );
  }

  close() {
    if (this.db.open) this.db.close();
  }

  upsertCollection(input) {
    const source = text(input?.source).trim();
    const externalId = text(input?.externalId).trim();
    if (!source || !externalId)
      throw new DatabaseError(
        "来源必须包含 source 和 external_id",
        "VALIDATION_ERROR",
      );
    try {
      return this.db.transaction(() => {
        const timestamp = now();
        const name = text(input?.name).trim() || externalId;
        const description = text(input?.description);
        const existing = this.db
          .prepare(
            "SELECT id FROM collections WHERE source = ? AND external_id = ?",
          )
          .get(source, externalId);
        if (existing) {
          this.db
            .prepare(
              "UPDATE collections SET name = ?, description = ?, updated_at = ? WHERE id = ?",
            )
            .run(name, description, timestamp, existing.id);
          return { collectionId: existing.id, created: false };
        }
        const collectionId = input?.id || randomUUID();
        this.db
          .prepare(
            `INSERT INTO collections (id, source, external_id, name, description, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            collectionId,
            source,
            externalId,
            name,
            description,
            timestamp,
            timestamp,
          );
        return { collectionId, created: true };
      })();
    } catch (error) {
      throw dbError("写入来源", error);
    }
  }

  linkCollectionDocument(
    collectionId,
    documentId,
    position = 0,
    syncHash = null,
  ) {
    const collection = text(collectionId).trim();
    const document = text(documentId).trim();
    if (!collection || !document)
      throw new DatabaseError(
        "来源关系必须包含 collection_id 和 document_id",
        "VALIDATION_ERROR",
      );
    try {
      const normalizedHash = nullableText(syncHash);
      this.db
        .prepare(
          `INSERT INTO collection_items (collection_id, document_id, position, sync_hash, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(collection_id, document_id) DO UPDATE SET position = excluded.position, sync_hash = excluded.sync_hash`,
        )
        .run(
          collection,
          document,
          Math.max(0, Number(position) || 0),
          normalizedHash,
          now(),
        );
      return {
        collectionId: collection,
        documentId: document,
        position: Math.max(0, Number(position) || 0),
        syncHash: normalizedHash,
      };
    } catch (error) {
      throw dbError("写入来源关系", error);
    }
  }

  getCollectionItemSyncHash(collectionId, externalId) {
    const collection = text(collectionId).trim();
    const external = text(externalId).trim();
    if (!collection || !external) return null;
    try {
      const row = this.db
        .prepare(
          `SELECT ci.sync_hash AS syncHash
        FROM collection_items ci JOIN collections c ON c.id = ci.collection_id
        JOIN documents d ON d.id = ci.document_id
        WHERE ci.collection_id = ? AND d.external_id = ?`,
        )
        .get(collection, external);
      return row?.syncHash ?? null;
    } catch (error) {
      throw dbError("读取同步摘要", error);
    }
  }

  getDocumentSourceMemberships(documentId) {
    const id = text(documentId).trim();
    if (!id) return [];
    try {
      return this.db
        .prepare(
          `
        SELECT c.source, c.external_id AS sourceId, c.name,
          d.external_id AS externalId, d.source AS documentSource, d.url
        FROM collection_items ci
        JOIN collections c ON c.id = ci.collection_id
        JOIN documents d ON d.id = ci.document_id
        WHERE ci.document_id = ?
        ORDER BY c.name COLLATE NOCASE ASC
      `,
        )
        .all(id);
    } catch (error) {
      throw dbError("读取文档来源关系", error);
    }
  }

  unlinkCollectionDocument(source, sourceId, documentId) {
    try {
      const identifier = text(documentId).trim();
      return this.db
        .prepare(
          `
        DELETE FROM collection_items
        WHERE document_id IN (
          SELECT id FROM documents
          WHERE id = ? OR (source = ? AND (external_id = ? OR url = ?))
        ) AND collection_id IN (
          SELECT id FROM collections WHERE source = ? AND external_id = ?
        )
      `,
        )
        .run(
          identifier,
          text(source).trim(),
          identifier,
          identifier,
          text(source).trim(),
          text(sourceId).trim(),
        ).changes;
    } catch (error) {
      throw dbError("移除文档来源关系", error);
    }
  }

  hasCompleteDocument(source, identifier) {
    const row = this.db
      .prepare(
        `SELECT 1 AS found
      FROM documents d JOIN document_versions v ON v.id = d.current_version_id
      WHERE d.source = ? AND (d.id = ? OR d.external_id = ? OR d.url = ?)
        AND d.deleted_at IS NULL AND length(trim(v.body)) > 0 LIMIT 1`,
      )
      .get(text(source), text(identifier), text(identifier), text(identifier));
    return row?.found === 1;
  }

  createSyncJob(input = {}) {
    const source = text(input.source).trim();
    const externalId = text(input.externalId).trim();
    if (!source || !externalId)
      throw new DatabaseError("同步任务必须包含来源", "VALIDATION_ERROR");
    try {
      const timestamp = now();
      const taskId = randomUUID();
      const jobId = randomUUID();
      const payload = {
        kind: "zhihu-sync",
        mode: input.mode === "full" ? "full" : "incremental",
        source: {
          adapterId: text(input.adapterId) || source.split(":", 1)[0],
          type: text(input.type) || "collection",
          externalId,
          url: text(input.url) || null,
        },
        items: [],
        progress: { total: 0, completed: 0, failed: 0, remaining: 0 },
        accessLog: [],
      };
      this.db.transaction(() => {
        this.db
          .prepare(
            `INSERT INTO tasks (id, task_type, status, payload_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            taskId,
            "zhihu_sync",
            "queued",
            JSON.stringify(payload),
            timestamp,
            timestamp,
          );
        this.db
          .prepare(
            `INSERT INTO jobs (id, task_id, status, attempts, last_error, created_at, updated_at)
          VALUES (?, ?, ?, 0, NULL, ?, ?)`,
          )
          .run(jobId, taskId, "queued", timestamp, timestamp);
      })();
      return this.getSyncJob(jobId);
    } catch (error) {
      throw dbError("创建同步任务", error);
    }
  }

  getSyncJob(jobId) {
    const id = text(jobId).trim();
    if (!id)
      throw new DatabaseError("同步任务 ID 不能为空", "VALIDATION_ERROR");
    try {
      const row = this.db
        .prepare(
          `SELECT j.id, j.task_id, j.status, j.attempts, j.last_error, j.created_at, j.updated_at,
          t.payload_json
        FROM jobs j JOIN tasks t ON t.id = j.task_id WHERE j.id = ?`,
        )
        .get(id);
      if (!row) throw new DatabaseError("同步任务不存在", "JOB_NOT_FOUND");
      return {
        id: row.id,
        taskId: row.task_id,
        status: row.status,
        attempts: row.attempts,
        lastError: row.last_error,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        payload: parsePayload(row.payload_json),
      };
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      throw dbError("读取同步任务", error);
    }
  }

  updateSyncJob(
    jobId,
    {
      status,
      payload,
      payloadPatch,
      lastError,
      incrementAttempts = false,
    } = {},
  ) {
    const current = this.getSyncJob(jobId);
    const nextPayload = payload ?? {
      ...current.payload,
      ...(payloadPatch ?? {}),
    };
    const nextStatus = status ?? current.status;
    const nextError = Object.prototype.hasOwnProperty.call(
      arguments[1] ?? {},
      "lastError",
    )
      ? lastError
      : current.lastError;
    try {
      const timestamp = now();
      this.db.transaction(() => {
        this.db
          .prepare(
            "UPDATE tasks SET status = ?, payload_json = ?, updated_at = ? WHERE id = ?",
          )
          .run(
            nextStatus,
            JSON.stringify(nextPayload),
            timestamp,
            current.taskId,
          );
        this.db
          .prepare(
            `UPDATE jobs SET status = ?, attempts = attempts + ?, last_error = ?, updated_at = ? WHERE id = ?`,
          )
          .run(
            nextStatus,
            incrementAttempts ? 1 : 0,
            nextError,
            timestamp,
            current.id,
          );
      })();
      return this.getSyncJob(current.id);
    } catch (error) {
      throw dbError("更新同步任务", error);
    }
  }

  recordSyncRequest(
    jobId,
    { kind = "unknown", at = now(), delayMs = null } = {},
  ) {
    const current = this.getSyncJob(jobId);
    const accessLog = Array.isArray(current.payload.accessLog)
      ? current.payload.accessLog.slice(-999)
      : [];
    const previous = accessLog.at(-1);
    const observedDelay =
      delayMs == null && previous
        ? Math.max(0, Date.parse(at) - Date.parse(previous.at))
        : delayMs;
    accessLog.push({
      at,
      kind: text(kind),
      delayMs: Number.isFinite(Number(observedDelay))
        ? Number(observedDelay)
        : null,
    });
    return this.updateSyncJob(jobId, {
      payloadPatch: {
        accessLog,
        requestCount: accessLog.length,
        lastRequestAt: at,
      },
    });
  }

  _upsertDocument(input) {
    const source = text(input?.source).trim();
    const externalId = text(input?.externalId).trim();
    if (!source || !externalId)
      throw new DatabaseError(
        "文档必须包含 source 和 external_id",
        "VALIDATION_ERROR",
      );
    const title = text(input?.title);
    const author = text(input?.author);
    const body = text(input?.body);
    const url = input?.url == null ? null : text(input.url);
    const timestamp = now();
    const publishedAt = nullableText(input?.publishedAt);
    const fetchedAt = nullableText(input?.fetchedAt) ?? timestamp;
    const media = mediaJson(input?.mediaRefs);
    const importError = nullableText(input?.importError);
    const existing = this.db
      .prepare("SELECT * FROM documents WHERE source = ? AND external_id = ?")
      .get(source, externalId);
    if (!existing) {
      const documentId = input?.id || randomUUID();
      const versionId = randomUUID();
      this.db
        .prepare(
          `INSERT INTO documents (id, source, external_id, current_version_id, title, author, url, published_at, fetched_at, media_json, import_error, created_at, updated_at)
        VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          documentId,
          source,
          externalId,
          title,
          author,
          url,
          publishedAt,
          fetchedAt,
          media,
          importError,
          timestamp,
          timestamp,
        );
      this.db
        .prepare(
          `INSERT INTO document_versions (id, document_id, version_number, title, author, body, content_hash, published_at, fetched_at, media_json, import_error, created_at)
        VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          versionId,
          documentId,
          title,
          author,
          body,
          contentHash(body),
          publishedAt,
          fetchedAt,
          media,
          importError,
          timestamp,
        );
      this.db
        .prepare("UPDATE documents SET current_version_id = ? WHERE id = ?")
        .run(versionId, documentId);
      this._refreshSearchIndex(documentId);
      return { documentId, versionId, created: true, versionCreated: true };
    }

    const current = this.db
      .prepare("SELECT * FROM document_versions WHERE id = ?")
      .get(existing.current_version_id);
    const changed = !current || current.content_hash !== contentHash(body);
    if (changed) {
      const versionId = randomUUID();
      const versionNumber = Number(
        this.db
          .prepare(
            "SELECT COALESCE(MAX(version_number), 0) + 1 AS next FROM document_versions WHERE document_id = ?",
          )
          .get(existing.id).next,
      );
      this.db
        .prepare(
          `INSERT INTO document_versions (id, document_id, version_number, title, author, body, content_hash, published_at, fetched_at, media_json, import_error, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          versionId,
          existing.id,
          versionNumber,
          title,
          author,
          body,
          contentHash(body),
          publishedAt,
          fetchedAt,
          media,
          importError,
          timestamp,
        );
      this.db
        .prepare(
          `UPDATE documents SET current_version_id = ?, title = ?, author = ?, url = ?, published_at = ?, fetched_at = ?, media_json = ?, import_error = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          versionId,
          title,
          author,
          url,
          publishedAt,
          fetchedAt,
          media,
          importError,
          timestamp,
          existing.id,
        );
      this._remapAnnotations(existing.id, versionId, body);
      this._refreshSearchIndex(existing.id);
      return {
        documentId: existing.id,
        versionId,
        created: false,
        versionCreated: true,
      };
    }

    this.db
      .prepare(
        "UPDATE documents SET title = ?, author = ?, url = ?, published_at = ?, fetched_at = ?, media_json = ?, import_error = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        title,
        author,
        url,
        publishedAt,
        fetchedAt,
        media,
        importError,
        timestamp,
        existing.id,
      );
    this._refreshSearchIndex(existing.id);
    return {
      documentId: existing.id,
      versionId: existing.current_version_id,
      created: false,
      versionCreated: false,
    };
  }

  upsertDocument(input) {
    try {
      return this.db.transaction(() => this._upsertDocument(input))();
    } catch (error) {
      throw dbError("写入文档", error);
    }
  }

  importDocuments(inputs) {
    if (!Array.isArray(inputs))
      throw new DatabaseError("导入数据必须是数组", "VALIDATION_ERROR");
    try {
      return this.db.transaction(() =>
        inputs.map((input) => this._upsertDocument(input)),
      )();
    } catch (error) {
      throw dbError("批量导入", error);
    }
  }

  recordImportError(input) {
    const source = text(input?.source).trim();
    const externalId = text(input?.externalId).trim();
    const importError = text(input?.importError).trim();
    if (!source || !externalId || !importError)
      throw new DatabaseError(
        "导入错误必须包含 source、external_id 和状态",
        "VALIDATION_ERROR",
      );
    try {
      return this.db.transaction(() => {
        const existing = this.db
          .prepare(
            "SELECT * FROM documents WHERE source = ? AND external_id = ?",
          )
          .get(source, externalId);
        const timestamp = now();
        if (!existing) {
          return this._upsertDocument({
            ...input,
            body: "",
            fetchedAt: input?.fetchedAt ?? timestamp,
            importError,
          });
        }
        this.db
          .prepare(
            `UPDATE documents SET title = COALESCE(?, title), author = COALESCE(?, author), url = COALESCE(?, url),
          published_at = COALESCE(?, published_at), fetched_at = ?, import_error = ?, updated_at = ? WHERE id = ?`,
          )
          .run(
            nullableText(input?.title),
            nullableText(input?.author),
            nullableText(input?.url),
            nullableText(input?.publishedAt),
            input?.fetchedAt ?? timestamp,
            importError,
            timestamp,
            existing.id,
          );
        return {
          documentId: existing.id,
          versionId: existing.current_version_id,
          created: false,
          versionCreated: false,
          importError,
        };
      })();
    } catch (error) {
      throw dbError("记录导入错误", error);
    }
  }

  _version(documentId, versionId = null) {
    const id = text(documentId).trim();
    const row = versionId
      ? this.db
          .prepare(
            "SELECT v.* FROM document_versions v WHERE v.document_id = ? AND v.id = ?",
          )
          .get(id, versionId)
      : this.db
          .prepare(
            "SELECT v.* FROM documents d JOIN document_versions v ON v.id = d.current_version_id WHERE d.id = ?",
          )
          .get(id);
    if (!row) throw new DatabaseError("文档版本不存在", "VERSION_NOT_FOUND");
    return row;
  }

  _anchor(documentId, input, allowEmpty = false) {
    const version = this._version(documentId, input?.documentVersionId ?? null);
    const source = plainText(version.body);
    const rawExact = text(input?.exact ?? input?.quote);
    const start = input?.start ?? input?.startOffset;
    const end = input?.end ?? input?.endOffset;
    const exact =
      rawExact ||
      (Number.isFinite(Number(start)) && Number.isFinite(Number(end))
        ? source.slice(Number(start), Number(end))
        : "");
    if (!exact && allowEmpty) return { version, anchor: null };
    if (!exact) throw new DatabaseError("标注必须包含引文", "VALIDATION_ERROR");
    let anchorStart = Number.isFinite(Number(start))
      ? Number(start)
      : source.indexOf(exact);
    if (source.slice(anchorStart, anchorStart + exact.length) !== exact)
      anchorStart = source.indexOf(
        exact,
        Math.max(0, anchorStart - exact.length),
      );
    if (anchorStart < 0)
      throw new DatabaseError("引文不在当前正文中", "ANCHOR_NOT_FOUND");
    const anchor = createTextAnchor({
      text: source,
      start: anchorStart,
      end: anchorStart + exact.length,
      exact,
      prefix: input?.prefix,
      suffix: input?.suffix,
    });
    return { version, anchor, resolution: locateTextAnchor(source, anchor) };
  }

  _remapAnnotations(documentId, versionId, body) {
    const source = plainText(body);
    const resolve = (row) =>
      locateTextAnchor(source, {
        exact: row.exact || row.quote,
        prefix: row.prefix,
        suffix: row.suffix,
        start: row.start_offset,
      });
    const updateHighlight = this.db.prepare(
      `UPDATE highlights SET document_version_id = ?, status = ?, resolved_start = ?, resolved_end = ?, updated_at = ? WHERE id = ?`,
    );
    for (const row of this.db
      .prepare("SELECT * FROM highlights WHERE document_id = ?")
      .all(documentId)) {
      const result = resolve(row);
      updateHighlight.run(
        versionId,
        result.status,
        result.start,
        result.end,
        now(),
        row.id,
      );
    }
    const updateNote = this.db.prepare(
      `UPDATE notes SET document_version_id = ?, status = ?, resolved_start = ?, resolved_end = ?, updated_at = ? WHERE id = ?`,
    );
    for (const row of this.db
      .prepare("SELECT * FROM notes WHERE document_id = ? AND exact <> ''")
      .all(documentId)) {
      const result = resolve(row);
      updateNote.run(
        versionId,
        result.status,
        result.start,
        result.end,
        now(),
        row.id,
      );
    }
  }

  addHighlight(input) {
    try {
      const value = {
        id: input?.id || randomUUID(),
        documentId: text(input?.documentId),
        documentVersionId: null,
        quote: text(input?.exact ?? input?.quote),
        exact: "",
        prefix: "",
        suffix: "",
        startOffset: null,
        endOffset: null,
        resolvedStart: null,
        resolvedEnd: null,
        status: "needs_repair",
        color: text(input?.color) || "yellow",
        createdAt: now(),
        updatedAt: now(),
      };
      return this.db.transaction(() => {
        const prepared = this._anchor(value.documentId, input);
        value.documentVersionId = prepared.version.id;
        Object.assign(value, prepared.anchor, {
          quote: prepared.anchor.exact,
          startOffset: prepared.anchor.start,
          endOffset: prepared.anchor.end,
          resolvedStart: prepared.resolution.start,
          resolvedEnd: prepared.resolution.end,
          status: prepared.resolution.status,
        });
        this.db
          .prepare(
            `INSERT INTO highlights (id, document_id, document_version_id, quote, exact, prefix, suffix, start_offset, end_offset, resolved_start, resolved_end, status, color, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            value.id,
            value.documentId,
            value.documentVersionId,
            value.quote,
            value.exact,
            value.prefix,
            value.suffix,
            value.startOffset,
            value.endOffset,
            value.resolvedStart,
            value.resolvedEnd,
            value.status,
            value.color,
            value.createdAt,
            value.updatedAt,
          );
        this._refreshSearchIndex(value.documentId);
        return value;
      })();
    } catch (error) {
      throw dbError("写入标注", error);
    }
  }

  addNote(input) {
    try {
      const value = {
        id: input?.id || randomUUID(),
        documentId: text(input?.documentId),
        documentVersionId: null,
        body: text(input?.body),
        exact: "",
        prefix: "",
        suffix: "",
        startOffset: null,
        endOffset: null,
        resolvedStart: null,
        resolvedEnd: null,
        status: "unanchored",
        createdAt: now(),
        updatedAt: now(),
      };
      return this.db.transaction(() => {
        const prepared = this._anchor(value.documentId, input, true);
        value.documentVersionId = prepared.version.id;
        if (prepared.anchor)
          Object.assign(value, prepared.anchor, {
            exact: prepared.anchor.exact,
            startOffset: prepared.anchor.start,
            endOffset: prepared.anchor.end,
            resolvedStart: prepared.resolution.start,
            resolvedEnd: prepared.resolution.end,
            status: prepared.resolution.status,
          });
        this.db
          .prepare(
            `INSERT INTO notes (id, document_id, document_version_id, body, exact, prefix, suffix, start_offset, end_offset, resolved_start, resolved_end, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            value.id,
            value.documentId,
            value.documentVersionId,
            value.body,
            value.exact,
            value.prefix,
            value.suffix,
            value.startOffset,
            value.endOffset,
            value.resolvedStart,
            value.resolvedEnd,
            value.status,
            value.createdAt,
            value.updatedAt,
          );
        this._refreshSearchIndex(value.documentId);
        return value;
      })();
    } catch (error) {
      throw dbError("写入批注", error);
    }
  }

  addTag(documentId, name) {
    try {
      return this.db.transaction(() => {
        const timestamp = now();
        const tagName = text(name).trim();
        if (!tagName)
          throw new DatabaseError("标签不能为空", "VALIDATION_ERROR");
        let tag = this.db
          .prepare("SELECT * FROM tags WHERE name = ?")
          .get(tagName);
        if (!tag) {
          const id = randomUUID();
          this.db
            .prepare("INSERT INTO tags (id, name, created_at) VALUES (?, ?, ?)")
            .run(id, tagName, timestamp);
          tag = { id, name: tagName, created_at: timestamp };
        }
        this.db
          .prepare(
            "INSERT OR IGNORE INTO document_tags (document_id, tag_id, created_at) VALUES (?, ?, ?)",
          )
          .run(documentId, tag.id, timestamp);
        this._refreshSearchIndex(documentId);
        return tag;
      })();
    } catch (error) {
      throw dbError("写入标签", error);
    }
  }

  updateHighlight(id, input = {}) {
    try {
      return this.db.transaction(() => {
        const existing = this.db
          .prepare("SELECT * FROM highlights WHERE id = ?")
          .get(text(id));
        if (!existing)
          throw new DatabaseError("标注不存在", "ANNOTATION_NOT_FOUND");
        const prepared = this._anchor(existing.document_id, {
          ...existing,
          ...input,
          quote: input.exact ?? input.quote ?? existing.exact ?? existing.quote,
          startOffset:
            input.start ?? input.startOffset ?? existing.start_offset,
          endOffset: input.end ?? input.endOffset ?? existing.end_offset,
          documentVersionId:
            input.documentVersionId ?? existing.document_version_id,
        });
        const color = text(input.color ?? existing.color) || "yellow";
        const updatedAt = now();
        this.db
          .prepare(
            `UPDATE highlights SET document_version_id = ?, quote = ?, exact = ?, prefix = ?, suffix = ?, start_offset = ?, end_offset = ?, resolved_start = ?, resolved_end = ?, status = ?, color = ?, updated_at = ? WHERE id = ?`,
          )
          .run(
            prepared.version.id,
            prepared.anchor.exact,
            prepared.anchor.exact,
            prepared.anchor.prefix,
            prepared.anchor.suffix,
            prepared.anchor.start,
            prepared.anchor.end,
            prepared.resolution.start,
            prepared.resolution.end,
            prepared.resolution.status,
            color,
            updatedAt,
            existing.id,
          );
        this._refreshSearchIndex(existing.document_id);
        return {
          id: existing.id,
          documentId: existing.document_id,
          documentVersionId: prepared.version.id,
          exact: prepared.anchor.exact,
          quote: prepared.anchor.exact,
          prefix: prepared.anchor.prefix,
          suffix: prepared.anchor.suffix,
          start: prepared.anchor.start,
          end: prepared.anchor.end,
          status: prepared.resolution.status,
          color,
          updatedAt,
        };
      })();
    } catch (error) {
      throw dbError("更新标注", error);
    }
  }

  deleteHighlight(id) {
    try {
      return this.db.transaction(() => {
        const existing = this.db
          .prepare("SELECT document_id FROM highlights WHERE id = ?")
          .get(text(id));
        if (!existing)
          throw new DatabaseError("标注不存在", "ANNOTATION_NOT_FOUND");
        this.db.prepare("DELETE FROM highlights WHERE id = ?").run(text(id));
        this._refreshSearchIndex(existing.document_id);
        return { id: text(id), deleted: true };
      })();
    } catch (error) {
      throw dbError("删除标注", error);
    }
  }

  updateNote(id, input = {}) {
    try {
      return this.db.transaction(() => {
        const existing = this.db
          .prepare("SELECT * FROM notes WHERE id = ?")
          .get(text(id));
        if (!existing)
          throw new DatabaseError("批注不存在", "ANNOTATION_NOT_FOUND");
        const prepared = this._anchor(
          existing.document_id,
          {
            ...existing,
            ...input,
            body: input.body ?? existing.body,
            exact: input.exact ?? input.quote ?? existing.exact,
            startOffset:
              input.start ?? input.startOffset ?? existing.start_offset,
            endOffset: input.end ?? input.endOffset ?? existing.end_offset,
            documentVersionId:
              input.documentVersionId ?? existing.document_version_id,
          },
          true,
        );
        const updatedAt = now();
        const anchor = prepared.anchor;
        this.db
          .prepare(
            `UPDATE notes SET document_version_id = ?, body = ?, exact = ?, prefix = ?, suffix = ?, start_offset = ?, end_offset = ?, resolved_start = ?, resolved_end = ?, status = ?, updated_at = ? WHERE id = ?`,
          )
          .run(
            prepared.version.id,
            text(input.body ?? existing.body),
            anchor?.exact ?? "",
            anchor?.prefix ?? "",
            anchor?.suffix ?? "",
            anchor?.start ?? null,
            anchor?.end ?? null,
            prepared.resolution?.start ?? null,
            prepared.resolution?.end ?? null,
            prepared.resolution?.status ?? "unanchored",
            updatedAt,
            existing.id,
          );
        this._refreshSearchIndex(existing.document_id);
        return {
          id: existing.id,
          documentId: existing.document_id,
          body: text(input.body ?? existing.body),
          status: prepared.resolution?.status ?? "unanchored",
          updatedAt,
        };
      })();
    } catch (error) {
      throw dbError("更新批注", error);
    }
  }

  deleteNote(id) {
    try {
      return this.db.transaction(() => {
        const existing = this.db
          .prepare("SELECT document_id FROM notes WHERE id = ?")
          .get(text(id));
        if (!existing)
          throw new DatabaseError("批注不存在", "ANNOTATION_NOT_FOUND");
        this.db.prepare("DELETE FROM notes WHERE id = ?").run(text(id));
        this._refreshSearchIndex(existing.document_id);
        return { id: text(id), deleted: true };
      })();
    } catch (error) {
      throw dbError("删除批注", error);
    }
  }

  removeTag(documentId, tagId) {
    try {
      return this.db.transaction(() => {
        this.db
          .prepare(
            "DELETE FROM document_tags WHERE document_id = ? AND tag_id = ?",
          )
          .run(text(documentId), text(tagId));
        this._pruneUnusedTags();
        this._refreshSearchIndex(text(documentId));
        return {
          documentId: text(documentId),
          tagId: text(tagId),
          deleted: true,
        };
      })();
    } catch (error) {
      throw dbError("删除标签", error);
    }
  }

  renameTag(tagId, name) {
    const tagName = text(name).trim();
    if (!tagName) throw new DatabaseError("标签不能为空", "VALIDATION_ERROR");
    try {
      return this.db.transaction(() => {
        const tag = this.db
          .prepare("SELECT * FROM tags WHERE id = ?")
          .get(text(tagId));
        if (!tag) throw new DatabaseError("标签不存在", "TAG_NOT_FOUND");
        this.db
          .prepare("UPDATE tags SET name = ? WHERE id = ?")
          .run(tagName, text(tagId));
        for (const row of this.db
          .prepare("SELECT document_id FROM document_tags WHERE tag_id = ?")
          .all(text(tagId)))
          this._refreshSearchIndex(row.document_id);
        return { id: text(tagId), name: tagName };
      })();
    } catch (error) {
      throw dbError("更新标签", error);
    }
  }

  listTags() {
    try {
      return this.db
        .prepare(
          `
        SELECT t.id, t.name, COUNT(d.id) AS documentCount
        FROM tags t LEFT JOIN document_tags dt ON dt.tag_id = t.id
          LEFT JOIN documents d ON d.id = dt.document_id AND d.deleted_at IS NULL
        GROUP BY t.id HAVING COUNT(d.id) > 0
        ORDER BY t.name COLLATE NOCASE ASC
      `,
        )
        .all();
    } catch (error) {
      throw dbError("读取标签", error);
    }
  }

  listAnnotations({ query = "", kind = "all" } = {}) {
    try {
      const value = text(query).trim();
      const clauses = ["d.deleted_at IS NULL"];
      const parameters = [];
      if (kind === "highlight" || kind === "note") {
        clauses.push("annotation.kind = ?");
        parameters.push(kind);
      }
      if (value) {
        clauses.push(
          "(d.title LIKE ? ESCAPE '\\' OR annotation.quote LIKE ? ESCAPE '\\' OR annotation.body LIKE ? ESCAPE '\\')",
        );
        const escaped = `%${value.replace(/[\\%_]/g, "\\$&")}%`;
        parameters.push(escaped, escaped, escaped);
      }
      return this.db
        .prepare(
          `SELECT annotation.id, annotation.kind, annotation.documentId,
            d.title AS documentTitle, annotation.quote, annotation.body,
            annotation.color, annotation.status, annotation.createdAt,
            annotation.updatedAt
          FROM (
            SELECT id, 'highlight' AS kind, document_id AS documentId,
              COALESCE(NULLIF(exact, ''), quote) AS quote, '' AS body,
              color, status, created_at AS createdAt,
              COALESCE(updated_at, created_at) AS updatedAt
            FROM highlights
            UNION ALL
            SELECT id, 'note' AS kind, document_id AS documentId,
              exact AS quote, body, NULL AS color, status,
              created_at AS createdAt, updated_at AS updatedAt
            FROM notes
          ) annotation
          JOIN documents d ON d.id = annotation.documentId
          WHERE ${clauses.join(" AND ")}
          ORDER BY annotation.updatedAt DESC, annotation.createdAt DESC,
            annotation.kind DESC, annotation.id DESC`,
        )
        .all(...parameters);
    } catch (error) {
      throw dbError("读取标注", error);
    }
  }

  listDocuments({
    filter = "inbox",
    query = "",
    sort = "updated",
    limit = 100,
    offset = 0,
  } = {}) {
    const value = text(query).trim();
    const safeLimit = Math.max(1, Math.min(10000, Number(limit) || 100));
    const safeOffset = Math.max(0, Number(offset) || 0);
    const conditions = [];
    const params = [];
    let from =
      "FROM documents d JOIN document_versions v ON v.id = d.current_version_id LEFT JOIN reading_states rs ON rs.document_id = d.id";

    if (value) {
      from += " JOIN search_index ON search_index.document_id = d.id";
      conditions.push("search_index MATCH ?");
      params.push(searchMatch(value));
    }

    const filterValue = text(filter).trim() || "inbox";
    if (filterValue === "trash") conditions.push("d.deleted_at IS NOT NULL");
    else {
      conditions.push("d.deleted_at IS NULL");
      if (TIERS.has(filterValue)) {
        conditions.push("COALESCE(rs.tier, 'inbox') = ?");
        params.push(filterValue);
      }
    }
    if (filterValue === "favorites")
      conditions.push("COALESCE(rs.favorite, 0) = 1");
    else if (filterValue.startsWith("tag:")) {
      conditions.push(
        "EXISTS (SELECT 1 FROM document_tags selected_dt WHERE selected_dt.document_id = d.id AND selected_dt.tag_id = ?)",
      );
      params.push(filterValue.slice(4));
    }

    const orderBy =
      {
        title: "d.title COLLATE NOCASE ASC, d.updated_at DESC",
        duration: "length(COALESCE(v.body, '')) ASC, d.updated_at DESC",
        status:
          "CASE COALESCE(rs.tier, 'inbox') WHEN 'inbox' THEN 0 WHEN 'short' THEN 1 WHEN 'medium' THEN 2 WHEN 'long' THEN 3 ELSE 4 END, d.updated_at DESC",
        updated: "d.updated_at DESC, d.id ASC",
      }[sort] || "d.updated_at DESC, d.id ASC";
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    try {
      const rows = this.db
        .prepare(
          `
        SELECT d.id, d.source, d.external_id AS externalId, d.title, d.author, d.url,
          d.fetched_at AS fetchedAt, d.import_error AS importError,
          COALESCE(rs.tier, 'inbox') AS tier, COALESCE(rs.favorite, 0) AS favorite, d.deleted_at AS deletedAt,
          d.media_json AS mediaJson,
          (SELECT GROUP_CONCAT(t.name, char(31)) FROM document_tags dt JOIN tags t ON t.id = dt.tag_id WHERE dt.document_id = d.id) AS tagNames,
          (SELECT pr.payload_json FROM processing_results pr WHERE pr.document_id = d.id AND pr.kind = 'summary' AND pr.status IN ('completed', 'ok', 'success') ORDER BY pr.created_at DESC LIMIT 1) AS summaryJson,
          d.updated_at AS updatedAt,
          CASE WHEN length(COALESCE(v.body, '')) = 0 THEN 0 ELSE 1 END AS hasBody,
          CAST(CASE WHEN length(COALESCE(v.body, '')) = 0 THEN 1 ELSE (length(v.body) + 1199) / 1200 END AS INTEGER) AS estimatedMinutes
        ${from} ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?
      `,
        )
        .all(...params, safeLimit, safeOffset);
      return rows.map(
        ({ mediaJson: media, summaryJson, tagNames, ...row }) => ({
          ...row,
          coverUrl: firstCover(media),
          summary: summaryText(summaryJson),
          tagNames: tagNames
            ? String(tagNames).split(String.fromCharCode(31))
            : [],
          favorite: Boolean(row.favorite),
          hasBody: Boolean(row.hasBody),
        }),
      );
    } catch (error) {
      throw dbError("读取文档列表", error);
    }
  }

  listDocumentVersions(documentId) {
    const id = text(documentId).trim();
    try {
      return this.db
        .prepare(
          `
        SELECT v.id AS versionId, v.document_id AS documentId, v.version_number AS versionNumber,
          v.title, v.created_at AS createdAt, v.content_hash AS contentHash,
          v.id = d.current_version_id AS isCurrent
        FROM document_versions v JOIN documents d ON d.id = v.document_id
        WHERE v.document_id = ? ORDER BY v.version_number DESC
      `,
        )
        .all(id)
        .map((row) => ({ ...row, isCurrent: Boolean(row.isCurrent) }));
    } catch (error) {
      throw dbError("读取文档版本", error);
    }
  }

  getDocument(documentId, versionId = null) {
    const id = text(documentId).trim();
    if (!id) return null;
    try {
      const row = this.db
        .prepare(
          `
        SELECT d.id, d.source, d.external_id AS externalId, d.title, d.author, d.url,
          d.published_at AS publishedAt, d.fetched_at AS fetchedAt, d.import_error AS importError,
          d.updated_at AS updatedAt,
          v.id AS versionId, v.version_number AS versionNumber, v.body, d.current_version_id AS currentVersionId,
          COALESCE(rs.tier, 'inbox') AS tier, COALESCE(rs.favorite, 0) AS favorite,
          COALESCE(rs.scroll_top, 0) AS scrollTop, d.deleted_at AS deletedAt,
          CASE WHEN length(COALESCE(v.body, '')) = 0 THEN 0 ELSE 1 END AS hasBody,
          CAST(CASE WHEN length(COALESCE(v.body, '')) = 0 THEN 1 ELSE (length(v.body) + 1199) / 1200 END AS INTEGER) AS estimatedMinutes
        FROM documents d JOIN document_versions v ON v.id = ${versionId ? "?" : "d.current_version_id"}
        LEFT JOIN reading_states rs ON rs.document_id = d.id WHERE d.id = ?
      `,
        )
        .get(...(versionId ? [versionId, id] : [id]));
      if (!row) return null;
      const body = typeof row.body === "string" ? row.body : "";
      const highlights = this.db
        .prepare(
          `
        SELECT id, document_version_id AS documentVersionId, quote, exact, prefix, suffix,
          start_offset AS startOffset, end_offset AS endOffset, resolved_start AS resolvedStart,
          resolved_end AS resolvedEnd, status, color, created_at AS createdAt, updated_at AS updatedAt
        FROM highlights WHERE document_id = ? ORDER BY created_at ASC
      `,
        )
        .all(id)
        .map((row) => {
          const resolved = locateTextAnchor(body, row);
          return {
            ...row,
            exact: row.exact || row.quote,
            start: row.startOffset,
            end: row.endOffset,
            status: resolved.status,
            resolvedStart: resolved.start,
            resolvedEnd: resolved.end,
          };
        });
      const notes = this.db
        .prepare(
          `
        SELECT id, document_version_id AS documentVersionId, body, exact, prefix, suffix,
          start_offset AS startOffset, end_offset AS endOffset, resolved_start AS resolvedStart,
          resolved_end AS resolvedEnd, status, created_at AS createdAt, updated_at AS updatedAt
        FROM notes WHERE document_id = ? ORDER BY created_at ASC
      `,
        )
        .all(id)
        .map((row) => {
          if (!row.exact)
            return { ...row, status: "unanchored", start: null, end: null };
          const resolved = locateTextAnchor(body, row);
          return {
            ...row,
            start: row.startOffset,
            end: row.endOffset,
            status: resolved.status,
            resolvedStart: resolved.start,
            resolvedEnd: resolved.end,
          };
        });
      const processingResults = this.db
        .prepare(
          `
        SELECT id, kind, status, payload_json AS payloadJson, created_at AS createdAt
        FROM processing_results WHERE document_id = ? ORDER BY created_at DESC
      `,
        )
        .all(id)
        .map((result) => ({
          ...result,
          payload: safeJson(result.payloadJson, result.payloadJson),
        }));
      const tags = this.db
        .prepare(
          `
        SELECT t.id, t.name FROM tags t JOIN document_tags dt ON dt.tag_id = t.id
        WHERE dt.document_id = ? ORDER BY t.name COLLATE NOCASE ASC
      `,
        )
        .all(id);
      return {
        ...row,
        body,
        isCurrentVersion: row.versionId === row.currentVersionId,
        bodyState: body.includes("\u0000")
          ? "corrupt"
          : body.trim()
            ? "ok"
            : "empty",
        hasBody: Boolean(row.hasBody),
        favorite: Boolean(row.favorite),
        highlights,
        notes,
        tags,
        processingResults,
      };
    } catch (error) {
      throw dbError("读取文档正文", error);
    }
  }

  getReaderSession() {
    try {
      return (
        this.db
          .prepare(
            "SELECT selected_document_id AS selectedDocumentId, updated_at AS updatedAt FROM reader_session WHERE id = 1",
          )
          .get() ?? { selectedDocumentId: null, updatedAt: null }
      );
    } catch (error) {
      throw dbError("读取阅读进度", error);
    }
  }

  saveReaderSession(selectedDocumentId = null) {
    const id =
      selectedDocumentId == null ? null : text(selectedDocumentId).trim();
    try {
      if (
        id &&
        !this.db.prepare("SELECT 1 FROM documents WHERE id = ?").get(id)
      )
        throw new DatabaseError("文档不存在", "DOCUMENT_NOT_FOUND");
      const updatedAt = now();
      this.db
        .prepare(
          `
        INSERT INTO reader_session (id, selected_document_id, updated_at) VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET selected_document_id = excluded.selected_document_id, updated_at = excluded.updated_at
      `,
        )
        .run(id, updatedAt);
      return { selectedDocumentId: id, updatedAt };
    } catch (error) {
      throw dbError("保存当前文档", error);
    }
  }

  saveReadingState(input = {}) {
    const documentId = text(input.documentId).trim();
    if (!documentId)
      throw new DatabaseError("阅读状态缺少文档", "VALIDATION_ERROR");
    try {
      return this.db.transaction(() => {
        if (
          !this.db
            .prepare("SELECT 1 FROM documents WHERE id = ?")
            .get(documentId)
        )
          throw new DatabaseError("文档不存在", "DOCUMENT_NOT_FOUND");
        const existing = this.db
          .prepare("SELECT * FROM reading_states WHERE document_id = ?")
          .get(documentId);
        const tier =
          input.tier == null
            ? (existing?.tier ?? "inbox")
            : text(input.tier).trim();
        const favorite =
          input.favorite == null
            ? Number(existing?.favorite ?? 0)
            : input.favorite
              ? 1
              : 0;
        const scrollTop =
          input.scrollTop == null
            ? Number(existing?.scroll_top ?? 0)
            : Number(input.scrollTop);
        if (!TIERS.has(tier))
          throw new DatabaseError("知识层级无效", "VALIDATION_ERROR");
        if (!Number.isFinite(scrollTop) || scrollTop < 0)
          throw new DatabaseError("阅读位置无效", "VALIDATION_ERROR");
        const updatedAt = now();
        this.db
          .prepare(
            `
          INSERT INTO reading_states (document_id, tier, favorite, scroll_top, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(document_id) DO UPDATE SET tier = excluded.tier, favorite = excluded.favorite,
            scroll_top = excluded.scroll_top, updated_at = excluded.updated_at
        `,
          )
          .run(documentId, tier, favorite, scrollTop, updatedAt);
        return {
          documentId,
          tier,
          favorite: Boolean(favorite),
          scrollTop,
          updatedAt,
        };
      })();
    } catch (error) {
      throw dbError("保存阅读状态", error);
    }
  }

  getLatestSyncJob() {
    const row = this.db
      .prepare(
        `SELECT j.id FROM jobs j JOIN tasks t ON t.id = j.task_id
      WHERE t.task_type = 'zhihu_sync' ORDER BY j.updated_at DESC LIMIT 1`,
      )
      .get();
    return row ? this.getSyncJob(row.id) : null;
  }

  trashDocument(documentId) {
    const id = text(documentId).trim();
    if (!id) throw new DatabaseError("文档不存在", "DOCUMENT_NOT_FOUND");
    const deletedAt = now();
    const result = this.db
      .prepare(
        "UPDATE documents SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
      )
      .run(deletedAt, deletedAt, id);
    if (!result.changes)
      throw new DatabaseError("文档不存在", "DOCUMENT_NOT_FOUND");
    this.db.prepare("DELETE FROM search_index WHERE document_id = ?").run(id);
    return { documentId: id, deletedAt };
  }

  restoreDocument(documentId) {
    const id = text(documentId).trim();
    const updatedAt = now();
    const result = this.db
      .prepare(
        "UPDATE documents SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL",
      )
      .run(updatedAt, id);
    if (!result.changes)
      throw new DatabaseError("文档不存在", "DOCUMENT_NOT_FOUND");
    this._refreshSearchIndex(id);
    return { documentId: id, restored: true };
  }

  deleteDocumentPermanently(documentId) {
    const id = text(documentId).trim();
    return this.db.transaction(() => {
      const row = this.db
        .prepare(
          "SELECT media_json AS mediaJson FROM documents WHERE id = ? AND deleted_at IS NOT NULL",
        )
        .get(id);
      if (!row)
        throw new DatabaseError("请先将文档移到废纸篓", "DOCUMENT_NOT_TRASHED");
      const urls = (safeJson(row.mediaJson, []) ?? [])
        .map((item) => text(item?.url))
        .filter((url) => url.startsWith("km-media://asset/"));
      this.db.prepare("DELETE FROM search_index WHERE document_id = ?").run(id);
      this.db.prepare("DELETE FROM documents WHERE id = ?").run(id);
      this._pruneUnusedTags();
      const remaining = this.db.prepare(
        "SELECT 1 FROM documents WHERE media_json LIKE ? LIMIT 1",
      );
      return {
        documentId: id,
        deleted: true,
        orphanedMediaUrls: [...new Set(urls)].filter(
          (url) => !remaining.get(`%${url}%`),
        ),
      };
    })();
  }

  emptyTrash() {
    return this.db.transaction(() => {
      const rows = this.db
        .prepare("SELECT id, media_json AS mediaJson FROM documents WHERE deleted_at IS NOT NULL")
        .all();
      if (!rows.length) return { deleted: 0, orphanedMediaUrls: [] };
      const urls = rows
        .flatMap((row) => safeJson(row.mediaJson, []) ?? [])
        .map((item) => text(item?.url))
        .filter((url) => url.startsWith("km-media://asset/"));
      this.db.prepare("DELETE FROM documents WHERE deleted_at IS NOT NULL").run();
      this._pruneUnusedTags();
      const remaining = this.db.prepare(
        "SELECT 1 FROM documents WHERE media_json LIKE ? LIMIT 1",
      );
      return {
        deleted: rows.length,
        orphanedMediaUrls: [...new Set(urls)].filter(
          (url) => !remaining.get(`%${url}%`),
        ),
      };
    })();
  }

  getReaderPreferences() {
    const row = this.db
      .prepare(
        "SELECT payload_json AS payloadJson, updated_at AS updatedAt FROM reader_preferences WHERE id = 1",
      )
      .get();
    return {
      ...DEFAULT_READER_PREFERENCES,
      ...(row ? safeJson(row.payloadJson, {}) : {}),
      updatedAt: row?.updatedAt ?? null,
    };
  }

  saveReaderPreferences(input = {}) {
    const current = this.getReaderPreferences();
    const preferences = {
      locale: ["zh-CN", "en-US"].includes(input.locale)
        ? input.locale
        : current.locale,
      theme: ["system", "light", "dark"].includes(input.theme)
        ? input.theme
        : current.theme,
      fontFamily: text(input.fontFamily || current.fontFamily),
      fontSize: Math.max(
        14,
        Math.min(32, Number(input.fontSize ?? current.fontSize)),
      ),
      lineHeight: Math.max(
        1.3,
        Math.min(2.2, Number(input.lineHeight ?? current.lineHeight)),
      ),
      paragraphSpacing: Math.max(
        0,
        Math.min(
          1.5,
          Number(input.paragraphSpacing ?? current.paragraphSpacing),
        ),
      ),
      contentWidth: Math.max(
        560,
        Math.min(1000, Number(input.contentWidth ?? current.contentWidth)),
      ),
      pageMargin: Math.max(
        16,
        Math.min(120, Number(input.pageMargin ?? current.pageMargin)),
      ),
      listView:
        input.listView === "table"
          ? "table"
          : input.listView === "list"
            ? "list"
            : current.listView,
      customFontUrl:
        typeof input.customFontUrl === "string"
          ? input.customFontUrl
          : current.customFontUrl,
      customFontName:
        typeof input.customFontName === "string"
          ? input.customFontName
          : current.customFontName,
      sidebarCollapsed:
        typeof input.sidebarCollapsed === "boolean"
          ? input.sidebarCollapsed
          : current.sidebarCollapsed,
      tocHidden:
        typeof input.tocHidden === "boolean"
          ? input.tocHidden
          : current.tocHidden,
      infoHidden:
        typeof input.infoHidden === "boolean"
          ? input.infoHidden
          : current.infoHidden,
      rightTab:
        input.rightTab === "properties"
          ? "properties"
          : input.rightTab === "body"
            ? "body"
            : current.rightTab,
      navWidth: Math.max(
        170,
        Math.min(360, Number(input.navWidth ?? current.navWidth)),
      ),
      listWidth: Math.max(
        300,
        Math.min(760, Number(input.listWidth ?? current.listWidth)),
      ),
      tocWidth: Math.max(
        180,
        Math.min(420, Number(input.tocWidth ?? current.tocWidth)),
      ),
      infoWidth: Math.max(
        300,
        Math.min(520, Number(input.infoWidth ?? current.infoWidth)),
      ),
    };
    const updatedAt = now();
    this.db
      .prepare(
        `INSERT INTO reader_preferences (id, payload_json, updated_at) VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at`,
      )
      .run(JSON.stringify(preferences), updatedAt);
    return { ...preferences, updatedAt };
  }

  _pruneUnusedTags() {
    this.db
      .prepare(
        "DELETE FROM tags WHERE NOT EXISTS (SELECT 1 FROM document_tags WHERE tag_id = tags.id)",
      )
      .run();
  }

  _refreshSearchIndex(documentId) {
    const row = this.db
      .prepare(
        `
      SELECT d.id, d.title, d.author, v.body,
        COALESCE((SELECT GROUP_CONCAT(t.name, ' ') FROM document_tags dt JOIN tags t ON t.id = dt.tag_id WHERE dt.document_id = d.id), '') AS tags,
        COALESCE((SELECT GROUP_CONCAT(annotation, ' ') FROM (
          SELECT quote AS annotation FROM highlights WHERE document_id = d.id
          UNION ALL SELECT body AS annotation FROM notes WHERE document_id = d.id
        )), '') AS annotations
      FROM documents d JOIN document_versions v ON v.id = d.current_version_id
      WHERE d.id = ? AND d.deleted_at IS NULL`,
      )
      .get(documentId);
    this.db
      .prepare("DELETE FROM search_index WHERE document_id = ?")
      .run(documentId);
    if (row)
      this.db
        .prepare(
          "INSERT INTO search_index (document_id, title, author, body, tags, annotations) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          row.id,
          row.title,
          row.author,
          row.body,
          row.tags,
          row.annotations,
        );
  }

  search(query, limit = 50) {
    const value = text(query).trim();
    if (!value) return [];
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    const match = searchMatch(value);
    try {
      return this.db
        .prepare(
          `
        SELECT si.document_id AS id, d.source, d.external_id AS externalId, si.title, si.author, si.body,
          d.url, d.updated_at AS updatedAt, rank
        FROM search_index si JOIN documents d ON d.id = si.document_id
        WHERE search_index MATCH ? ORDER BY rank LIMIT ?`,
        )
        .all(match, safeLimit);
    } catch (error) {
      throw dbError("搜索", error);
    }
  }

  exportJson() {
    try {
      const tables = Object.fromEntries(
        BACKUP_TABLES.map((table) => [
          table,
          this.db.prepare(`SELECT * FROM ${table}`).all(),
        ]),
      );
      return {
        format: "knowledge-management-json-backup",
        schemaVersion: this.schemaVersion,
        exportedAt: now(),
        tables,
      };
    } catch (error) {
      throw dbError("导出备份", error);
    }
  }

  exportJsonBackup(filePath) {
    try {
      const target = path.resolve(filePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const temporary = `${target}.${randomUUID()}.tmp`;
      const backup = this.exportJson();
      fs.writeFileSync(temporary, JSON.stringify(backup), "utf8");
      fs.renameSync(temporary, target);
      return { path: target, ...this.checkJsonBackup(backup) };
    } catch (error) {
      throw dbError("写入 JSON 备份", error);
    }
  }

  checkJsonBackup(backup) {
    const validation = validateBackup(backup);
    if (!validation.valid) return validation;
    return {
      valid: true,
      schemaVersion: Number(backup.schemaVersion),
      counts: Object.fromEntries(
        BACKUP_TABLES.map((table) => [
          table,
          (backup.tables[table] ?? []).length,
        ]),
      ),
    };
  }

  restoreJsonBackup(backup) {
    const validation = validateBackup(backup);
    if (!validation.valid)
      throw new DatabaseError(
        `无法恢复备份：${validation.reason}`,
        "BACKUP_INVALID",
      );
    try {
      this.db.transaction(() => {
        this.db.exec(
          "DELETE FROM search_index; DELETE FROM reader_session; DELETE FROM reading_states; DELETE FROM jobs; DELETE FROM tasks; DELETE FROM relations; DELETE FROM processing_results; DELETE FROM document_tags; DELETE FROM tags; DELETE FROM notes; DELETE FROM highlights; DELETE FROM collection_items; DELETE FROM collections; UPDATE documents SET current_version_id = NULL; DELETE FROM document_versions; DELETE FROM documents;",
        );
        const documentRows = backup.tables.documents.map((row) => ({
          ...row,
          current_version_id: null,
        }));
        this._insertRows("documents", documentRows);
        this._insertRows("document_versions", backup.tables.document_versions);
        const updateDocument = this.db.prepare(
          "UPDATE documents SET current_version_id = ? WHERE id = ?",
        );
        for (const row of backup.tables.documents)
          updateDocument.run(row.current_version_id || null, row.id);
        for (const table of [
          "collections",
          "collection_items",
          "highlights",
          "notes",
          "tags",
          "document_tags",
          "processing_results",
          "relations",
          "tasks",
          "jobs",
        ])
          this._insertRows(table, backup.tables[table] ?? []);
        const readingStates = (backup.tables.reading_states ?? []).map(
          (row) => ({
            ...row,
            tier:
              row.tier ||
              (row.status === "archived"
                ? "archived"
                : ["short", "medium", "long"].includes(row.knowledge_level)
                  ? row.knowledge_level
                  : "inbox"),
          }),
        );
        this._insertRows("reading_states", readingStates);
        this._insertRows("reader_session", backup.tables.reader_session ?? []);
        this._insertRows(
          "reader_preferences",
          backup.tables.reader_preferences ?? [],
        );
        for (const row of backup.tables.documents)
          this._refreshSearchIndex(row.id);
      })();
      return this.checkJsonBackup(this.exportJson());
    } catch (error) {
      throw dbError("恢复备份", error);
    }
  }

  restoreJsonBackupFile(filePath) {
    try {
      return this.restoreJsonBackup(
        JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8")),
      );
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      throw dbError("读取 JSON 备份", error);
    }
  }

  _insertRows(table, rows) {
    if (!rows.length) return;
    const columns = TABLE_COLUMNS[table];
    const statement = this.db.prepare(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    );
    const defaults = {
      media_json: "[]",
      exact: "",
      prefix: "",
      suffix: "",
      status:
        table === "highlights"
          ? "needs_repair"
          : table === "notes"
            ? "unanchored"
            : null,
      updated_at: "",
    };
    for (const row of rows)
      statement.run(
        ...columns.map((column) => row[column] ?? defaults[column] ?? null),
      );
  }
}

export function openKnowledgeDatabase(dbPath, { startupBackup = true } = {}) {
  const target = path.resolve(dbPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const existed = fs.existsSync(target) && fs.statSync(target).size > 0;
  let db;
  try {
    db = new Database(target);
    db.pragma("foreign_keys = ON");
    db.pragma("journal_mode = WAL");
    if (startupBackup && existed) {
      db.pragma("wal_checkpoint(TRUNCATE)");
      fs.copyFileSync(target, `${target}.startup.bak`);
    }
    migrateDatabase(db);
    return new KnowledgeDatabase(db, target);
  } catch (error) {
    if (db?.open) db.close();
    if (error instanceof DatabaseError) throw error;
    throw dbError("打开数据库", error);
  }
}
