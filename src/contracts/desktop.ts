import type {
  DocumentImportResult,
  SourceAccountState,
  SourceOption,
  SyncItem,
  SyncJob,
  SyncMode,
} from "./domain";
import type { ReaderClient } from "./reader-client";

export * from "./domain";

export type DesktopApi = ReaderClient & {
  getAppInfo(): Promise<{
    ok: boolean;
    version: string;
    packaged: boolean;
    updateConfigured: boolean;
    distribution: "development" | "portable" | "installed";
    dataPath: string;
    database: { ok: boolean; schemaVersion?: number; error?: string };
  }>;
  exportDiagnosticLogs(): Promise<{
    ok: boolean;
    cancelled?: boolean;
    error?: string;
    path?: string;
    files?: number;
  }>;
  openDataDirectory(): Promise<{ ok: boolean; error?: string }>;
  copyDiagnosticInfo(): Promise<{ ok: boolean; error?: string }>;
  checkForUpdates(): Promise<{
    ok: boolean;
    error?: string;
    currentVersion?: string;
    latestVersion?: string;
    updateAvailable?: boolean;
    downloadUrl?: string | null;
  }>;
  openUpdatePage(url: string): Promise<{ ok: boolean; error?: string }>;
  openProjectPage(): Promise<{ ok: boolean; error?: string }>;
  createDataBackup(): Promise<{
    ok: boolean;
    cancelled?: boolean;
    error?: string;
    path?: string;
    mediaFiles?: number;
  }>;
  restoreDataBackup(): Promise<{
    ok: boolean;
    cancelled?: boolean;
    error?: string;
    mediaFiles?: number;
  }>;
  minimizeAppWindow(): Promise<{ ok: boolean }>;
  toggleMaximizeAppWindow(): Promise<{ ok: boolean; maximized: boolean }>;
  closeAppWindow(): Promise<{ ok: boolean }>;
  ping(): Promise<{
    ok: boolean;
    database: { ok: boolean; schemaVersion?: number; error?: string };
  }>;
  loginZhihu(): Promise<{ ok: boolean; partition: string }>;
  openZhihuUrl(url: string): Promise<{ ok: boolean; error?: string }>;
  zhihuSessionSummary(): Promise<{
    partition: string;
    cookieCount: number;
    authenticated: boolean;
  }>;
  captureZhihuCollection(url: string): Promise<{
    ok: boolean;
    collectionId: string;
    itemCount: number;
    pageCount: number;
    nextPageAvailable?: boolean;
    truncated?: boolean;
    failureType?: string;
    items: SyncItem[];
  }>;
  stopZhihuCapture(): Promise<{ ok: boolean }>;
  startZhihuSync(
    url: string,
    mode?: SyncMode,
  ): Promise<{ ok: boolean; error?: string; job?: SyncJob }>;
  syncZhihuDocument(url: string): Promise<DocumentImportResult>;
  getZhihuSyncStatus(
    jobId: string,
  ): Promise<{ ok: boolean; error?: string; job?: SyncJob }>;
  pauseZhihuSync(
    jobId: string,
  ): Promise<{ ok: boolean; error?: string; job?: SyncJob }>;
  resumeZhihuSync(
    jobId: string,
  ): Promise<{ ok: boolean; error?: string; job?: SyncJob }>;
  cancelZhihuSync(
    jobId: string,
  ): Promise<{ ok: boolean; error?: string; job?: SyncJob }>;
  retryZhihuSyncItem(input: {
    jobId: string;
    externalId: string;
  }): Promise<{ ok: boolean; error?: string; job?: SyncJob }>;
  importDocumentFile(input: {
    name: string;
    kind: "markdown" | "html";
    content: string;
  }): Promise<DocumentImportResult>;
  importDocumentUrl(url: string): Promise<DocumentImportResult>;
  listSources(): Promise<{
    ok: boolean;
    sources: Array<{ id: string; name: string }>;
  }>;
  getSourceAccountState(
    adapterId: string,
  ): Promise<{ ok: boolean; state?: SourceAccountState }>;
  loginSource(adapterId: string): Promise<{ ok: boolean; error?: string }>;
  discoverSources(
    adapterId: string,
  ): Promise<{ ok: boolean; sources?: SourceOption[]; error?: string }>;
  resolvePublicSource(
    adapterId: string,
    url: string,
  ): Promise<{ ok: boolean; source?: SourceOption; error?: string }>;
  startSourceSync(input: {
    urls: string[];
    mode: SyncMode;
    removeRemoteAfterSave: boolean;
  }): Promise<{ ok: boolean; error?: string; job?: SyncJob }>;
  getLatestSourceSync(): Promise<{
    ok: boolean;
    error?: string;
    job?: SyncJob;
  }>;
  skipSourceRemoteCleanup(jobId: string): Promise<{
    ok: boolean;
    error?: string;
    job?: SyncJob;
  }>;
  removeDocumentSourceMemberships(documentId: string): Promise<{
    ok: boolean;
    error?: string;
    completed?: number;
    failed?: number;
    remaining?: number;
    removedSourceIds?: string[];
    errors?: Array<{ sourceId: string; error: string }>;
  }>;
  smokeReady(input?: {
    readerLoaded?: boolean;
    hasDocuments?: boolean;
    windowControls?: boolean;
  }): Promise<boolean>;
};
