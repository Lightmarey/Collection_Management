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
