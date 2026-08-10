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

contextBridge.exposeInMainWorld('desktop', {
  ping: (): Promise<{ ok: boolean; database: { ok: boolean; schemaVersion?: number; error?: string } }> => ipcRenderer.invoke('app:ping'),
  loginZhihu: (): Promise<{ ok: boolean; partition: string }> => ipcRenderer.invoke('zhihu:login'),
  zhihuSessionSummary: (): Promise<{ partition: string; cookieCount: number }> => ipcRenderer.invoke('zhihu:session-summary'),
  captureZhihuCollection: (url: string): Promise<ZhihuCaptureResult> => ipcRenderer.invoke('zhihu:capture-collection', url),
  stopZhihuCapture: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('zhihu:stop-capture'),
  smokeReady: (): Promise<boolean> => ipcRenderer.invoke('app:smoke-ready'),
});
