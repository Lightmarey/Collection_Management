/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

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
