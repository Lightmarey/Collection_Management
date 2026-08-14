import { BrowserWindow, session } from 'electron';
import { captureCollection, captureSource, sourceTarget } from '../../zhihu-capture.mjs';
import { importUrl, type ParsedDocument } from '../../document-import.mjs';
import { classifyFailure, FAILURE_TYPES, membershipRemovalRequest, membershipRemovalResult, zhihuContentId } from '../../zhihu-m0.mjs';
import { signZhihuRequest } from '../../zhihu-signature.mjs';
import { isAllowedZhihuAssetUrl, isAllowedZhihuUrl } from '../../security.mjs';
import type { CaptureResult, DiscoveredSource, SourceAdapter, SourceDescriptor, SourceResponse, StoredSourceMembership } from '../source-adapter';
import type { MediaStore } from '../../ports/media-store';
import { localizeDocumentMedia } from '../../services/media-localizer';
import { sanitizeSvg } from '../../services/svg-sanitizer.mjs';

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
const STORED_IMAGE_TYPES = new Set(['image/avif', 'image/bmp', 'image/gif', 'image/jpeg', 'image/png', 'image/webp']);

function markerFromPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object') return '';
  const value = payload as Record<string, unknown>;
  return JSON.stringify({ code: value.code, message: value.message, error: value.error, name: value.name, type: value.type, redirect_url: value.redirect_url });
}

export class ZhihuSource implements SourceAdapter {
  readonly id = 'zhihu';
  private window: BrowserWindow | null = null;
  private captureStopped = false;
  private readonly ownedCollections = new Set<string>();

  constructor(private readonly mediaStore: MediaStore, readonly partition = 'persist:zhihu-m0') {}

  configureSession() {
    const sourceSession = session.fromPartition(this.partition);
    sourceSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    sourceSession.setPermissionCheckHandler(() => false);
    return sourceSession;
  }

  supports(url: string) {
    return isAllowedZhihuUrl(url);
  }

  resolve(url: string): SourceDescriptor {
    const target = sourceTarget(url);
    return {
      source: target.source,
      kind: target.kind,
      id: target.id,
      pageUrl: target.pageUrl,
      name: target.kind === 'collection' ? `知乎收藏夹 ${target.id}` : target.kind === 'column' ? `知乎专栏 ${target.id}` : `知乎赞同 ${target.id}`,
    };
  }

