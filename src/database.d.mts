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
  addHighlight(input: { documentId: string; documentVersionId?: string | null; quote: string; startOffset?: number | null; endOffset?: number | null; color?: string }): Record<string, unknown>;
  addNote(input: { documentId: string; documentVersionId?: string | null; body: string }): Record<string, unknown>;
  addTag(documentId: string, name: string): Record<string, unknown>;
  search(query: string, limit?: number): Array<Record<string, unknown>>;
  exportJson(): Record<string, unknown>;
  exportJsonBackup(filePath: string): Record<string, unknown>;
  checkJsonBackup(backup: Record<string, unknown>): Record<string, unknown>;
  restoreJsonBackup(backup: Record<string, unknown>): Record<string, unknown>;
  restoreJsonBackupFile(filePath: string): Record<string, unknown>;
}

export function migrateDatabase(db: unknown): number;
export function openKnowledgeDatabase(dbPath: string, options?: { startupBackup?: boolean }): KnowledgeDatabase;

