export const PAGE_SIZE: number;
export const MAX_ITEMS: number;
export const MIN_REQUEST_DELAY_MS: number;

export type ZhihuSourceTarget = {
  kind: 'collection' | 'column' | 'likes';
  id: string;
  pageUrl: string;
  apiBase: string;
  itemsUrl: string;
  mode: string;
  source: string;
};

export function sourceTarget(value: string): ZhihuSourceTarget;
export function collectionTarget(value: string): { id: string; apiBase: string };

export function captureCollection(value: string, options: {
  fetchJson: (url: string) => Promise<{ status: number; payload: unknown; marker: string }>;
  wait?: (ms: number) => Promise<void>;
  isStopped?: () => boolean;
  beforeRequest?: () => boolean | Promise<boolean>;
  onRequest?: (input: { kind: string }) => void | Promise<void>;
}): Promise<{
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
    updatedAt?: string | null;
    status: string;
  }>;
}>;

export function captureSource(value: string, options: {
  fetchJson: (url: string) => Promise<{ status: number; payload: unknown; marker: string }>;
  wait?: (ms: number) => Promise<void>;
  isStopped?: () => boolean;
  beforeRequest?: () => boolean | Promise<boolean>;
  onRequest?: (input: { kind: string }) => void | Promise<void>;
}): Promise<{
  ok: boolean;
  sourceType: string;
  sourceId: string;
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
    updatedAt?: string | null;
    status: string;
  }>;
}>;