  private attachGuards(window: BrowserWindow) {
    const contents = window.webContents;
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event, url) => { if (!isAllowedZhihuUrl(url)) event.preventDefault(); });
    contents.on('will-redirect', (event, url) => { if (!isAllowedZhihuUrl(url)) event.preventDefault(); });
    contents.on('will-attach-webview', (event) => event.preventDefault());
  }

  private remoteWindow(url = 'https://www.zhihu.com/', visible = false) {
    if (!isAllowedZhihuUrl(url)) throw new Error('unsupported remote url');
    if (this.window && !this.window.isDestroyed()) {
      if (visible) { this.window.show(); this.window.focus(); }
      return this.window;
    }
    this.configureSession();
    this.window = new BrowserWindow({
      width: 1100,
      height: 760,
      show: visible,
      webPreferences: { partition: this.partition, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
    });
    this.attachGuards(this.window);
    this.window.on('closed', () => { this.window = null; });
    return this.window;
  }

  private async load(url: string) {
    const window = this.remoteWindow(url);
    const contents = window.webContents;
    if (contents.getURL() === url && !contents.isLoading()) return;
    if (contents.isLoading()) contents.stop();
    const loaded = await Promise.race([
      window.loadURL(url).then(() => true).catch(() => false),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), REQUEST_TIMEOUT_MS)),
    ]);
    if (!loaded && contents.isLoading()) contents.stop();
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (!contents.getURL().startsWith('https://')) throw new Error('remote page load failed');
  }

  async open(descriptor: SourceDescriptor) {
    await this.load(descriptor.pageUrl);
  }

  openLogin() {
    const window = this.remoteWindow('https://www.zhihu.com/', true);
    void this.load('https://www.zhihu.com/').then(() => { window.show(); window.focus(); });
  }

  async openPage(url: string) {
    if (!isAllowedZhihuUrl(url)) throw new Error('unsupported remote url');
    await this.load(url);
    const window = this.remoteWindow(url, true);
    window.show();
    window.focus();
  }

  async sessionSummary() {
    const cookies = await this.configureSession().cookies.get({ domain: 'zhihu.com' });
    await this.load('https://www.zhihu.com/');
    return { partition: this.partition, cookieCount: cookies.length, authenticated: await this.verifySession() === true };
  }

  private async executeJsonFetch(requestUrl: string, headers: Record<string, string> = {}, method = 'GET', body?: string): Promise<SourceResponse> {
    try {
      const response = await this.configureSession().fetch(requestUrl, {
        method,
        credentials: 'include',
        headers: { Accept: 'application/json', ...headers },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const responseText = await response.text().catch(() => '');
      let payload: unknown = null;
      try { payload = JSON.parse(responseText); } catch {}
      const markerSource = payload && typeof payload === 'object' ? markerFromPayload(payload) : responseText.slice(0, 2048);
      const marker = /captcha|安全验证|人机验证|verification_required|challenge_required/i.test(markerSource)
        ? FAILURE_TYPES.CAPTCHA
        : /login_expired|authentication_required|err_ticket_not_exist|未登录|请先登录|登录(?:已)?失效/i.test(markerSource)
          ? FAILURE_TYPES.LOGIN_EXPIRED
          : /paid_or_no_permission|content_paid|付费内容|盐选内容|无权访问(?:该)?内容|没有权限访问(?:该)?内容/i.test(markerSource)
            ? FAILURE_TYPES.UNAVAILABLE
            : 'none';
      const redirectUrl = payload && typeof payload === 'object' && typeof (payload as Record<string, unknown>).redirect_url === 'string'
        ? String((payload as Record<string, unknown>).redirect_url)
        : response.url;
      const verificationUrl = /captcha|verify|unhuman|signin|login/i.test(redirectUrl) ? redirectUrl : null;
      const finalMarker = marker !== 'none' ? marker : verificationUrl ? (/signin|login/i.test(verificationUrl) ? FAILURE_TYPES.LOGIN_EXPIRED : FAILURE_TYPES.CAPTCHA) : 'none';
      return { status: response.status, payload, marker: finalMarker, verificationUrl, fetchedAt: new Date().toISOString() };
    } catch {
      return { status: 599, payload: null, marker: 'none', fetchedAt: new Date().toISOString() };
    }
  }

  async verifySession(): Promise<boolean | null> {
    const response = await this.executeJsonFetch('https://www.zhihu.com/api/v4/me');
    if (response.status === 401 || response.marker === FAILURE_TYPES.LOGIN_EXPIRED) return false;
    if (response.status !== 200 || !response.payload || typeof response.payload !== 'object') return null;
    const me = response.payload as Record<string, unknown>;
    if (me.id === 0 || me.id === '0' || me.is_anonymous === true) return false;
    return typeof me.id === 'string' || typeof me.url_token === 'string';
  }

  async fetchJson(url: string, include = ''): Promise<SourceResponse> {
    const requestUrl = new URL(url);
    if (include) requestUrl.searchParams.set('include', include);
    const cookies = await this.configureSession().cookies.get({ url: 'https://www.zhihu.com/', name: 'd_c0' });
    const dC0 = cookies.find((cookie) => cookie.name === 'd_c0')?.value;
    if (!dC0) {
      const authenticated = await this.verifySession();
      return { status: 401, payload: null, marker: authenticated === false ? FAILURE_TYPES.LOGIN_EXPIRED : FAILURE_TYPES.HTTP_ERROR, fetchedAt: new Date().toISOString() };
    }
    const response = await this.executeJsonFetch(requestUrl.href, signZhihuRequest(requestUrl.href, dC0));
    if ((response.status === 401 || response.status === 403) && response.marker === 'none' && await this.verifySession() === false) {
      return { ...response, marker: FAILURE_TYPES.LOGIN_EXPIRED };
    }
    const classified = classifyFailure({ status: response.status, body: response.marker === 'none' ? markerFromPayload(response.payload) : response.marker });
    return { ...response, marker: classified ?? 'none' };
  }

  private async signedRequest(url: string, method = 'GET') {
    const requestUrl = new URL(url);
    const cookies = await this.configureSession().cookies.get({ url: 'https://www.zhihu.com/', name: 'd_c0' });
    const dC0 = cookies.find((cookie) => cookie.name === 'd_c0')?.value;
    if (!dC0) return { status: 401, payload: null, marker: FAILURE_TYPES.LOGIN_EXPIRED, fetchedAt: new Date().toISOString() } satisfies SourceResponse;
    return this.executeJsonFetch(requestUrl.href, signZhihuRequest(requestUrl.href, dC0), method);
  }

  async discoverSources(): Promise<DiscoveredSource[]> {
    this.ownedCollections.clear();
    const me = await this.signedRequest('https://www.zhihu.com/api/v4/me');
    if (me.status !== 200 || !me.payload || typeof me.payload !== 'object') return [];
    const token = String((me.payload as Record<string, unknown>).url_token ?? '');
    if (!token) return [];
    const found: DiscoveredSource[] = [];
    for (let offset = 0; offset < 1000;) {
      const url = new URL(`https://www.zhihu.com/api/v4/people/${encodeURIComponent(token)}/collections`);
      url.searchParams.set('limit', '20');
      url.searchParams.set('offset', String(offset));
      const response = await this.fetchJson(url.href);
      if (response.status !== 200 || !response.payload || typeof response.payload !== 'object') break;
      const payload = response.payload as Record<string, unknown>;
      const data = Array.isArray(payload.data) ? payload.data : [];
      for (const raw of data) {
        if (!raw || typeof raw !== 'object') continue;
        const item = raw as Record<string, unknown>;
        const id = String(item.id ?? '');
        if (!/^\d+$/.test(id)) continue;
        this.ownedCollections.add(id);
        found.push({ source: 'zhihu', kind: 'collection', id, pageUrl: `https://www.zhihu.com/collection/${id}`, name: String(item.title ?? `知乎收藏夹 ${id}`), owned: true, writable: true, itemCount: Number(item.item_count ?? item.answer_count ?? 0) || 0 });
      }
      const paging = payload.paging && typeof payload.paging === 'object' ? payload.paging as Record<string, unknown> : {};
      if (paging.is_end === true || data.length === 0) break;
      offset += data.length;
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
    return found;
  }

  async removeMembership(source: SourceDescriptor, item: import('../../contracts/domain').SyncItem) {
    if (source.kind !== 'collection' || !item.externalId) return { ok: false, error: 'remote_cleanup_unsupported' };
    const contentType = /(?:zhuanlan\.zhihu\.com|www\.zhihu\.com)\/p\//.test(item.url ?? item.externalId) ? 'article' : 'answer';
    const contentId = zhihuContentId({ ...item, kind: contentType });
    if (!contentId) return { ok: false, error: 'remote_cleanup_unsupported' };
    const request = membershipRemovalRequest(source.id, contentId, contentType);
    const response = await this.executeJsonFetch(request.url, request.headers, request.method, request.body);
    if (response.status >= 200 && response.status < 300) return membershipRemovalResult(response.status);
    if (response.status !== 404 && response.status !== 599) return membershipRemovalResult(response.status);
    const captured = await captureCollection(source.pageUrl, { fetchJson: (targetUrl: string) => this.fetchJson(targetUrl) });
    const membershipPresent = captured.ok
      ? captured.items.some((candidate) => candidate.externalId === item.externalId || zhihuContentId(candidate) === contentId)
      : null;
    return membershipRemovalResult(response.status, membershipPresent);
  }

  resolveMembership(membership: StoredSourceMembership): SourceDescriptor {
    return {
      source: membership.source,
      kind: membership.source.split(':')[1] ?? 'collection',
      id: membership.sourceId,
      pageUrl: `https://www.zhihu.com/collection/${membership.sourceId}`,
      name: membership.name,
    };
  }

  async capture(url: string, hooks: Record<string, unknown> = {}): Promise<CaptureResult> {
    const descriptor = this.resolve(url);
    await this.open(descriptor);
    return (descriptor.kind === 'collection' ? captureCollection : captureSource)(url, {
      fetchJson: (targetUrl: string) => this.fetchJson(targetUrl),
      isStopped: () => this.captureStopped || (hooks.isStopped as (() => boolean) | undefined)?.() === true,
      ...hooks,
    }) as Promise<CaptureResult>;
  }

  stopCapture() {
    this.captureStopped = true;
  }

  resetCapture() {
    this.captureStopped = false;
  }

  async importDocument(url: string, fetchJson = (targetUrl: string, include = '') => this.fetchJson(targetUrl, include)) {
    return importUrl(url, { fetchJson });
  }

  async recover(response: SourceResponse, failureType: string) {
    const window = this.remoteWindow(undefined, true);
    const recoveryUrl = response.verificationUrl && isAllowedZhihuUrl(response.verificationUrl)
      ? response.verificationUrl
      : failureType === FAILURE_TYPES.LOGIN_EXPIRED ? 'https://www.zhihu.com/signin' : 'https://www.zhihu.com/account/unhuman';
    await this.load(recoveryUrl);
    window.show();
    window.focus();
  }

  hideRecovery() {
    if (this.window && !this.window.isDestroyed()) this.window.hide();
  }

  private async fetchMedia(url: string) {
    if (!isAllowedZhihuAssetUrl(url)) return null;
    try {
      const response = await this.configureSession().fetch(url, {
        credentials: 'include',
        headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,*/*;q=0.8', referer: 'https://www.zhihu.com/' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) return null;
      const mediaType = (response.headers.get('content-type') ?? '').split(';', 1)[0].toLowerCase();
      const declaredSize = Number(response.headers.get('content-length'));
      if (!mediaType.startsWith('image/') || Number.isFinite(declaredSize) && declaredSize > MAX_MEDIA_BYTES) return null;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_MEDIA_BYTES) return null;
      if (STORED_IMAGE_TYPES.has(mediaType)) return { bytes, mimeType: mediaType };
      if (mediaType === 'image/svg+xml') {
        const svg = sanitizeSvg(bytes);
        return svg ? { bytes: svg, mimeType: mediaType } : null;
      }
      return null;
    } catch {
      return null;
    }
  }

  async localize(document: ParsedDocument): Promise<ParsedDocument> {
    return localizeDocumentMedia(document, this.mediaStore, (url) => this.fetchMedia(url));
  }
}
