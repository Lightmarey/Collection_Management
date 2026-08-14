export const FAILURE_TYPES: Readonly<Record<string, string>>;

export function zhihuContentId(input?: {
  externalId?: unknown;
  url?: unknown;
  kind?: unknown;
}): string | null;

export function membershipRemovalResult(
  status: number,
  membershipPresent?: boolean | null,
): { ok: boolean; error?: string; verifiedAbsent?: boolean };

export function membershipRemovalRequest(
  collectionId: string,
  contentId: string,
  contentType: "answer" | "article",
): {
  url: string;
  method: "PUT";
  headers: { "Content-Type": "application/x-www-form-urlencoded" };
  body: string;
};

export function classifyFailure(input?: { status?: number; body?: unknown }): string | null;

export function normalizeCollectionPage(payload: unknown): {
  status: string;
  items: Array<{
    externalId?: string;
    kind?: string;
    url?: string | null;
    titleHash?: string;
    contentHash?: string | null;
    updatedAt?: string | null;
    status: string;
    index?: number;
  }>;
  nextPage: boolean;
};
