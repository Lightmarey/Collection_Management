import { createHash } from "node:crypto";

const SECRET_KEY = /(cookie|token|authorization|password|secret|csrf|session)/i;
const BODY_KEY = /(body|content|html|markdown|text)/i;

export const FAILURE_TYPES = Object.freeze({
  LOGIN_EXPIRED: "login_expired",
  RATE_LIMITED: "rate_limited",
  CAPTCHA: "captcha",
  UNAVAILABLE: "paid_or_no_permission",
  STRUCTURE_CHANGED: "structure_changed",
  HTTP_ERROR: "http_error",
  STOPPED: "stopped",
});

export function zhihuContentId({ externalId, url, kind } = {}) {
  const direct = String(externalId ?? "").trim();
  if (/^\d+$/.test(direct)) return direct;
  const candidate = String(url ?? direct).trim();
  const pattern = kind === "article" ? /\/p\/(\d+)(?:[/?#]|$)/ : /\/answer\/(\d+)(?:[/?#]|$)/;
  return candidate.match(pattern)?.[1] ?? null;
}

export function membershipRemovalResult(status, membershipPresent = null) {
  if (status >= 200 && status < 300) return { ok: true };
  if (status === 404 || status === 599) {
    if (membershipPresent === false) return { ok: true, verifiedAbsent: true };
    if (membershipPresent === true) return { ok: false, error: "remote_membership_still_present" };
    return { ok: false, error: "remote_state_unknown" };
  }
  return { ok: false, error: `http_${status}` };
}

export function membershipRemovalRequest(collectionId, contentId, contentType) {
  if (!/^\d+$/.test(String(collectionId)) || !/^\d+$/.test(String(contentId))) throw new TypeError("invalid Zhihu membership id");
  const type = contentType === "article" ? "article" : "answer";
  return {
    url: `https://api.zhihu.com/collections/contents/${type}/${contentId}`,
    method: "PUT",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `remove_collections=${encodeURIComponent(collectionId)}`,
  };
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function redactString(value) {
  return value
    .replace(/(cookie|token|authorization|password|secret|csrf|session)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/(https?:\/\/[^\s?]+)[?&](token|auth|sign|zse)[^\s]*/gi, "$1?[REDACTED]");
}

export function redact(value, key = "") {
  if (SECRET_KEY.test(key) || BODY_KEY.test(key)) return "[REDACTED]";
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redact(item, name)]));
  }
  return value;
}

export function classifyFailure({ status, body = "" } = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  if (status === 429) return FAILURE_TYPES.RATE_LIMITED;
  if (/captcha|安全验证|人机验证|verification_required|challenge_required/i.test(text)) return FAILURE_TYPES.CAPTCHA;
  if (/login_expired|authentication_required|err_ticket_not_exist|未登录|请先登录|登录(?:已)?失效/i.test(text)) return FAILURE_TYPES.LOGIN_EXPIRED;
  if (/paid_or_no_permission|content_paid|付费内容|盐选内容|无权访问(?:该)?内容|没有权限访问(?:该)?内容/i.test(text)) return FAILURE_TYPES.UNAVAILABLE;
  if (status >= 400) return FAILURE_TYPES.HTTP_ERROR;
  return null;
}

export function normalizeCollectionPage(payload) {
  const rawData = payload?.data;
  const items = Array.isArray(rawData) ? rawData : rawData?.items;
  const paging = payload?.paging ?? rawData?.paging;
  if (!Array.isArray(items)) {
    return { status: FAILURE_TYPES.STRUCTURE_CHANGED, items: [], nextPage: false };
  }

  const normalizedItems = items.map((item, index) => {
    const content = item?.content && typeof item.content === "object" ? item.content : item;
    const externalId = item?.id ?? item?.external_id ?? content?.id ?? content?.external_id;
    if (externalId === undefined || externalId === null) {
      return { index, status: FAILURE_TYPES.STRUCTURE_CHANGED };
    }
    const rawContent = item.content_html ?? item.body ?? (typeof item.content === "string" ? item.content : null)
      ?? content?.content_html ?? content?.content ?? content?.excerpt ?? content?.detailsText ?? "";
    const itemUrl = item.url ?? content.url;
    const updatedAt = item.updated_time ?? item.updated_at ?? item.updatedAt
      ?? content?.updated_time ?? content?.updated_at ?? content?.updatedAt ?? null;
    const allowedUrl = typeof itemUrl === "string" && /^https:\/\/(?:www|zhuanlan)\.zhihu\.com\//.test(itemUrl)
      ? itemUrl
      : null;
    return {
      externalId: String(externalId),
      kind: String(item.type ?? content?.type ?? "unknown"),
      title: String(item.title ?? content?.title ?? content?.question?.title ?? ""),
      url: allowedUrl,
      titleHash: sha256(item.title ?? content?.title ?? content?.question?.title ?? ""),
      contentHash: rawContent ? sha256(rawContent) : null,
      updatedAt: updatedAt == null ? null : String(updatedAt),
      status: "ok",
    };
  });

  return {
    status: normalizedItems.some((item) => item.status === FAILURE_TYPES.STRUCTURE_CHANGED)
      ? FAILURE_TYPES.STRUCTURE_CHANGED
      : "ok",
    items: normalizedItems,
    nextPage: Boolean(paging && paging.is_end === false && typeof paging.next === "string"),
  };
}

export function safeLogEvent(event) {
  const safe = redact(event);
  delete safe.body;
  delete safe.content;
  return safe;
}
