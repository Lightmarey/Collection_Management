import { createHash } from "node:crypto";
import { classifyFailure, FAILURE_TYPES, normalizeCollectionPage } from "./zhihu-m0.mjs";

export const PAGE_SIZE = 20;
export const MIN_REQUEST_DELAY_MS = 1200;

function target(value, kind, id, pageUrl, apiBase, itemsUrl, mode) {
  return { kind, id, pageUrl, apiBase, itemsUrl, mode, source: `zhihu:${kind}` };
}

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function sourceTarget(value) {
  if (typeof value !== "string") throw new Error("collection url is required");
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") throw new Error("unsupported zhihu source url");
  if (parsed.hostname === "www.zhihu.com") {
    const collection = parsed.pathname.match(/^\/collection\/(\d+)\/?$/);
    if (collection) {
      return target(value, "collection", collection[1], `https://www.zhihu.com/collection/${collection[1]}`,
        `https://www.zhihu.com/api/v4/collections/${collection[1]}`,
        `https://www.zhihu.com/api/v4/collections/${collection[1]}/items`, "collection");
    }
    const column = parsed.pathname.match(/^\/column\/([\w-]+)\/?$/);
    if (column) {
      return target(value, "column", column[1], `https://www.zhihu.com/column/${column[1]}`,
        `https://www.zhihu.com/api/v4/columns/${column[1]}`,
        `https://www.zhihu.com/api/v4/columns/${column[1]}/items`, "column");
    }
    const likes = parsed.pathname.match(/^\/people\/([\w-]+)\/(?:activities|voteups)\/?$/);
    if (likes) {
      return target(value, "likes", likes[1], `https://www.zhihu.com/people/${likes[1]}/activities`,
        `https://www.zhihu.com/api/v3/moments/${likes[1]}/activities`,
        `https://www.zhihu.com/api/v3/moments/${likes[1]}/activities`, "likes");
    }
  }
  if (parsed.hostname === "zhuanlan.zhihu.com") {
    const column = parsed.pathname.match(/^\/([\w-]+)\/?$/);
    if (column) {
      return target(value, "column", column[1], `https://zhuanlan.zhihu.com/${column[1]}`,
        `https://www.zhihu.com/api/v4/columns/${column[1]}`,
        `https://www.zhihu.com/api/v4/columns/${column[1]}/items`, "column");
    }
  }
  throw new Error("unsupported zhihu source url");
}

export function collectionTarget(value) {
  const result = sourceTarget(value);
  if (result.kind !== "collection") throw new Error("unsupported collection url");
  return { id: result.id, apiBase: result.apiBase };
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

function isAllowedNextUrl(value, targetValue) {
  try {
    const next = new URL(value);
    const base = new URL(targetValue.itemsUrl);
    return next.protocol === "https:" && next.hostname === base.hostname
      && next.pathname === base.pathname && next.href !== targetValue.itemsUrl;
  } catch {
    return false;
  }
}

function failure(response) {
  return response.marker === "none" && response.status >= 200 && response.status < 300
    ? null
    : classifyFailure({ status: response.status, body: response.marker }) ?? FAILURE_TYPES.HTTP_ERROR;
}

export async function captureCollection(value, {
  fetchJson,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  isStopped = () => false,
  beforeRequest = async () => true,
  onRequest = () => {},
} = {}) {
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
    items,
    ...extra,
  });

  if (isStopped() || !(await beforeRequest())) return result({ failureType: FAILURE_TYPES.STOPPED });
  await onRequest({ kind: "metadata" });
  const metadata = await fetchJson(target.apiBase);
  const metadataFailure = failure(metadata);
  if (metadataFailure) return result({ failureType: metadataFailure });

  const visitedPages = new Set();
  while (nextUrl) {
    if (isStopped()) return result({ nextPageAvailable, failureType: FAILURE_TYPES.STOPPED });
    if (visitedPages.has(nextUrl)) return result({ nextPageAvailable: true, failureType: FAILURE_TYPES.STRUCTURE_CHANGED });
    visitedPages.add(nextUrl);
    if (pageCount > 0) await wait(MIN_REQUEST_DELAY_MS);
    if (isStopped() || !(await beforeRequest())) return result({ nextPageAvailable, failureType: FAILURE_TYPES.STOPPED });
    await onRequest({ kind: "items" });
    const response = await fetchJson(nextUrl);
    pageCount += 1;
    const pageFailure = failure(response);
    if (pageFailure) return result({ nextPageAvailable, failureType: pageFailure });

    const normalized = normalizeCollectionPage(response.payload);
    if (normalized.status !== "ok") return result({ nextPageAvailable, failureType: normalized.status });
    items.push(...normalized.items);
    nextPageAvailable = normalized.nextPage;
    if (!normalized.nextPage) break;

    const candidate = response.payload?.paging?.next;
    if (!isItemsUrl(candidate, target.id) || candidate === nextUrl) {
      return result({ nextPageAvailable: true, failureType: FAILURE_TYPES.STRUCTURE_CHANGED });
    }
    nextUrl = candidate;
  }

  return result({ nextPageAvailable, truncated: false });
}

