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
  if (status === 401 || status === 403) return FAILURE_TYPES.LOGIN_EXPIRED;
  if (status === 429) return FAILURE_TYPES.RATE_LIMITED;
  if (/captcha|安全验证|人机验证/i.test(text)) return FAILURE_TYPES.CAPTCHA;
  if (/付费|盐选|无权限|permission|forbidden/i.test(text)) return FAILURE_TYPES.UNAVAILABLE;
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
    return {
      externalId: String(externalId),
      kind: String(item.type ?? content?.type ?? "unknown"),
      url: typeof (item.url ?? content?.url) === "string" && (item.url ?? content?.url).startsWith("https://www.zhihu.com/") ? (item.url ?? content?.url) : null,
      titleHash: sha256(item.title ?? content?.title ?? content?.question?.title ?? ""),
      contentHash: rawContent ? sha256(rawContent) : null,
      status: item.is_locked || item.is_paid || content?.is_locked || content?.is_paid ? FAILURE_TYPES.UNAVAILABLE : "ok",
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
