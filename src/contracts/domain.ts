export type SyncMode = "incremental" | "full";

export type ReaderListOptions = {
  filter?: string;
  query?: string;
  sort?: "updated" | "title" | "duration" | "status";
  sortDirection?: "asc" | "desc";
  limit?: number;
  offset?: number;
};

export type ReaderListItem = {
  id: string;
  source: string;
  externalId: string;
  title: string;
  author: string;
  url: string | null;
  fetchedAt: string | null;
  updatedAt: string | null;
  importError: string | null;
  tier: "inbox" | "short" | "medium" | "long" | "archived";
  favorite: boolean;
  deletedAt: string | null;
  coverUrl?: string | null;
  summary?: string | null;
  tagNames: string[];
  hasBody: boolean;
  estimatedMinutes: number;
};

export type ReaderHighlight = {
  id: string;
  documentVersionId: string | null;
  quote: string;
  exact: string;
  prefix: string;
  suffix: string;
  start: number | null;
  end: number | null;
  startOffset: number | null;
  endOffset: number | null;
  resolvedStart: number | null;
  resolvedEnd: number | null;
  status: "resolved" | "needs_repair";
  color: string;
  createdAt: string;
  updatedAt: string;
};

export type ReaderNote = Omit<ReaderHighlight, "quote" | "color" | "status"> & {
  body: string;
  status: "resolved" | "needs_repair" | "unanchored";
};

export type ReaderAnnotationListItem = {
  id: string;
  kind: "highlight" | "note";
  documentId: string;
  documentTitle: string;
  quote: string;
  body: string;
  color: string | null;
  status: "resolved" | "needs_repair" | "unanchored";
  createdAt: string;
  updatedAt: string;
};

export type ReaderDocument = ReaderListItem & {
  publishedAt: string | null;
  versionId: string;
  versionNumber: number;
  body: string;
  bodyState: "ok" | "empty" | "corrupt";
  scrollTop: number;
  isCurrentVersion: boolean;
  versions: Array<{
    versionId: string;
    documentId: string;
    versionNumber: number;
    title: string;
    createdAt: string;
    contentHash: string;
    isCurrent: boolean;
  }>;
  highlights: ReaderHighlight[];
  notes: ReaderNote[];
  tags: Array<{ id: string; name: string }>;
  processingResults: Array<{
    id: string;
    kind: string;
    status: string;
    payloadJson: string;
    payload: unknown;
    createdAt: string;
  }>;
  sourceMemberships: Array<{ source: string; sourceId: string; name: string }>;
};

export type ReaderPreferences = {
  locale: "zh-CN" | "en-US";
  theme: "system" | "light" | "dark";
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  paragraphSpacing: number;
  contentWidth: number;
  pageMargin: number;
  listView: "list" | "table";
  listSort?: NonNullable<ReaderListOptions["sort"]>;
  listSortDirection?: NonNullable<ReaderListOptions["sortDirection"]>;
  customFontUrl?: string;
  customFontName?: string;
  sidebarCollapsed?: boolean;
  tocHidden?: boolean;
  infoHidden?: boolean;
  rightTab?: "body" | "properties";
  navWidth?: number;
  listWidth?: number;
  tocWidth?: number;
  infoWidth?: number;
  remoteCleanupOnDelete?: boolean;
  characterShortcutsEnabled?: boolean;
  shortcutBindings?: Record<string, string>;
  quickTagSlots?: Record<string, string>;
  updatedAt?: string | null;
};

export type ReaderTag = { id: string; name: string; documentCount: number };

export type ReaderBootstrapResult = {
  ok: boolean;
  error?: string;
  documents?: ReaderListItem[];
  tags?: ReaderTag[];
  session?: { selectedDocumentId: string | null; updatedAt: string | null };
};

export type SyncItem = {
  externalId: string;
  kind: string;
  title?: string;
  url: string | null;
  status: string;
  titleHash?: string;
  contentHash?: string | null;
  updatedAt?: string | null;
  failureType?: string | null;
  httpStatus?: number | null;
  failureStage?: string | null;
  failureCode?: string | null;
  documentId?: string;
  created?: boolean;
  versionCreated?: boolean;
};

export type SyncJob = {
  id: string;
  taskId: string;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  payload: {
    mode?: SyncMode;
    source?: {
      adapterId?: string;
      type?: string;
      externalId?: string;
      url?: string | null;
    };
    items?: SyncItem[];
    progress?: {
      total: number;
      completed: number;
      failed: number;
      skipped: number;
      remaining: number;
    };
    phase?: string;
    failureType?: string | null;
    currentExternalId?: string | null;
    accessLog?: Array<{ at: string; kind: string; delayMs: number | null }>;
    sources?: Array<{
      adapterId: string;
      type: string;
      externalId: string;
      url: string;
      name?: string;
    }>;
    currentSource?: string | null;
    removeRemoteAfterSave?: boolean;
    remoteCleanup?: {
      planned?: number;
      completed: number;
      failed: number;
      errors: Array<{ externalId: string; error: string }>;
      awaitingConfirmation?: boolean;
      skipped?: boolean;
      blockedReason?: string;
      candidates?: Array<{
        sourceId: string;
        sourceName: string;
        externalId: string;
        documentId?: string;
        kind: string;
        status: string;
      }>;
    };
  };
};

export type SourceAccountState = {
  authenticated: boolean | null;
  adapterId: string;
};
export type SourceOption = {
  adapterId: string;
  kind: string;
  id: string;
  url: string;
  name: string;
  owned: boolean;
  writable: boolean;
  itemCount?: number;
};

export type DocumentImportResult = {
  ok: boolean;
  status: string;
  error?: string;
  documentId?: string;
  versionId?: string;
  created?: boolean;
  versionCreated?: boolean;
  title?: string;
};

export type AnnotationInput = {
  documentId: string;
  documentVersionId?: string | null;
  exact?: string;
  prefix?: string;
  suffix?: string;
  start?: number | null;
  end?: number | null;
  color?: string;
};
