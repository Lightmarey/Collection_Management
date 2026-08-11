import { contextBridge, ipcRenderer } from 'electron';

type ZhihuCaptureResult = {
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
};

type DocumentImportResult = {
  ok: boolean;
  status: string;
  error?: string;
  documentId?: string;
  versionId?: string;
  created?: boolean;
  versionCreated?: boolean;
  title?: string;
};

type AnnotationInput = {
  documentId: string;
  documentVersionId?: string | null;
  exact?: string;
  prefix?: string;
  suffix?: string;
  start?: number | null;
  end?: number | null;
  color?: string;
};

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
    items?: Array<{ externalId: string; kind: string; url: string | null; status: string; failureType?: string | null; documentId?: string; created?: boolean; versionCreated?: boolean }>;
    progress?: { total: number; completed: number; failed: number; skipped: number; remaining: number };
    phase?: string;
    failureType?: string | null;
    accessLog?: Array<{ at: string; kind: string; delayMs: number | null }>;
  };
};

contextBridge.exposeInMainWorld('desktop', {
  ping: (): Promise<{ ok: boolean; database: { ok: boolean; schemaVersion?: number; error?: string } }> => ipcRenderer.invoke('app:ping'),
  loginZhihu: (): Promise<{ ok: boolean; partition: string }> => ipcRenderer.invoke('zhihu:login'),
  zhihuSessionSummary: (): Promise<{ partition: string; cookieCount: number }> => ipcRenderer.invoke('zhihu:session-summary'),
  captureZhihuCollection: (url: string): Promise<ZhihuCaptureResult> => ipcRenderer.invoke('zhihu:capture-collection', url),
  stopZhihuCapture: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('zhihu:stop-capture'),
  startZhihuSync: (url: string): Promise<{ ok: boolean; error?: string; job?: SyncJob }> => ipcRenderer.invoke('zhihu:sync-start', url),
  getZhihuSyncStatus: (jobId: string): Promise<{ ok: boolean; error?: string; job?: SyncJob }> => ipcRenderer.invoke('zhihu:sync-status', jobId),
  pauseZhihuSync: (jobId: string): Promise<{ ok: boolean; error?: string; job?: SyncJob }> => ipcRenderer.invoke('zhihu:sync-pause', jobId),
  resumeZhihuSync: (jobId: string): Promise<{ ok: boolean; error?: string; job?: SyncJob }> => ipcRenderer.invoke('zhihu:sync-resume', jobId),
  cancelZhihuSync: (jobId: string): Promise<{ ok: boolean; error?: string; job?: SyncJob }> => ipcRenderer.invoke('zhihu:sync-cancel', jobId),
  retryZhihuSyncItem: (input: { jobId: string; externalId: string }): Promise<{ ok: boolean; error?: string; job?: SyncJob }> => ipcRenderer.invoke('zhihu:sync-retry-item', input),
  importDocumentFile: (input: { name: string; kind: 'markdown' | 'html'; content: string }): Promise<DocumentImportResult> => ipcRenderer.invoke('document:import-file', input),
  importDocumentUrl: (url: string): Promise<DocumentImportResult> => ipcRenderer.invoke('document:import-url', url),
  readerBootstrap: (options: ReaderListOptions = {}): Promise<ReaderBootstrapResult> => ipcRenderer.invoke('reader:bootstrap', options),
  getReaderDocument: (documentId: string, versionId?: string | null): Promise<{ ok: boolean; error?: string; document?: ReaderDocument }> => ipcRenderer.invoke('reader:get-document', documentId, versionId),
  saveReadingState: (input: { documentId: string; status?: string; favorite?: boolean; knowledgeLevel?: string; scrollTop?: number }): Promise<{ ok: boolean; error?: string; state?: { documentId: string; status: string; favorite: boolean; knowledgeLevel: string; scrollTop: number } }> => ipcRenderer.invoke('reader:save-state', input),
  saveReaderSession: (selectedDocumentId: string | null): Promise<{ ok: boolean; error?: string; session?: { selectedDocumentId: string | null; updatedAt: string } }> => ipcRenderer.invoke('reader:save-session', selectedDocumentId),
  createHighlight: (input: AnnotationInput): Promise<{ ok: boolean; error?: string; highlight?: ReaderDocument['highlights'][number] }> => ipcRenderer.invoke('annotation:create-highlight', input),
  updateHighlight: (id: string, input: { color?: string }): Promise<{ ok: boolean; error?: string; highlight?: ReaderDocument['highlights'][number] }> => ipcRenderer.invoke('annotation:update-highlight', id, input),
  deleteHighlight: (id: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('annotation:delete-highlight', id),
  createNote: (input: AnnotationInput & { body: string }): Promise<{ ok: boolean; error?: string; note?: ReaderDocument['notes'][number] }> => ipcRenderer.invoke('annotation:create-note', input),
  updateNote: (id: string, body: string): Promise<{ ok: boolean; error?: string; note?: ReaderDocument['notes'][number] }> => ipcRenderer.invoke('annotation:update-note', id, { body }),
  deleteNote: (id: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('annotation:delete-note', id),
  addDocumentTag: (documentId: string, name: string): Promise<{ ok: boolean; error?: string; tag?: ReaderTag }> => ipcRenderer.invoke('annotation:add-tag', documentId, name),
  removeDocumentTag: (documentId: string, tagId: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('annotation:remove-tag', documentId, tagId),
  renameDocumentTag: (tagId: string, name: string): Promise<{ ok: boolean; error?: string; tag?: ReaderTag }> => ipcRenderer.invoke('annotation:rename-tag', tagId, name),
  smokeReady: (): Promise<boolean> => ipcRenderer.invoke('app:smoke-ready'),
});
