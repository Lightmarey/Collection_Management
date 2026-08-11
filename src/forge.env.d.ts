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
  highlights: Array<{ id: string; quote: string; startOffset: number | null; endOffset: number | null; color: string; createdAt: string }>;
  notes: Array<{ id: string; body: string; createdAt: string; updatedAt: string }>;
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
    getReaderDocument(documentId: string): Promise<{ ok: boolean; error?: string; document?: ReaderDocument }>;
    saveReadingState(input: { documentId: string; status?: string; favorite?: boolean; knowledgeLevel?: string; scrollTop?: number }): Promise<{ ok: boolean; error?: string; state?: { documentId: string; status: string; favorite: boolean; knowledgeLevel: string; scrollTop: number } }>;
    saveReaderSession(selectedDocumentId: string | null): Promise<{ ok: boolean; error?: string; session?: { selectedDocumentId: string | null; updatedAt: string } }>;
    smokeReady(): Promise<boolean>;
  };
}
