/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

interface Window {
  desktop: {
    ping(): Promise<{ ok: boolean }>;
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
    smokeReady(): Promise<boolean>;
  };
}
