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

contextBridge.exposeInMainWorld('desktop', {
  ping: (): Promise<{ ok: boolean; database: { ok: boolean; schemaVersion?: number; error?: string } }> => ipcRenderer.invoke('app:ping'),
  loginZhihu: (): Promise<{ ok: boolean; partition: string }> => ipcRenderer.invoke('zhihu:login'),
  zhihuSessionSummary: (): Promise<{ partition: string; cookieCount: number }> => ipcRenderer.invoke('zhihu:session-summary'),
  captureZhihuCollection: (url: string): Promise<ZhihuCaptureResult> => ipcRenderer.invoke('zhihu:capture-collection', url),
  stopZhihuCapture: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('zhihu:stop-capture'),
  importDocumentFile: (input: { name: string; kind: 'markdown' | 'html'; content: string }): Promise<DocumentImportResult> => ipcRenderer.invoke('document:import-file', input),
  importDocumentUrl: (url: string): Promise<DocumentImportResult> => ipcRenderer.invoke('document:import-url', url),
  smokeReady: (): Promise<boolean> => ipcRenderer.invoke('app:smoke-ready'),
});
