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
  const data = payload?.data ?? payload;
  if (!data || !Array.isArray(data.items)) {
    return { status: FAILURE_TYPES.STRUCTURE_CHANGED, items: [], nextPage: false };
  }

  const items = data.items.map((item, index) => {
    const externalId = item?.id ?? item?.external_id;
    if (externalId === undefined || externalId === null) {
      return { index, status: FAILURE_TYPES.STRUCTURE_CHANGED };
    }
    const rawContent = item.content_html ?? item.content ?? item.body ?? "";
    return {
      externalId: String(externalId),
      kind: String(item.type ?? "unknown"),
      url: typeof item.url === "string" && item.url.startsWith("https://www.zhihu.com/") ? item.url : null,
      titleHash: sha256(item.title ?? item.question?.title ?? ""),
      contentHash: rawContent ? sha256(rawContent) : null,
      status: item.is_locked || item.is_paid ? FAILURE_TYPES.UNAVAILABLE : "ok",
    };
  });

  return {
    status: items.some((item) => item.status === FAILURE_TYPES.STRUCTURE_CHANGED)
      ? FAILURE_TYPES.STRUCTURE_CHANGED
      : "ok",
    items,
    nextPage: Boolean(data.paging && data.paging.is_end === false),
  };
}

export function safeLogEvent(event) {
  const safe = redact(event);
  delete safe.body;
  delete safe.content;
  return safe;
}
