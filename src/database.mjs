import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const CURRENT_SCHEMA_VERSION = 3;

const BACKUP_TABLES = [
  'documents',
  'document_versions',
  'collections',
  'collection_items',
  'highlights',
  'notes',
  'tags',
  'document_tags',
  'processing_results',
  'relations',
  'tasks',
  'jobs',
  'reading_states',
  'reader_session',
];

const TABLE_COLUMNS = {
  documents: ['id', 'source', 'external_id', 'current_version_id', 'title', 'author', 'url', 'published_at', 'fetched_at', 'media_json', 'import_error', 'created_at', 'updated_at'],
  document_versions: ['id', 'document_id', 'version_number', 'title', 'author', 'body', 'content_hash', 'published_at', 'fetched_at', 'media_json', 'import_error', 'created_at'],
  collections: ['id', 'source', 'external_id', 'name', 'description', 'created_at', 'updated_at'],
  collection_items: ['collection_id', 'document_id', 'position', 'created_at'],
  highlights: ['id', 'document_id', 'document_version_id', 'quote', 'start_offset', 'end_offset', 'color', 'created_at'],
  notes: ['id', 'document_id', 'document_version_id', 'body', 'created_at', 'updated_at'],
  tags: ['id', 'name', 'created_at'],
  document_tags: ['document_id', 'tag_id', 'created_at'],
  processing_results: ['id', 'document_id', 'document_version_id', 'kind', 'status', 'payload_json', 'created_at'],
  relations: ['id', 'from_document_id', 'to_document_id', 'relation_type', 'created_at'],
  tasks: ['id', 'task_type', 'status', 'payload_json', 'created_at', 'updated_at'],
  jobs: ['id', 'task_id', 'status', 'attempts', 'last_error', 'created_at', 'updated_at'],
  reading_states: ['document_id', 'status', 'favorite', 'knowledge_level', 'scroll_top', 'updated_at'],
  reader_session: ['id', 'selected_document_id', 'updated_at'],
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
];

const READING_STATUSES = new Set(['unread', 'reading', 'processed', 'archived']);
const KNOWLEDGE_LEVELS = new Set(['short', 'medium', 'long']);

export class DatabaseError extends Error {
  constructor(message, code = 'DATABASE_ERROR', options = {}) {
    super(message, options);
    this.name = 'DatabaseError';
    this.code = code;
  }
}

function now() {
  return new Date().toISOString();
}

function text(value) {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function contentHash(body) {
  return createHash('sha256').update(body).digest('hex');
}

function nullableText(value) {
  if (value == null || value === '') return null;
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
  return value.split(/\s+/).map((part) => `"${part.replaceAll('"', '""')}"*`).join(' ');
}

function mediaJson(value) {
  return JSON.stringify(Array.isArray(value) ? value : []);
}

function dbError(operation, error) {
  if (error instanceof DatabaseError) return error;
  return new DatabaseError(`数据库${operation}失败，请重试或检查本地磁盘空间`, 'DATABASE_ERROR', { cause: error });
}

function schemaMigrationsExist(db) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get());
}

export function migrateDatabase(db, migrations = MIGRATIONS) {
  try {
    if (!schemaMigrationsExist(db)) {
      const first = migrations[0];
      if (!first || first.version !== 1) throw new DatabaseError('数据库迁移版本无效', 'MIGRATION_INVALID');
      db.transaction(() => {
        db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
        first.up(db);
        db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(first.version, now());
        db.pragma(`user_version = ${first.version}`);
      })();
    }

    let current = Number(db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get().version);
    for (const migration of migrations.filter(({ version }) => version > current).sort((a, b) => a.version - b.version)) {
      if (migration.version !== current + 1) throw new DatabaseError(`数据库迁移缺少版本 ${current + 1}`, 'MIGRATION_INVALID');
      db.transaction(() => {
        migration.up(db);
        db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(migration.version, now());
        db.pragma(`user_version = ${migration.version}`);
      })();
      current = migration.version;
    }
    return current;
  } catch (error) {
    throw dbError('迁移', error);
  }
}

