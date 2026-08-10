export const FAILURE_TYPES: Readonly<Record<string, string>>;

export function classifyFailure(input?: { status?: number; body?: unknown }): string | null;

export function normalizeCollectionPage(payload: unknown): {
  status: string;
  items: Array<{
    externalId?: string;
    kind?: string;
    url?: string | null;
    titleHash?: string;
    contentHash?: string | null;
    status: string;
    index?: number;
  }>;
  nextPage: boolean;
};
