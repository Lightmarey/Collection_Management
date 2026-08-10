const SECRET_KEY = /(cookie|token|authorization|password|secret|csrf|session)/i;

export function isAllowedZhihuUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'zhihu.com' || url.hostname.endsWith('.zhihu.com'));
  } catch {
    return false;
  }
}

export function isLocalUiUrl(value, devServerUrl = '') {
  if (value.startsWith('file://')) return true;
  return Boolean(devServerUrl) && value.startsWith(devServerUrl);
}

export function sanitizeForLog(value, key = '') {
  if (SECRET_KEY.test(key)) return '[REDACTED]';
  if (value instanceof Error) return { name: value.name, message: sanitizeForLog(value.message, 'message') };
  if (typeof value === 'string') {
    return value
      .replace(/(cookie|token|authorization|password|secret|csrf|session)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
      .replace(/(https?:\/\/[^\s?]+)(?:\?[^\s]*)/gi, '$1?[REDACTED]');
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeForLog(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, sanitizeForLog(item, name)]));
  }
  return value;
}
