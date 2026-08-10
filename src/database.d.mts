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
};

export type DocumentWriteResult = {
  documentId: string;
  versionId: string;
  created: boolean;
  versionCreated: boolean;
};

export class KnowledgeDatabase {
  readonly dbPath: string;
  readonly schemaVersion: number;
  close(): void;
  upsertDocument(input: DocumentInput): DocumentWriteResult;
  importDocuments(inputs: DocumentInput[]): DocumentWriteResult[];
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

