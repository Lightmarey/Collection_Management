import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';
import { Readability } from '@mozilla/readability';
import { classifyFailure, FAILURE_TYPES } from './zhihu-m0.mjs';
import { isAllowedZhihuUrl } from './security.mjs';

export const IMPORT_STATUS = Object.freeze({
  OK: 'ok',
  INVALID_INPUT: 'invalid_input',
  UNSUPPORTED_SOURCE: 'unsupported_source',
  STRUCTURE_CHANGED: FAILURE_TYPES.STRUCTURE_CHANGED,
  LOGIN_EXPIRED: FAILURE_TYPES.LOGIN_EXPIRED,
  RATE_LIMITED: FAILURE_TYPES.RATE_LIMITED,
  CAPTCHA: FAILURE_TYPES.CAPTCHA,
  PAID_OR_NO_PERMISSION: FAILURE_TYPES.UNAVAILABLE,
  HTTP_ERROR: FAILURE_TYPES.HTTP_ERROR,
});

const ZHIHU_ARTICLE_INCLUDE = 'content,topics,paid_info,can_comment,excerpt,thanks_count,voteup_count,comment_count,visited_count,relationship,ip_info,relationship.vote,author.badge_v2';
const ZHIHU_ANSWER_INCLUDE = '.settings,content,editable_content,paid_info,can_comment,excerpt,thanks_count,voteup_count,comment_count,visited_count,attachment,reaction,ip_info,pagination_info,endorsements,question.topics,question.author,reaction.relation.voting,author.badge_v2,settings.table_of_contents.enabled';

const ALLOWED_KINDS = new Set(['markdown', 'html']);
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

function value(value) {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function normalizeUrl(valueToNormalize) {
  try {
    const url = new URL(valueToNormalize);
    url.hash = '';
    return url.href;
  } catch {
    return valueToNormalize;
  }
}

function safeAttributeUrl(raw, baseUrl = '') {
  const candidate = value(raw).trim();
  if (!candidate || candidate.startsWith('#')) return candidate.startsWith('#') ? candidate : null;
  if (/^(?:javascript|vbscript|data|file):/i.test(candidate)) return null;
  try {
    const resolved = new URL(candidate, baseUrl || 'https://offline.invalid/');
    return SAFE_PROTOCOLS.has(resolved.protocol) ? resolved.href : null;
  } catch {
    return null;
  }
}

function sanitizeHtml(html, baseUrl = '') {
  const window = new JSDOM('').window;
  window.document.body.innerHTML = value(html);
  for (const image of window.document.querySelectorAll('img')) {
    const preferred = image.getAttribute('data-actualsrc') || image.getAttribute('data-original');
    const resolved = safeAttributeUrl(preferred, baseUrl);
    if (resolved) image.setAttribute('src', resolved);
    image.removeAttribute('srcset');
  }
  for (const source of window.document.querySelectorAll('picture source')) source.remove();
  const purifier = createDOMPurify(window);
  purifier.addHook('uponSanitizeAttribute', (_node, data) => {
    const name = data.attrName.toLowerCase();
    if (name.startsWith('on') || name === 'style' || ['href', 'src', 'poster', 'action', 'formaction'].includes(name)) {
      const safe = ['href', 'src', 'poster'].includes(name) ? safeAttributeUrl(data.attrValue, baseUrl) : null;
      if (name.startsWith('on') || name === 'style' || !safe) data.keepAttr = false;
      else {
        data.attrValue = safe;
        data.forceKeepAttr = true;
      }
    }
  });
  purifier.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.hasAttribute('href')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
  const clean = purifier.sanitize(window.document.body.innerHTML, {
    ALLOW_DATA_ATTR: false,
    FORBID_ATTR: ['style'],
    FORBID_TAGS: ['base', 'embed', 'form', 'iframe', 'input', 'link', 'meta', 'object', 'script', 'style', 'svg', 'template'],
  });
  window.close();
  return clean;
}

function mediaReferences(html, baseUrl = '') {
  const dom = new JSDOM(`<body>${html}</body>`, { url: baseUrl || 'https://offline.invalid/' });
  const document = dom.window.document;
  const references = [];
  const seen = new Set();
  for (const element of document.querySelectorAll('img, audio, video, source')) {
    const attributes = element.tagName === 'VIDEO' ? ['src', 'poster'] : ['src'];
    for (const attribute of attributes) {
      const url = safeAttributeUrl(element.getAttribute(attribute), baseUrl);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      references.push({ type: element.tagName.toLowerCase(), url, alt: value(element.getAttribute('alt')) });
    }
  }
  dom.window.close();
  return references;
}

function escapeHtml(raw) {
  return value(raw).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function inlineMarkdown(raw) {
  let result = escapeHtml(raw);
  result = result.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_match, alt, url, title) => `<img src="${escapeHtml(url)}" alt="${alt}"${title ? ` title="${escapeHtml(title)}"` : ''}>`);
  result = result.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_match, label, url, title) => `<a href="${escapeHtml(url)}"${title ? ` title="${escapeHtml(title)}"` : ''}>${label}</a>`);
  result = result.replace(/`([^`]+)`/g, '<code>$1</code>');
  result = result.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
  result = result.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>').replace(/(^|[^_])_([^_]+)_/g, '$1<em>$2</em>');
  return result;
}

export function markdownToHtml(markdown) {
  const lines = value(markdown).replaceAll('\r\n', '\n').split('\n');
  const blocks = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (/^\s*```/.test(line)) {
      const language = line.trim().slice(3).trim();
      const code = [];
      index += 1;
      while (index < lines.length && !/^\s*```/.test(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index += 1;
      blocks.push(`<pre><code${language ? ` class="language-${escapeHtml(language)}"` : ''}>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      blocks.push(`<h${heading[1].length}>${inlineMarkdown(heading[2])}</h${heading[1].length}>`);
      index += 1;
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) items.push(`<li>${inlineMarkdown(lines[index++].replace(/^\s*[-*+]\s+/, ''))}</li>`);
      blocks.push(`<ul>${items.join('')}</ul>`);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) items.push(`<li>${inlineMarkdown(lines[index++].replace(/^\s*\d+\.\s+/, ''))}</li>`);
      blocks.push(`<ol>${items.join('')}</ol>`);
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const quote = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) quote.push(lines[index++].replace(/^\s*>\s?/, ''));
      blocks.push(`<blockquote>${inlineMarkdown(quote.join('\n'))}</blockquote>`);
      continue;
    }
    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !/^\s*(?:#{1,6}\s|[-*+]\s|\d+\.\s|>\s|```)/.test(lines[index])) paragraph.push(lines[index++]);
    blocks.push(`<p>${inlineMarkdown(paragraph.join('\n')).replaceAll('\n', '<br>')}</p>`);
  }
  return blocks.join('\n');
}