function validateBackup(backup) {
  if (!backup || typeof backup !== 'object' || Array.isArray(backup)) return { valid: false, reason: '备份格式不是对象' };
  const schemaVersion = Number(backup.schemaVersion);
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) return { valid: false, reason: '备份版本无效' };
  if (schemaVersion > CURRENT_SCHEMA_VERSION) return { valid: false, reason: '备份版本高于当前数据库' };
  if (!backup.tables || typeof backup.tables !== 'object') return { valid: false, reason: '备份缺少 tables' };
  for (const table of BACKUP_TABLES) {
    if (!Array.isArray(backup.tables[table]) && !(schemaVersion < 3 && ['reading_states', 'reader_session'].includes(table))) {
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
    return Number(this.db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get().version);
  }

  close() {
    if (this.db.open) this.db.close();
  }

  _upsertDocument(input) {
    const source = text(input?.source).trim();
    const externalId = text(input?.externalId).trim();
    if (!source || !externalId) throw new DatabaseError('文档必须包含 source 和 external_id', 'VALIDATION_ERROR');
    const title = text(input?.title);
    const author = text(input?.author);
    const body = text(input?.body);
    const url = input?.url == null ? null : text(input.url);
    const timestamp = now();
    const publishedAt = nullableText(input?.publishedAt);
    const fetchedAt = nullableText(input?.fetchedAt) ?? timestamp;
    const media = mediaJson(input?.mediaRefs);
    const importError = nullableText(input?.importError);
    const existing = this.db.prepare('SELECT * FROM documents WHERE source = ? AND external_id = ?').get(source, externalId);
    if (!existing) {
      const documentId = input?.id || randomUUID();
      const versionId = randomUUID();
      this.db.prepare(`INSERT INTO documents (id, source, external_id, current_version_id, title, author, url, published_at, fetched_at, media_json, import_error, created_at, updated_at)
        VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(documentId, source, externalId, title, author, url, publishedAt, fetchedAt, media, importError, timestamp, timestamp);
      this.db.prepare(`INSERT INTO document_versions (id, document_id, version_number, title, author, body, content_hash, published_at, fetched_at, media_json, import_error, created_at)
        VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(versionId, documentId, title, author, body, contentHash(body), publishedAt, fetchedAt, media, importError, timestamp);
      this.db.prepare('UPDATE documents SET current_version_id = ? WHERE id = ?').run(versionId, documentId);
      this._refreshSearchIndex(documentId);
      return { documentId, versionId, created: true, versionCreated: true };
    }

    const current = this.db.prepare('SELECT * FROM document_versions WHERE id = ?').get(existing.current_version_id);
    const changed = !current || current.content_hash !== contentHash(body);
    if (changed) {
      const versionId = randomUUID();
      const versionNumber = Number(this.db.prepare('SELECT COALESCE(MAX(version_number), 0) + 1 AS next FROM document_versions WHERE document_id = ?').get(existing.id).next);
      this.db.prepare(`INSERT INTO document_versions (id, document_id, version_number, title, author, body, content_hash, published_at, fetched_at, media_json, import_error, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(versionId, existing.id, versionNumber, title, author, body, contentHash(body), publishedAt, fetchedAt, media, importError, timestamp);
      this.db.prepare(`UPDATE documents SET current_version_id = ?, title = ?, author = ?, url = ?, published_at = ?, fetched_at = ?, media_json = ?, import_error = ?, updated_at = ? WHERE id = ?`)
        .run(versionId, title, author, url, publishedAt, fetchedAt, media, importError, timestamp, existing.id);
      this._refreshSearchIndex(existing.id);
      return { documentId: existing.id, versionId, created: false, versionCreated: true };
    }

    this.db.prepare('UPDATE documents SET title = ?, author = ?, url = ?, published_at = ?, fetched_at = ?, media_json = ?, import_error = ?, updated_at = ? WHERE id = ?')
      .run(title, author, url, publishedAt, fetchedAt, media, importError, timestamp, existing.id);
    this._refreshSearchIndex(existing.id);
    return { documentId: existing.id, versionId: existing.current_version_id, created: false, versionCreated: false };
  }

  upsertDocument(input) {
    try {
      return this.db.transaction(() => this._upsertDocument(input))();
    } catch (error) {
      throw dbError('写入文档', error);
    }
  }

  importDocuments(inputs) {
    if (!Array.isArray(inputs)) throw new DatabaseError('导入数据必须是数组', 'VALIDATION_ERROR');
    try {
      return this.db.transaction(() => inputs.map((input) => this._upsertDocument(input)))();
    } catch (error) {
      throw dbError('批量导入', error);
    }
  }

  recordImportError(input) {
    const source = text(input?.source).trim();
    const externalId = text(input?.externalId).trim();
    const importError = text(input?.importError).trim();
    if (!source || !externalId || !importError) throw new DatabaseError('导入错误必须包含 source、external_id 和状态', 'VALIDATION_ERROR');
    try {
      return this.db.transaction(() => {
        const existing = this.db.prepare('SELECT * FROM documents WHERE source = ? AND external_id = ?').get(source, externalId);
        const timestamp = now();
        if (!existing) {
          return this._upsertDocument({ ...input, body: '', fetchedAt: input?.fetchedAt ?? timestamp, importError });
        }
        this.db.prepare(`UPDATE documents SET title = COALESCE(?, title), author = COALESCE(?, author), url = COALESCE(?, url),
          published_at = COALESCE(?, published_at), fetched_at = ?, import_error = ?, updated_at = ? WHERE id = ?`)
          .run(nullableText(input?.title), nullableText(input?.author), nullableText(input?.url), nullableText(input?.publishedAt), input?.fetchedAt ?? timestamp, importError, timestamp, existing.id);
        return { documentId: existing.id, versionId: existing.current_version_id, created: false, versionCreated: false, importError };
      })();
    } catch (error) {
      throw dbError('记录导入错误', error);
    }
  }

  addHighlight(input) {
    try {
      const value = {
        id: input?.id || randomUUID(),
        documentId: text(input?.documentId),
        documentVersionId: input?.documentVersionId || null,
        quote: text(input?.quote),
        startOffset: input?.startOffset ?? null,
        endOffset: input?.endOffset ?? null,
        color: text(input?.color) || 'yellow',
        createdAt: now(),
      };
      return this.db.transaction(() => {
        this.db.prepare(`INSERT INTO highlights (id, document_id, document_version_id, quote, start_offset, end_offset, color, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(value.id, value.documentId, value.documentVersionId, value.quote, value.startOffset, value.endOffset, value.color, value.createdAt);
        this._refreshSearchIndex(value.documentId);
        return value;
      })();
    } catch (error) {
      throw dbError('写入标注', error);
    }
  }

  addNote(input) {
    try {
      const value = {
        id: input?.id || randomUUID(),
        documentId: text(input?.documentId),
        documentVersionId: input?.documentVersionId || null,
        body: text(input?.body),
        createdAt: now(),
        updatedAt: now(),
      };
      return this.db.transaction(() => {
        this.db.prepare(`INSERT INTO notes (id, document_id, document_version_id, body, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)`).run(value.id, value.documentId, value.documentVersionId, value.body, value.createdAt, value.updatedAt);
        this._refreshSearchIndex(value.documentId);
        return value;
      })();
    } catch (error) {
      throw dbError('写入批注', error);
    }
  }

  addTag(documentId, name) {
    try {
      return this.db.transaction(() => {
        const timestamp = now();
        const tagName = text(name).trim();
        if (!tagName) throw new DatabaseError('标签不能为空', 'VALIDATION_ERROR');
        let tag = this.db.prepare('SELECT * FROM tags WHERE name = ?').get(tagName);
        if (!tag) {
          const id = randomUUID();
          this.db.prepare('INSERT INTO tags (id, name, created_at) VALUES (?, ?, ?)').run(id, tagName, timestamp);
          tag = { id, name: tagName, created_at: timestamp };
        }
        this.db.prepare('INSERT OR IGNORE INTO document_tags (document_id, tag_id, created_at) VALUES (?, ?, ?)').run(documentId, tag.id, timestamp);
        this._refreshSearchIndex(documentId);
        return tag;
      })();
    } catch (error) {
      throw dbError('写入标签', error);
    }
  }

  listTags() {
    try {
      return this.db.prepare(`
        SELECT t.id, t.name, COUNT(dt.document_id) AS documentCount
        FROM tags t LEFT JOIN document_tags dt ON dt.tag_id = t.id
        GROUP BY t.id ORDER BY t.name COLLATE NOCASE ASC
      `).all();
    } catch (error) {
      throw dbError('读取标签', error);
    }
  }

  listDocuments({ filter = 'inbox', query = '', sort = 'updated', limit = 100, offset = 0 } = {}) {
    const value = text(query).trim();
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 100));
    const safeOffset = Math.max(0, Number(offset) || 0);
    const conditions = [];
    const params = [];
    let from = 'FROM documents d JOIN document_versions v ON v.id = d.current_version_id LEFT JOIN reading_states rs ON rs.document_id = d.id';

    if (value) {
      from += ' JOIN search_index ON search_index.document_id = d.id';
      conditions.push('search_index MATCH ?');
      params.push(searchMatch(value));
    }

    const filterValue = text(filter).trim() || 'inbox';
    if (filterValue === 'inbox') conditions.push("COALESCE(rs.status, 'unread') <> 'archived'");
    else if (filterValue === 'unread') conditions.push("COALESCE(rs.status, 'unread') = 'unread'");
    else if (filterValue === 'reading') conditions.push("COALESCE(rs.status, 'unread') = 'reading'");
    else if (filterValue === 'processed') conditions.push("COALESCE(rs.status, 'unread') = 'processed'");
    else if (filterValue === 'archived') conditions.push("COALESCE(rs.status, 'unread') = 'archived'");
    else if (filterValue === 'favorites') conditions.push('COALESCE(rs.favorite, 0) = 1');
    else if (filterValue.startsWith('tag:')) {
      conditions.push('EXISTS (SELECT 1 FROM document_tags selected_dt WHERE selected_dt.document_id = d.id AND selected_dt.tag_id = ?)');
      params.push(filterValue.slice(4));
    } else if (filterValue.startsWith('level:') && KNOWLEDGE_LEVELS.has(filterValue.slice(6))) {
      conditions.push('COALESCE(rs.knowledge_level, \'\') = ?');
      params.push(filterValue.slice(6));
    }

    const orderBy = {
      title: 'd.title COLLATE NOCASE ASC, d.updated_at DESC',
      duration: 'length(COALESCE(v.body, \'\')) ASC, d.updated_at DESC',
      status: "CASE COALESCE(rs.status, 'unread') WHEN 'unread' THEN 0 WHEN 'reading' THEN 1 WHEN 'processed' THEN 2 ELSE 3 END, d.updated_at DESC",
      updated: 'd.updated_at DESC, d.id ASC',
    }[sort] || 'd.updated_at DESC, d.id ASC';
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    try {
      const rows = this.db.prepare(`
        SELECT d.id, d.source, d.external_id AS externalId, d.title, d.author, d.url,
          d.fetched_at AS fetchedAt, d.import_error AS importError,
          COALESCE(rs.status, 'unread') AS status, COALESCE(rs.favorite, 0) AS favorite,
          COALESCE(rs.knowledge_level, '') AS knowledgeLevel,
          CASE WHEN length(COALESCE(v.body, '')) = 0 THEN 0 ELSE 1 END AS hasBody,
          CAST(CASE WHEN length(COALESCE(v.body, '')) = 0 THEN 1 ELSE (length(v.body) + 1199) / 1200 END AS INTEGER) AS estimatedMinutes
        ${from} ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?
      `).all(...params, safeLimit, safeOffset);
      return rows.map((row) => ({ ...row, favorite: Boolean(row.favorite), hasBody: Boolean(row.hasBody) }));
    } catch (error) {
      throw dbError('读取文档列表', error);
    }
  }

  getDocument(documentId) {
    const id = text(documentId).trim();
    if (!id) return null;
    try {
      const row = this.db.prepare(`
        SELECT d.id, d.source, d.external_id AS externalId, d.title, d.author, d.url,
          d.published_at AS publishedAt, d.fetched_at AS fetchedAt, d.import_error AS importError,
          v.id AS versionId, v.version_number AS versionNumber, v.body,
          COALESCE(rs.status, 'unread') AS status, COALESCE(rs.favorite, 0) AS favorite,
          COALESCE(rs.knowledge_level, '') AS knowledgeLevel, COALESCE(rs.scroll_top, 0) AS scrollTop,
          CASE WHEN length(COALESCE(v.body, '')) = 0 THEN 0 ELSE 1 END AS hasBody,
          CAST(CASE WHEN length(COALESCE(v.body, '')) = 0 THEN 1 ELSE (length(v.body) + 1199) / 1200 END AS INTEGER) AS estimatedMinutes
        FROM documents d JOIN document_versions v ON v.id = d.current_version_id
        LEFT JOIN reading_states rs ON rs.document_id = d.id WHERE d.id = ?
      `).get(id);
      if (!row) return null;
      const body = typeof row.body === 'string' ? row.body : '';
      const highlights = this.db.prepare(`
        SELECT id, quote, start_offset AS startOffset, end_offset AS endOffset, color, created_at AS createdAt
        FROM highlights WHERE document_id = ? ORDER BY created_at ASC
      `).all(id);
      const notes = this.db.prepare(`
        SELECT id, body, created_at AS createdAt, updated_at AS updatedAt
        FROM notes WHERE document_id = ? ORDER BY created_at ASC
      `).all(id);
      const processingResults = this.db.prepare(`
        SELECT id, kind, status, payload_json AS payloadJson, created_at AS createdAt
        FROM processing_results WHERE document_id = ? ORDER BY created_at DESC
      `).all(id).map((result) => ({ ...result, payload: safeJson(result.payloadJson, result.payloadJson) }));
      const tags = this.db.prepare(`
        SELECT t.id, t.name FROM tags t JOIN document_tags dt ON dt.tag_id = t.id
        WHERE dt.document_id = ? ORDER BY t.name COLLATE NOCASE ASC
      `).all(id);
      return {
        ...row,
        body,
        bodyState: body.includes('\u0000') ? 'corrupt' : body.trim() ? 'ok' : 'empty',
        hasBody: Boolean(row.hasBody),
        favorite: Boolean(row.favorite),
        highlights,
        notes,
        tags,
        processingResults,
      };
    } catch (error) {
      throw dbError('读取文档正文', error);
    }
  }

  getReaderSession() {
    try {
      return this.db.prepare('SELECT selected_document_id AS selectedDocumentId, updated_at AS updatedAt FROM reader_session WHERE id = 1').get() ?? { selectedDocumentId: null, updatedAt: null };
    } catch (error) {
      throw dbError('读取阅读进度', error);
    }
  }

  saveReaderSession(selectedDocumentId = null) {
    const id = selectedDocumentId == null ? null : text(selectedDocumentId).trim();
    try {
      if (id && !this.db.prepare('SELECT 1 FROM documents WHERE id = ?').get(id)) throw new DatabaseError('文档不存在', 'DOCUMENT_NOT_FOUND');
      const updatedAt = now();
      this.db.prepare(`
        INSERT INTO reader_session (id, selected_document_id, updated_at) VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET selected_document_id = excluded.selected_document_id, updated_at = excluded.updated_at
      `).run(id, updatedAt);
      return { selectedDocumentId: id, updatedAt };
    } catch (error) {
      throw dbError('保存当前文档', error);
    }
  }

  saveReadingState(input = {}) {
    const documentId = text(input.documentId).trim();
    if (!documentId) throw new DatabaseError('阅读状态缺少文档', 'VALIDATION_ERROR');
    try {
      return this.db.transaction(() => {
        if (!this.db.prepare('SELECT 1 FROM documents WHERE id = ?').get(documentId)) throw new DatabaseError('文档不存在', 'DOCUMENT_NOT_FOUND');
        const existing = this.db.prepare('SELECT * FROM reading_states WHERE document_id = ?').get(documentId);
        const status = input.status == null ? existing?.status ?? 'unread' : text(input.status).trim();
        const knowledgeLevel = input.knowledgeLevel == null ? existing?.knowledge_level ?? '' : text(input.knowledgeLevel).trim();
        const favorite = input.favorite == null ? Number(existing?.favorite ?? 0) : input.favorite ? 1 : 0;
        const scrollTop = input.scrollTop == null ? Number(existing?.scroll_top ?? 0) : Number(input.scrollTop);
        if (!READING_STATUSES.has(status)) throw new DatabaseError('阅读状态无效', 'VALIDATION_ERROR');
        if (knowledgeLevel && !KNOWLEDGE_LEVELS.has(knowledgeLevel)) throw new DatabaseError('知识层级无效', 'VALIDATION_ERROR');
        if (!Number.isFinite(scrollTop) || scrollTop < 0) throw new DatabaseError('阅读位置无效', 'VALIDATION_ERROR');
        const updatedAt = now();
        this.db.prepare(`
          INSERT INTO reading_states (document_id, status, favorite, knowledge_level, scroll_top, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(document_id) DO UPDATE SET status = excluded.status, favorite = excluded.favorite,
            knowledge_level = excluded.knowledge_level, scroll_top = excluded.scroll_top, updated_at = excluded.updated_at
        `).run(documentId, status, favorite, knowledgeLevel, scrollTop, updatedAt);
        return { documentId, status, favorite: Boolean(favorite), knowledgeLevel, scrollTop, updatedAt };
      })();
    } catch (error) {
      throw dbError('保存阅读状态', error);
    }
  }

  _refreshSearchIndex(documentId) {
    const row = this.db.prepare(`
      SELECT d.id, d.title, d.author, v.body,
        COALESCE((SELECT GROUP_CONCAT(t.name, ' ') FROM document_tags dt JOIN tags t ON t.id = dt.tag_id WHERE dt.document_id = d.id), '') AS tags,
        COALESCE((SELECT GROUP_CONCAT(annotation, ' ') FROM (
          SELECT quote AS annotation FROM highlights WHERE document_id = d.id
          UNION ALL SELECT body AS annotation FROM notes WHERE document_id = d.id
        )), '') AS annotations
      FROM documents d JOIN document_versions v ON v.id = d.current_version_id
      WHERE d.id = ?`).get(documentId);
    this.db.prepare('DELETE FROM search_index WHERE document_id = ?').run(documentId);
    if (row) this.db.prepare('INSERT INTO search_index (document_id, title, author, body, tags, annotations) VALUES (?, ?, ?, ?, ?, ?)')
      .run(row.id, row.title, row.author, row.body, row.tags, row.annotations);
  }

  search(query, limit = 50) {
    const value = text(query).trim();
    if (!value) return [];
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    const match = searchMatch(value);
    try {
      return this.db.prepare(`
        SELECT si.document_id AS id, d.source, d.external_id AS externalId, si.title, si.author, si.body,
          d.url, d.updated_at AS updatedAt, rank
        FROM search_index si JOIN documents d ON d.id = si.document_id
        WHERE search_index MATCH ? ORDER BY rank LIMIT ?`).all(match, safeLimit);
    } catch (error) {
      throw dbError('搜索', error);
    }
  }

  exportJson() {
    try {
      const tables = Object.fromEntries(BACKUP_TABLES.map((table) => [table, this.db.prepare(`SELECT * FROM ${table}`).all()]));
      return { format: 'knowledge-management-json-backup', schemaVersion: this.schemaVersion, exportedAt: now(), tables };
    } catch (error) {
      throw dbError('导出备份', error);
    }
  }

  exportJsonBackup(filePath) {
    try {
      const target = path.resolve(filePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const temporary = `${target}.${randomUUID()}.tmp`;
      const backup = this.exportJson();
      fs.writeFileSync(temporary, JSON.stringify(backup), 'utf8');
      fs.renameSync(temporary, target);
      return { path: target, ...this.checkJsonBackup(backup) };
    } catch (error) {
      throw dbError('写入 JSON 备份', error);
    }
  }

  checkJsonBackup(backup) {
    const validation = validateBackup(backup);
    if (!validation.valid) return validation;
    return { valid: true, schemaVersion: Number(backup.schemaVersion), counts: Object.fromEntries(BACKUP_TABLES.map((table) => [table, (backup.tables[table] ?? []).length])) };
  }

  restoreJsonBackup(backup) {
    const validation = validateBackup(backup);
    if (!validation.valid) throw new DatabaseError(`无法恢复备份：${validation.reason}`, 'BACKUP_INVALID');
    try {
      this.db.transaction(() => {
        this.db.exec('DELETE FROM search_index; DELETE FROM reader_session; DELETE FROM reading_states; DELETE FROM jobs; DELETE FROM tasks; DELETE FROM relations; DELETE FROM processing_results; DELETE FROM document_tags; DELETE FROM tags; DELETE FROM notes; DELETE FROM highlights; DELETE FROM collection_items; DELETE FROM collections; DELETE FROM document_versions; DELETE FROM documents;');
        const documentRows = backup.tables.documents.map((row) => ({ ...row, current_version_id: null }));
        this._insertRows('documents', documentRows);
        this._insertRows('document_versions', backup.tables.document_versions);
        const updateDocument = this.db.prepare('UPDATE documents SET current_version_id = ? WHERE id = ?');
        for (const row of backup.tables.documents) updateDocument.run(row.current_version_id || null, row.id);
        for (const table of ['collections', 'collection_items', 'highlights', 'notes', 'tags', 'document_tags', 'processing_results', 'relations', 'tasks', 'jobs', 'reading_states', 'reader_session']) this._insertRows(table, backup.tables[table] ?? []);
        for (const row of backup.tables.documents) this._refreshSearchIndex(row.id);
      })();
      return this.checkJsonBackup(this.exportJson());
    } catch (error) {
      throw dbError('恢复备份', error);
    }
  }

  restoreJsonBackupFile(filePath) {
    try {
      return this.restoreJsonBackup(JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8')));
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      throw dbError('读取 JSON 备份', error);
    }
  }

  _insertRows(table, rows) {
    if (!rows.length) return;
    const columns = TABLE_COLUMNS[table];
    const statement = this.db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`);
    for (const row of rows) statement.run(...columns.map((column) => row[column] ?? (column === 'media_json' ? '[]' : null)));
  }
}

export function openKnowledgeDatabase(dbPath, { startupBackup = true } = {}) {
  const target = path.resolve(dbPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const existed = fs.existsSync(target) && fs.statSync(target).size > 0;
  let db;
  try {
    db = new Database(target);
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    if (startupBackup && existed) {
      db.pragma('wal_checkpoint(TRUNCATE)');
      fs.copyFileSync(target, `${target}.startup.bak`);
    }
    migrateDatabase(db);
    return new KnowledgeDatabase(db, target);
  } catch (error) {
    if (db?.open) db.close();
    if (error instanceof DatabaseError) throw error;
    throw dbError('打开数据库', error);
  }
}