function activityIsLike(item) {
  const text = [item?.verb, item?.action, item?.action_text, item?.actionText, item?.type].filter(Boolean).join(" ");
  return /vote.?up|like|赞同|点赞/i.test(text);
}

function normalizeSourceItems(payload, mode) {
  if (mode === "collection") return normalizeCollectionPage(payload);
  const items = Array.isArray(payload?.data) ? payload.data : payload?.data?.items;
  if (!Array.isArray(items)) return { status: FAILURE_TYPES.STRUCTURE_CHANGED, items: [], nextPage: false };
  const normalized = items
    .filter((item) => mode !== "likes" || activityIsLike(item))
    .map((item, index) => {
      const content = item?.target && typeof item.target === "object" ? item.target
        : item?.content && typeof item.content === "object" ? item.content : item;
      const externalId = item?.id ?? content?.id ?? item?.target_id ?? item?.targetId;
      const url = item?.url ?? content?.url;
      if (externalId == null || typeof url !== "string" || !/^https:\/\/(?:www|zhuanlan)\.zhihu\.com\//.test(url)) {
        return { index, status: FAILURE_TYPES.STRUCTURE_CHANGED };
      }
      const rawContent = item.content_html ?? item.body ?? content?.content ?? content?.excerpt ?? "";
      return {
        externalId: String(externalId),
        kind: String(item.type ?? content?.type ?? "unknown"),
        url,
        titleHash: hash(item.title ?? content?.title ?? ""),
        contentHash: rawContent ? hash(rawContent) : null,
        status: item.is_locked || item.is_paid || content?.is_locked || content?.is_paid ? FAILURE_TYPES.UNAVAILABLE : "ok",
      };
    });
  return {
    status: normalized.some((item) => item.status === FAILURE_TYPES.STRUCTURE_CHANGED) ? FAILURE_TYPES.STRUCTURE_CHANGED : "ok",
    items: normalized,
    nextPage: Boolean(payload?.paging && payload.paging.is_end === false && typeof payload.paging.next === "string"),
  };
}

export async function captureSource(value, {
  fetchJson,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  isStopped = () => false,
  beforeRequest = async () => true,
  onRequest = () => {},
} = {}) {
  const source = sourceTarget(value);
  if (source.kind === "collection") return captureCollection(value, { fetchJson, wait, isStopped, beforeRequest, onRequest });
  const items = [];
  let pageCount = 0;
  let nextPageAvailable = false;
  let nextUrl = source.itemsUrl;
  const result = (extra = {}) => ({
    ok: extra.failureType === undefined,
    sourceType: source.kind,
    sourceId: source.id,
    itemCount: items.length,
    pageCount,
    items,
    ...extra,
  });
  if (isStopped() || !(await beforeRequest())) return result({ failureType: FAILURE_TYPES.STOPPED });
  await onRequest({ kind: "items" });
  const visitedPages = new Set();
  while (nextUrl) {
    if (isStopped()) return result({ nextPageAvailable, failureType: FAILURE_TYPES.STOPPED });
    if (visitedPages.has(nextUrl)) return result({ nextPageAvailable: true, failureType: FAILURE_TYPES.STRUCTURE_CHANGED });
    visitedPages.add(nextUrl);
    if (pageCount > 0) await wait(MIN_REQUEST_DELAY_MS);
    if (pageCount > 0 && !(await beforeRequest())) return result({ nextPageAvailable, failureType: FAILURE_TYPES.STOPPED });
    if (pageCount > 0) await onRequest({ kind: "items" });
    const response = await fetchJson(nextUrl);
    pageCount += 1;
    const responseFailure = failure(response);
    if (responseFailure) return result({ nextPageAvailable, failureType: responseFailure });
    const normalized = normalizeSourceItems(response.payload, source.mode);
    if (normalized.status !== "ok") return result({ nextPageAvailable, failureType: normalized.status });
    items.push(...normalized.items);
    nextPageAvailable = normalized.nextPage;
    if (!normalized.nextPage) break;
    const candidate = response.payload?.paging?.next;
    if (!isAllowedNextUrl(candidate, source) || candidate === nextUrl) return result({ nextPageAvailable: true, failureType: FAILURE_TYPES.STRUCTURE_CHANGED });
    nextUrl = candidate;
  }
  return result({ nextPageAvailable, truncated: false });
}