function markdownTitle(markdown) {
  const heading = value(markdown).match(/^\s{0,3}#\s+(.+?)\s*#*\s*$/m);
  return heading ? heading[1].trim() : '';
}

function metadata(document, selectors) {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    const content = element?.getAttribute('content') || element?.getAttribute('datetime') || element?.textContent;
    if (content?.trim()) return content.trim();
  }
  return '';
}

function extractHtmlDocument(html, url = '') {
  const dom = new JSDOM(html, { url: url || 'https://offline.invalid/' });
  const document = dom.window.document;
  const zhihuContent = document.querySelector('.RichContent-inner, .Post-RichText, .RichText, article .RichContent');
  const readable = new Readability(document.cloneNode(true)).parse();
  const content = zhihuContent?.innerHTML || readable?.content || document.body?.innerHTML || '';
  const title = metadata(document, ['meta[property="og:title"]', 'meta[name="twitter:title"]', 'title']) || readable?.title || '';
  const author = metadata(document, ['meta[name="author"]', 'meta[property="article:author"]', '.AuthorInfo-name', '[data-za-detail-view-element_name="User"]']);
  const publishedAt = metadata(document, ['meta[property="article:published_time"]', 'meta[name="datePublished"]', 'time[datetime]']);
  dom.window.close();
  return { title, author, publishedAt, content };
}

function failureResult(status, error = status) {
  return { ok: false, status, error };
}

function detailDate(valueToFormat) {
  if (typeof valueToFormat === 'number' && Number.isFinite(valueToFormat)) {
    return new Date(valueToFormat > 10_000_000_000 ? valueToFormat : valueToFormat * 1000).toISOString();
  }
  return value(valueToFormat);
}

export function zhihuContentDetailRequest(rawUrl) {
  const normalized = normalizeUrl(value(rawUrl));
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'https:') return null;
    const segments = parsed.pathname.split('/').filter(Boolean);
    let type;
    let id;
    if ((parsed.hostname === 'www.zhihu.com' || parsed.hostname === 'zhihu.com') && segments[0] === 'question' && segments[2] === 'answer') {
      type = 'answer';
      id = segments[3];
    } else if ((parsed.hostname === 'www.zhihu.com' || parsed.hostname === 'zhihu.com') && segments[0] === 'answer') {
      type = 'answer';
      id = segments[1];
    } else if ((parsed.hostname === 'zhuanlan.zhihu.com' || parsed.hostname === 'www.zhihu.com') && segments[0] === 'p') {
      type = 'article';
      id = segments[1];
    } else if (parsed.hostname === 'www.zhihu.com' && segments[0] === 'appview' && segments[1] === 'p') {
      type = 'article';
      id = segments[2];
    }
    if (!type || !/^\d+$/.test(id ?? '')) return null;
    return {
      type,
      id,
      url: `https://www.zhihu.com/api/v4/${type === 'answer' ? 'answers' : 'articles'}/${id}`,
      include: type === 'answer' ? ZHIHU_ANSWER_INCLUDE : ZHIHU_ARTICLE_INCLUDE,
    };
  } catch {
    return null;
  }
}

function visibleResponseText(body) {
  const raw = value(body);
  if (!/<[a-z][\s\S]*>/i.test(raw)) return raw;
  const dom = new JSDOM(raw);
  for (const element of dom.window.document.querySelectorAll('script, style, noscript, template')) element.remove();
  const textContent = dom.window.document.body?.textContent || '';
  dom.window.close();
  return textContent;
}

