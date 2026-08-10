import { classifyFailure, FAILURE_TYPES, normalizeCollectionPage } from "./zhihu-m0.mjs";

export const PAGE_SIZE = 20;
export const MAX_ITEMS = 20;
export const MIN_REQUEST_DELAY_MS = 1200;

export function collectionTarget(value) {
  if (typeof value !== "string") throw new Error("collection url is required");
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.hostname !== "www.zhihu.com") throw new Error("unsupported collection url");
  const match = parsed.pathname.match(/^\/collection\/(\d+)\/?$/);
  if (!match) throw new Error("unsupported collection url");
  return { id: match[1], apiBase: `https://www.zhihu.com/api/v4/collections/${match[1]}` };
}

function isItemsUrl(value, collectionId) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname === "www.zhihu.com"
      && parsed.pathname === `/api/v4/collections/${collectionId}/items`;
  } catch {
    return false;
  }
}

function failure(response) {
  return response.marker === "none" && response.status >= 200 && response.status < 300
    ? null
    : classifyFailure({ status: response.status, body: response.marker }) ?? FAILURE_TYPES.HTTP_ERROR;
}

export async function captureCollection(value, { fetchJson, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), isStopped = () => false } = {}) {
  const target = collectionTarget(value);
  const items = [];
  let pageCount = 0;
  let nextPageAvailable = false;
  let nextUrl = `${target.apiBase}/items?offset=0&limit=${PAGE_SIZE}`;

  const result = (extra = {}) => ({
    ok: extra.failureType === undefined,
    collectionId: target.id,
    itemCount: items.length,
    pageCount,
    items: items.slice(0, MAX_ITEMS),
    ...extra,
  });

  const metadata = await fetchJson(target.apiBase);
  const metadataFailure = failure(metadata);
  if (metadataFailure) return result({ failureType: metadataFailure });

  while (nextUrl && items.length < MAX_ITEMS) {
    if (isStopped()) return result({ nextPageAvailable, failureType: FAILURE_TYPES.STOPPED });
    if (pageCount > 0) await wait(MIN_REQUEST_DELAY_MS);
    const response = await fetchJson(nextUrl);
    pageCount += 1;
    const pageFailure = failure(response);
    if (pageFailure) return result({ nextPageAvailable, failureType: pageFailure });

    const normalized = normalizeCollectionPage(response.payload);
    if (normalized.status !== "ok") return result({ nextPageAvailable, failureType: normalized.status });
    items.push(...normalized.items.slice(0, MAX_ITEMS - items.length));
    nextPageAvailable = normalized.nextPage;
    if (!normalized.nextPage) break;

    const candidate = response.payload?.paging?.next;
    if (!isItemsUrl(candidate, target.id) || candidate === nextUrl) {
      return result({ nextPageAvailable: true, failureType: FAILURE_TYPES.STRUCTURE_CHANGED });
    }
    nextUrl = candidate;
  }

  return result({ nextPageAvailable, truncated: items.length >= MAX_ITEMS && nextPageAvailable });
}
