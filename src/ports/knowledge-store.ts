import type { KnowledgeDatabase } from "../database.mjs";

export type ReaderStore = Pick<
  KnowledgeDatabase,
  | "listDocuments"
  | "listTags"
  | "listSources"
  | "listAnnotations"
  | "getReaderSession"
  | "getDocument"
  | "getDocumentSourceMemberships"
  | "listDocumentVersions"
  | "addHighlight"
  | "updateHighlight"
  | "deleteHighlight"
  | "addNote"
  | "updateNote"
  | "deleteNote"
  | "addTag"
  | "updateTagMemberships"
  | "removeTag"
  | "renameTag"
  | "saveReadingState"
  | "saveReaderSession"
  | "trashDocument"
  | "restoreDocument"
  | "deleteDocumentPermanently"
  | "emptyTrash"
  | "getReaderPreferences"
  | "saveReaderPreferences"
>;

export type SyncStore = Pick<
  KnowledgeDatabase,
  | "createSyncJob"
  | "getSyncJob"
  | "getLatestSyncJob"
  | "updateSyncJob"
  | "recordSyncRequest"
  | "upsertCollection"
  | "getCollectionItemSyncHash"
  | "upsertDocument"
  | "linkCollectionDocument"
  | "recordImportError"
  | "hasCompleteDocument"
  | "getDocumentSourceMemberships"
  | "unlinkCollectionDocument"
>;

export type ImportStore = Pick<
  KnowledgeDatabase,
  "upsertDocument" | "recordImportError"
>;
