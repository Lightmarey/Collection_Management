/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

type ReaderListOptions = {
  filter?: string;
  query?: string;
  sort?: 'updated' | 'title' | 'duration' | 'status';
  limit?: number;
  offset?: number;
};

type ReaderListItem = {
  id: string;
  source: string;
  externalId: string;
  title: string;
  author: string;
  url: string | null;
  fetchedAt: string | null;
  importError: string | null;
  status: 'unread' | 'reading' | 'processed' | 'archived';
  favorite: boolean;
  knowledgeLevel: string;
  hasBody: boolean;
  estimatedMinutes: number;
};

type ReaderDocument = ReaderListItem & {
  publishedAt: string | null;
  versionId: string;
  versionNumber: number;
  body: string;
  bodyState: 'ok' | 'empty' | 'corrupt';
  scrollTop: number;
  isCurrentVersion: boolean;
  versions: Array<{ versionId: string; documentId: string; versionNumber: number; title: string; createdAt: string; contentHash: string; isCurrent: boolean }>;
  highlights: Array<{ id: string; documentVersionId: string | null; quote: string; exact: string; prefix: string; suffix: string; start: number | null; end: number | null; startOffset: number | null; endOffset: number | null; resolvedStart: number | null; resolvedEnd: number | null; status: 'resolved' | 'needs_repair'; color: string; createdAt: string; updatedAt: string }>;
  notes: Array<{ id: string; documentVersionId: string | null; body: string; exact: string; prefix: string; suffix: string; start: number | null; end: number | null; startOffset: number | null; endOffset: number | null; resolvedStart: number | null; resolvedEnd: number | null; status: 'resolved' | 'needs_repair' | 'unanchored'; createdAt: string; updatedAt: string }>;
  tags: Array<{ id: string; name: string }>;
  processingResults: Array<{ id: string; kind: string; status: string; payloadJson: string; payload: unknown; createdAt: string }>;
};

type ReaderTag = { id: string; name: string; documentCount: number };

type ReaderBootstrapResult = {
  ok: boolean;
  error?: string;
  documents?: ReaderListItem[];
  tags?: ReaderTag[];
  session?: { selectedDocumentId: string | null; updatedAt: string | null };
};

interface Window {
  desktop: {
    ping(): Promise<{ ok: boolean; database: { ok: boolean; schemaVersion?: number; error?: string } }>;
    loginZhihu(): Promise<{ ok: boolean; partition: string }>;
    zhihuSessionSummary(): Promise<{ partition: string; cookieCount: number }>;
    captureZhihuCollection(url: string): Promise<{
      ok: boolean;
      collectionId: string;
      itemCount: number;
      pageCount: number;
      nextPageAvailable?: boolean;
      truncated?: boolean;
      failureType?: string;
      items: Array<{
        externalId?: string;
        kind?: string;
        url?: string | null;
        titleHash?: string;
        contentHash?: string | null;
        status: string;
      }>;
    }>;
    stopZhihuCapture(): Promise<{ ok: boolean }>;
    startZhihuSync(url: string): Promise<{ ok: boolean; error?: string; job?: SyncJob }>;
    getZhihuSyncStatus(jobId: string): Promise<{ ok: boolean; error?: string; job?: SyncJob }>;
    pauseZhihuSync(jobId: string): Promise<{ ok: boolean; error?: string; job?: SyncJob }>;
    resumeZhihuSync(jobId: string): Promise<{ ok: boolean; error?: string; job?: SyncJob }>;
    cancelZhihuSync(jobId: string): Promise<{ ok: boolean; error?: string; job?: SyncJob }>;
    retryZhihuSyncItem(input: { jobId: string; externalId: string }): Promise<{ ok: boolean; error?: string; job?: SyncJob }>;
    importDocumentFile(input: { name: string; kind: 'markdown' | 'html'; content: string }): Promise<{
      ok: boolean;
      status: string;
      error?: string;
      documentId?: string;
      versionId?: string;
      created?: boolean;
      versionCreated?: boolean;
      title?: string;
    }>;
    importDocumentUrl(url: string): Promise<{
      ok: boolean;
      status: string;
      error?: string;
      documentId?: string;
      versionId?: string;
      created?: boolean;
      versionCreated?: boolean;
      title?: string;
    }>;
    readerBootstrap(options?: ReaderListOptions): Promise<ReaderBootstrapResult>;
    getReaderDocument(documentId: string, versionId?: string | null): Promise<{ ok: boolean; error?: string; document?: ReaderDocument }>;
    createHighlight(input: { documentId: string; documentVersionId?: string | null; exact: string; prefix: string; suffix: string; start: number; end: number; color?: string }): Promise<{ ok: boolean; error?: string; highlight?: ReaderDocument['highlights'][number] }>;
    updateHighlight(id: string, input: { color?: string }): Promise<{ ok: boolean; error?: string; highlight?: ReaderDocument['highlights'][number] }>;
    deleteHighlight(id: string): Promise<{ ok: boolean; error?: string }>;
    createNote(input: { documentId: string; documentVersionId?: string | null; body: string; exact?: string; prefix?: string; suffix?: string; start?: number; end?: number }): Promise<{ ok: boolean; error?: string; note?: ReaderDocument['notes'][number] }>;
    updateNote(id: string, body: string): Promise<{ ok: boolean; error?: string; note?: ReaderDocument['notes'][number] }>;
    deleteNote(id: string): Promise<{ ok: boolean; error?: string }>;
    addDocumentTag(documentId: string, name: string): Promise<{ ok: boolean; error?: string; tag?: ReaderTag }>;
    removeDocumentTag(documentId: string, tagId: string): Promise<{ ok: boolean; error?: string }>;
    renameDocumentTag(tagId: string, name: string): Promise<{ ok: boolean; error?: string; tag?: ReaderTag }>;
    saveReadingState(input: { documentId: string; status?: string; favorite?: boolean; knowledgeLevel?: string; scrollTop?: number }): Promise<{ ok: boolean; error?: string; state?: { documentId: string; status: string; favorite: boolean; knowledgeLevel: string; scrollTop: number } }>;
    saveReaderSession(selectedDocumentId: string | null): Promise<{ ok: boolean; error?: string; session?: { selectedDocumentId: string | null; updatedAt: string } }>;
    smokeReady(): Promise<boolean>;
  };
}

type SyncJob = {
  id: string;
  taskId: string;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  payload: {
    source?: { type?: string; externalId?: string; url?: string | null };
    items?: Array<{ externalId: string; kind: string; url: string | null; status: string; failureType?: string | null; documentId?: string; versionCreated?: boolean }>;
    progress?: { total: number; completed: number; failed: number; remaining: number };
    phase?: string;
    failureType?: string | null;
    accessLog?: Array<{ at: string; kind: string; delayMs: number | null }>;
  };
};
