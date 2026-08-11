export const SYNC_STATUS: Readonly<Record<string, string>>;
export function syncItemHash(item?: Record<string, unknown>): string;

export function runCollectionSync(options: {
  capture: (hooks: {
    isStopped: () => boolean;
    beforeRequest: () => boolean | Promise<boolean>;
    onRequest?: (input: { kind: string }) => void | Promise<void>;
  }) => Promise<{ ok: boolean; failureType?: string; items?: Array<Record<string, unknown>> }>;
  fetchDocument: (item: Record<string, unknown>, index: number) => Promise<{ ok: boolean; failureType?: string; documentId?: string; created?: boolean; versionCreated?: boolean }>;
  shouldFetchItem?: (item: Record<string, unknown>) => boolean | Promise<boolean>;
  controls?: { waitUntilReady?: () => boolean | Promise<boolean>; isStopped?: () => boolean; onRequest?: (input: { kind: string }) => void | Promise<void> };
  onProgress?: (value: { items: Array<Record<string, unknown>>; progress: Record<string, number>; phase?: string; currentExternalId?: string }) => void;
}): Promise<{ status: string; failureType?: string; items: Array<Record<string, unknown>>; progress: Record<string, number>; capture?: Record<string, unknown> }>;
