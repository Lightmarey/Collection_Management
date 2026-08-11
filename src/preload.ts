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
  smokeReady: (): Promise<boolean> => ipcRenderer.invoke('app:smoke-ready'),
});
