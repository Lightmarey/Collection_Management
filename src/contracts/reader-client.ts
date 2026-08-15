import type {
  AnnotationInput, ReaderAnnotationListItem, ReaderBootstrapResult, ReaderDocument, ReaderHighlight, ReaderPreferences,
  ReaderListOptions, ReaderNote, ReaderTag,
} from './domain';

// Implement this contract with Electron IPC today and HTTPS for web/mobile later.
export type ReaderClient = {
  readerBootstrap(options?: ReaderListOptions): Promise<ReaderBootstrapResult>;
  getReaderDocument(documentId: string, versionId?: string | null): Promise<{ ok: boolean; error?: string; document?: ReaderDocument }>;
  saveReadingState(input: { documentId: string; tier?: string; favorite?: boolean; scrollTop?: number }): Promise<{ ok: boolean; error?: string; state?: { documentId: string; tier: string; favorite: boolean; scrollTop: number } }>;
  updateDocumentProperties(input: { documentId: string; tier?: string; favorite?: boolean; tags?: string[] }): Promise<{ ok: boolean; error?: string; state?: { documentId: string; tier: string; favorite: boolean; scrollTop: number } }>;
  saveReaderSession(selectedDocumentId: string | null): Promise<{ ok: boolean; error?: string; session?: { selectedDocumentId: string | null; updatedAt: string } }>;
  listReaderAnnotations(input?: { query?: string; kind?: "all" | "highlight" | "note" }): Promise<{ ok: boolean; error?: string; annotations?: ReaderAnnotationListItem[] }>;
  createHighlight(input: AnnotationInput): Promise<{ ok: boolean; error?: string; highlight?: ReaderHighlight }>;
  updateHighlight(id: string, input: { color?: string }): Promise<{ ok: boolean; error?: string; highlight?: ReaderHighlight }>;
  deleteHighlight(id: string): Promise<{ ok: boolean; error?: string }>;
  createNote(input: AnnotationInput & { body: string }): Promise<{ ok: boolean; error?: string; note?: ReaderNote }>;
  updateNote(id: string, body: string): Promise<{ ok: boolean; error?: string; note?: ReaderNote }>;
  deleteNote(id: string): Promise<{ ok: boolean; error?: string }>;
  addDocumentTag(documentId: string, name: string): Promise<{ ok: boolean; error?: string; tag?: ReaderTag }>;
  updateDocumentTagMemberships(input: { documentIds: string[]; tagId?: string; name?: string; present: boolean }): Promise<{ ok: boolean; error?: string; tag?: ReaderTag; changedDocumentIds?: string[] }>;
  removeDocumentTag(documentId: string, tagId: string): Promise<{ ok: boolean; error?: string }>;
  renameDocumentTag(tagId: string, name: string): Promise<{ ok: boolean; error?: string; tag?: ReaderTag }>;
  trashDocument(documentId: string): Promise<{ ok: boolean; error?: string }>;
  restoreDocument(documentId: string): Promise<{ ok: boolean; error?: string }>;
  deleteDocumentPermanently(documentId: string): Promise<{ ok: boolean; error?: string }>;
  emptyTrash(): Promise<{ ok: boolean; error?: string; deleted?: number }>;
  getReaderPreferences(): Promise<{ ok: boolean; error?: string; preferences?: ReaderPreferences }>;
  saveReaderPreferences(input: Partial<ReaderPreferences>): Promise<{ ok: boolean; error?: string; preferences?: ReaderPreferences }>;
  importReaderFont(input: { name: string; mimeType: string; bytes: Uint8Array }): Promise<{ ok: boolean; error?: string; preferences?: ReaderPreferences }>;
};