function classifyImportFailure(status, body = '') {
  const textBody = visibleResponseText(body);
  return classifyFailure({ status, body: textBody }) || (status >= 400 ? IMPORT_STATUS.HTTP_ERROR : null);
}

export function parseDocument(input = {}) {
  const kind = value(input.kind).toLowerCase();
  const content = value(input.content ?? input.body);
  const source = value(input.source).trim();
  const externalId = value(input.externalId).trim();
  if (!ALLOWED_KINDS.has(kind) || !content || !source || !externalId) return failureResult(IMPORT_STATUS.INVALID_INPUT, 'invalid_document_input');
  const url = input.url == null ? null : normalizeUrl(value(input.url));
  const fetchedAt = value(input.fetchedAt) || new Date().toISOString();
  const extracted = kind === 'markdown' ? { title: value(input.title) || markdownTitle(content), author: value(input.author), publishedAt: value(input.publishedAt), content: markdownToHtml(content) } : extractHtmlDocument(content, url || '');
  const body = sanitizeHtml(extracted.content, url || '');
  if (!body.trim()) return failureResult(IMPORT_STATUS.STRUCTURE_CHANGED, 'content_not_found');
  return {
    ok: true,
    status: IMPORT_STATUS.OK,
    document: {
      source,
      externalId,
      title: value(input.title) || extracted.title,
      author: value(input.author) || extracted.author,
      url,
      publishedAt: value(input.publishedAt) || extracted.publishedAt || null,
      fetchedAt,
      body,
      mediaRefs: mediaReferences(body, url || ''),
      importError: null,
    },
  };
}

export async function importZhihuContent(url, { fetchJson } = {}) {
  const normalized = normalizeUrl(value(url));
  if (!isAllowedZhihuUrl(normalized)) return failureResult(IMPORT_STATUS.UNSUPPORTED_SOURCE, 'unsupported_zhihu_url');
  const request = zhihuContentDetailRequest(normalized);
  if (!request) return { ...failureResult(IMPORT_STATUS.STRUCTURE_CHANGED), source: 'zhihu', externalId: normalized, url: normalized };
  if (typeof fetchJson !== 'function') throw new TypeError('fetchJson is required for Zhihu content detail import');

  let response;
  try {
    response = await fetchJson(request.url, request.include);
  } catch {
    return { ...failureResult(IMPORT_STATUS.HTTP_ERROR), source: 'zhihu', externalId: normalized, url: normalized, httpStatus: null, failureStage: 'document_detail' };
  }
  const payload = response?.payload && typeof response.payload === 'object' ? response.payload : null;
  const content = typeof payload?.content === 'string' ? payload.content : typeof payload?.editable_content === 'string' ? payload.editable_content : '';
  if (!content.trim()) {
    const status = classifyFailure({ status: Number(response?.status), body: response?.marker ?? payload ?? '' });
    return { ...failureResult(status ?? IMPORT_STATUS.STRUCTURE_CHANGED), source: 'zhihu', externalId: normalized, url: normalized, httpStatus: Number.isInteger(Number(response?.status)) ? Number(response.status) : null, failureStage: 'document_detail' };
  }
  const title = value(payload?.title) || value(payload?.question?.title);
  const author = value(payload?.author?.name) || value(payload?.question?.author?.name);
  const publishedAt = detailDate(payload?.created_time ?? payload?.createdTime);
  const parsed = parseDocument({ kind: 'html', content: `<div class="RichContent-inner">${content}</div>`, source: 'zhihu', externalId: normalized, url: normalized, title, author, publishedAt, fetchedAt: response?.fetchedAt });
  return parsed.ok ? parsed : { ...parsed, source: 'zhihu', externalId: normalized, url: normalized };
}

export async function importUrl(url, { fetchHtml, fetchJson } = {}) {
  const normalized = normalizeUrl(value(url));
  if (!isAllowedZhihuUrl(normalized)) return failureResult(IMPORT_STATUS.UNSUPPORTED_SOURCE, 'unsupported_zhihu_url');
  if (typeof fetchJson === 'function') return importZhihuContent(normalized, { fetchJson });
  if (typeof fetchHtml !== 'function') throw new TypeError('fetchHtml is required for user-authorized URL import');
  let response;
  try {
    response = await fetchHtml(normalized);
  } catch {
    return { ...failureResult(IMPORT_STATUS.HTTP_ERROR), source: 'zhihu', externalId: normalized, url: normalized };
  }
  const status = classifyImportFailure(Number(response?.status), response?.body);
  if (status) return { ...failureResult(status), source: 'zhihu', externalId: normalized, url: normalized };
  const parsed = parseDocument({ kind: 'html', content: response?.body, source: 'zhihu', externalId: normalized, url: normalized, fetchedAt: response?.fetchedAt });
  return parsed.ok ? parsed : { ...parsed, source: 'zhihu', externalId: normalized, url: normalized };
}
