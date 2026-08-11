export const CURRENT_SCHEMA_VERSION: number;

export class DatabaseError extends Error {
  code: string;
  constructor(message: string, code?: string, options?: ErrorOptions);
}

export type DocumentInput = {
  id?: string;
  source: string;
  externalId: string;
  title?: string;
  author?: string;
  body: string;
  url?: string | null;
  publishedAt?: string | null;
  fetchedAt?: string | null;
  mediaRefs?: Array<Record<string, unknown>>;
  importError?: string | null;
};

export type DocumentWriteResult = {
  documentId: string;
  versionId: string;
  created: boolean;
  versionCreated: boolean;
};

export type DocumentListOptions = {
  filter?: string;
  query?: string;
  sort?: 'updated' | 'title' | 'duration' | 'status';
  limit?: number;
  offset?: number;
};

export type SyncJob = {
  id: string;
  taskId: string;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  payload: Record<string, unknown>;
};

export class KnowledgeDatabase {
  readonly dbPath: string;
  readonly schemaVersion: number;
  close(): void;
  upsertCollection(input: { id?: string; source: string; externalId: string; name?: string; description?: string }): { collectionId: string; created: boolean };
  linkCollectionDocument(collectionId: string, documentId: string, position?: number): { collectionId: string; documentId: string; position: number };
  createSyncJob(input: { type?: string; source: string; externalId: string; url?: string | null }): SyncJob;
  getSyncJob(jobId: string): SyncJob;
  updateSyncJob(jobId: string, input?: { status?: string; payload?: Record<string, unknown>; payloadPatch?: Record<string, unknown>; lastError?: string | null; incrementAttempts?: boolean }): SyncJob;
  recordSyncRequest(jobId: string, input?: { kind?: string; at?: string; delayMs?: number | null }): SyncJob;
  upsertDocument(input: DocumentInput): DocumentWriteResult;
  importDocuments(inputs: DocumentInput[]): DocumentWriteResult[];
  recordImportError(input: DocumentInput & { importError: string }): DocumentWriteResult & { importError: string };
  addHighlight(input: { documentId: string; documentVersionId?: string | null; quote?: string; exact?: string; prefix?: string; suffix?: string; start?: number | null; end?: number | null; startOffset?: number | null; endOffset?: number | null; color?: string }): Record<string, unknown>;
  updateHighlight(id: string, input: { documentVersionId?: string | null; quote?: string; exact?: string; prefix?: string; suffix?: string; start?: number | null; end?: number | null; color?: string }): Record<string, unknown>;
  deleteHighlight(id: string): Record<string, unknown>;
  addNote(input: { documentId: string; documentVersionId?: string | null; body: string; quote?: string; exact?: string; prefix?: string; suffix?: string; start?: number | null; end?: number | null; startOffset?: number | null; endOffset?: number | null }): Record<string, unknown>;
  updateNote(id: string, input: { body?: string; documentVersionId?: string | null; quote?: string; exact?: string; prefix?: string; suffix?: string; start?: number | null; end?: number | null }): Record<string, unknown>;
  deleteNote(id: string): Record<string, unknown>;
  addTag(documentId: string, name: string): Record<string, unknown>;
  removeTag(documentId: string, tagId: string): Record<string, unknown>;
  renameTag(tagId: string, name: string): Record<string, unknown>;
  listTags(): Array<Record<string, unknown>>;
  listDocuments(options?: DocumentListOptions): Array<Record<string, unknown>>;
  listDocumentVersions(documentId: string): Array<Record<string, unknown>>;
  getDocument(documentId: string, versionId?: string | null): Record<string, unknown> | null;
  getReaderSession(): Record<string, unknown>;
  saveReaderSession(selectedDocumentId?: string | null): Record<string, unknown>;
  saveReadingState(input: { documentId: string; status?: string; favorite?: boolean; knowledgeLevel?: string; scrollTop?: number }): Record<string, unknown>;
  search(query: string, limit?: number): Array<Record<string, unknown>>;
  exportJson(): Record<string, unknown>;
  exportJsonBackup(filePath: string): Record<string, unknown>;
  checkJsonBackup(backup: Record<string, unknown>): Record<string, unknown>;
  restoreJsonBackup(backup: Record<string, unknown>): Record<string, unknown>;
  restoreJsonBackupFile(filePath: string): Record<string, unknown>;
}

export function migrateDatabase(db: unknown): number;
export function openKnowledgeDatabase(dbPath: string, options?: { startupBackup?: boolean }): KnowledgeDatabase;

