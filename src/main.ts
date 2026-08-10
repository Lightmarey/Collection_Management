/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

import { app, BrowserWindow, ipcMain, session } from 'electron';
import path from 'node:path';
import { isAllowedZhihuUrl, isLocalUiUrl, sanitizeForLog } from './security.mjs';
import { classifyFailure, FAILURE_TYPES, normalizeCollectionPage } from './zhihu-m0.mjs';
import { openKnowledgeDatabase, type KnowledgeDatabase } from './database.mjs';
import { importUrl, parseDocument, type ParsedDocument } from './document-import.mjs';

const ZHIHU_PARTITION = 'persist:zhihu-m0';
const ZHIHU_USER_DATA_DIR = 'knowledge-management';
const ZHIHU_PAGE_SIZE = 20;
const ZHIHU_MAX_ITEMS = 20;
const ZHIHU_MIN_REQUEST_DELAY_MS = 1200;
const ZHIHU_REQUEST_TIMEOUT_MS = 15000;
const smokeMode = process.env.KNOWLEDGE_SMOKE === '1' || process.argv.includes('--smoke');
let mainWindow: BrowserWindow | null = null;
let remoteWindow: BrowserWindow | null = null;
let collectionCaptureInProgress = false;
let collectionCaptureStopRequested = false;
let knowledgeDatabase: KnowledgeDatabase | null = null;

app.setPath('userData', path.join(app.getPath('appData'), ZHIHU_USER_DATA_DIR));

function log(event: string, details: Record<string, unknown> = {}) {
  console.log(JSON.stringify(sanitizeForLog({ event, ...details })));
}

function isTrustedLocalSender(sender: Electron.WebContents) {
  return sender === mainWindow?.webContents && isLocalUiUrl(sender.getURL(), MAIN_WINDOW_VITE_DEV_SERVER_URL);
}

function assertTrustedLocalSender(sender: Electron.WebContents) {
  if (!isTrustedLocalSender(sender)) throw new Error('untrusted ipc sender');
}

function attachRemoteGuards(window: BrowserWindow) {
  const contents = window.webContents;
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => {
    if (!isAllowedZhihuUrl(url)) event.preventDefault();
  });
  contents.on('will-redirect', (event, url) => {
    if (!isAllowedZhihuUrl(url)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
}

function attachLocalGuards(window: BrowserWindow) {
  const contents = window.webContents;
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => {
    if (!isLocalUiUrl(url, MAIN_WINDOW_VITE_DEV_SERVER_URL)) event.preventDefault();
  });
  contents.on('will-redirect', (event, url) => {
    if (!isLocalUiUrl(url, MAIN_WINDOW_VITE_DEV_SERVER_URL)) event.preventDefault();
  });
}

function configureZhihuSession() {
  const zhihuSession = session.fromPartition(ZHIHU_PARTITION);
  zhihuSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  zhihuSession.setPermissionCheckHandler(() => false);
  return zhihuSession;
}

function createRemoteWindow(url = 'https://www.zhihu.com/', visible = false) {
  if (!isAllowedZhihuUrl(url)) throw new Error('unsupported remote url');
  if (remoteWindow && !remoteWindow.isDestroyed()) {
    if (visible) {
      remoteWindow.show();
      remoteWindow.focus();
    }
    return remoteWindow;
  }

  configureZhihuSession();
  remoteWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    show: visible,
    webPreferences: {
      partition: ZHIHU_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  attachRemoteGuards(remoteWindow);
  remoteWindow.on('closed', () => { remoteWindow = null; });
  void remoteWindow.loadURL(url);
  return remoteWindow;
}

function collectionUrl(value: unknown) {
  if (typeof value !== 'string') throw new Error('collection url is required');
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'www.zhihu.com') throw new Error('unsupported collection url');
  const match = parsed.pathname.match(/^\/collection\/(\d+)\/?$/);
  if (!match) throw new Error('unsupported collection url');
  return {
    id: match[1],
    pageUrl: `https://www.zhihu.com/collection/${match[1]}`,
    apiBase: `https://www.zhihu.com/api/v4/collections/${match[1]}`,
  };
}

function isCollectionItemsUrl(value: unknown, collectionId: string) {
  if (typeof value !== 'string') return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:'
      && parsed.hostname === 'www.zhihu.com'
      && parsed.pathname === `/api/v4/collections/${collectionId}/items`;
  } catch {
    return false;
  }
}

type RemoteJsonResponse = {
  status: number;
  payload: unknown | null;
  marker: 'captcha' | 'unavailable' | 'none';
};

type RemoteHtmlResponse = {
  status: number;
  body: string;
  fetchedAt: string;
};

async function fetchJsonInRemoteSession(contents: Electron.WebContents, url: string): Promise<RemoteJsonResponse> {
  const script = `
    (async () => {
      const response = await fetch(${JSON.stringify(url)}, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(${ZHIHU_REQUEST_TIMEOUT_MS}),
      });
      let payload = null;
      try { payload = await response.json(); } catch {}
      const markerSource = payload && typeof payload === 'object'
        ? JSON.stringify({ code: payload.code, message: payload.message, error: payload.error })
        : '';
      const marker = /captcha|安全验证|人机验证/i.test(markerSource)
        ? 'captcha'
        : /付费|盐选|无权限|permission|forbidden/i.test(markerSource)
          ? 'unavailable'
          : 'none';
      return { status: response.status, payload: response.ok ? payload : null, marker };
    })()
  `;
  try {
    return await Promise.race([
      contents.executeJavaScript(script, true) as Promise<RemoteJsonResponse>,
      new Promise<RemoteJsonResponse>((resolve) => setTimeout(() => resolve({ status: 599, payload: null, marker: 'none' }), ZHIHU_REQUEST_TIMEOUT_MS)),
    ]);
  } catch {
    return { status: 599, payload: null, marker: 'none' };
  }
}

async function fetchHtmlInRemoteSession(contents: Electron.WebContents, url: string): Promise<RemoteHtmlResponse> {
  const script = `
    (async () => {
      const response = await fetch(${JSON.stringify(url)}, {
        credentials: 'include',
        headers: { Accept: 'text/html,application/xhtml+xml' },
        signal: AbortSignal.timeout(${ZHIHU_REQUEST_TIMEOUT_MS}),
      });
      return { status: response.status, body: await response.text(), fetchedAt: new Date().toISOString() };
    })()
  `;
  try {
    return await Promise.race([
      contents.executeJavaScript(script, true) as Promise<RemoteHtmlResponse>,
      new Promise<RemoteHtmlResponse>((resolve) => setTimeout(() => resolve({ status: 599, body: '', fetchedAt: new Date().toISOString() }), ZHIHU_REQUEST_TIMEOUT_MS)),
    ]);
  } catch {
    return { status: 599, body: '', fetchedAt: new Date().toISOString() };
  }
}

async function loadRemotePage(window: BrowserWindow, url: string) {
  if (window.webContents.getURL() === url) return;
  await Promise.race([
    window.loadURL(url),
    new Promise<void>((resolve) => setTimeout(resolve, ZHIHU_REQUEST_TIMEOUT_MS)),
  ]);
}

function captureResult(collectionId: string, items: unknown[], pageCount: number, extra: Record<string, unknown> = {}) {
  return {
    ok: extra.failureType === undefined,
    collectionId,
    itemCount: items.length,
    pageCount,
    items: items.slice(0, ZHIHU_MAX_ITEMS),
    ...extra,
  };
}

function classifyHttpFailure(response: RemoteJsonResponse) {
  return classifyFailure({ status: response.status, body: response.marker }) ?? FAILURE_TYPES.HTTP_ERROR;
}

function responseFailure(response: RemoteJsonResponse) {
  return response.marker === 'none' && response.status >= 200 && response.status < 300
    ? null
    : classifyHttpFailure(response);
}

async function captureCollection(url: unknown) {
  const target = collectionUrl(url);
  if (collectionCaptureInProgress) throw new Error('collection capture already running');
  collectionCaptureInProgress = true;
  collectionCaptureStopRequested = false;

  try {
    const window = createRemoteWindow(target.pageUrl);
    await loadRemotePage(window, target.pageUrl);

    const metadata = await fetchJsonInRemoteSession(window.webContents, target.apiBase);
    const metadataFailure = responseFailure(metadata);
    if (metadataFailure) {
      return captureResult(target.id, [], 0, { failureType: metadataFailure });
    }
    if (collectionCaptureStopRequested) return captureResult(target.id, [], 0, { failureType: FAILURE_TYPES.STOPPED });

    const items: unknown[] = [];
    let nextUrl = `${target.apiBase}/items?offset=0&limit=${ZHIHU_PAGE_SIZE}`;
    let pageCount = 0;
    let nextPageAvailable = false;

    while (nextUrl && items.length < ZHIHU_MAX_ITEMS) {
      if (collectionCaptureStopRequested) return captureResult(target.id, items, pageCount, { nextPageAvailable, failureType: FAILURE_TYPES.STOPPED });
      if (pageCount > 0) await new Promise((resolve) => setTimeout(resolve, ZHIHU_MIN_REQUEST_DELAY_MS));
      const response = await fetchJsonInRemoteSession(window.webContents, nextUrl);
      pageCount += 1;
      const pageFailure = responseFailure(response);
      if (pageFailure) {
        return captureResult(target.id, items, pageCount, {
          nextPageAvailable,
          failureType: pageFailure,
        });
      }

      const normalized = normalizeCollectionPage(response.payload);
      if (normalized.status !== 'ok') {
        return captureResult(target.id, items, pageCount, { nextPageAvailable, failureType: normalized.status });
      }
      items.push(...normalized.items.slice(0, ZHIHU_MAX_ITEMS - items.length));

      const paging = (response.payload as { paging?: { is_end?: unknown; next?: unknown } } | null)?.paging;
      nextPageAvailable = normalized.nextPage;
      const candidate = paging?.next;
      if (!normalized.nextPage) break;
      if (!isCollectionItemsUrl(candidate, target.id) || candidate === nextUrl) {
        return captureResult(target.id, items, pageCount, { nextPageAvailable: true, failureType: FAILURE_TYPES.STRUCTURE_CHANGED });
      }
      nextUrl = candidate as string;
    }

    return captureResult(target.id, items, pageCount, {
      nextPageAvailable,
      truncated: items.length >= ZHIHU_MAX_ITEMS && nextPageAvailable,
    });
  } finally {
    collectionCaptureInProgress = false;
    collectionCaptureStopRequested = false;
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 680,
    title: 'Knowledge Management',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  attachLocalGuards(mainWindow);

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    const suffix = smokeMode ? '?smoke=1' : '';
    void mainWindow.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}${suffix}`);
  } else {
    void mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`), {
      query: smokeMode ? { smoke: '1' } : undefined,
    });
  }
  mainWindow.webContents.on('did-finish-load', () => log('ui-loaded'));
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => log('ui-load-failed', { errorCode, errorDescription }));
  mainWindow.webContents.on('console-message', (_event, level, message) => log('ui-console', { level, message }));
  mainWindow.on('closed', () => { mainWindow = null; });
}

type ImportResult = {
  ok: boolean;
  status: string;
  error?: string;
  source?: string;
  externalId?: string;
  url?: string;
  document?: ParsedDocument;
};

function persistImportResult(result: ImportResult) {
  if (!knowledgeDatabase) return { ok: false, status: 'database_error', error: 'database_unavailable' };
  try {
    if (result.ok && result.document) {
      const write = knowledgeDatabase.upsertDocument(result.document);
      return { ok: true, status: result.status, documentId: write.documentId, versionId: write.versionId, created: write.created, versionCreated: write.versionCreated, title: result.document.title };
    }
    if (result.source && result.externalId) {
      const write = knowledgeDatabase.recordImportError({
        source: result.source,
        externalId: result.externalId,
        url: result.url ?? null,
        body: '',
        importError: result.status,
        fetchedAt: new Date().toISOString(),
      });
      return { ok: false, status: result.status, error: result.error ?? result.status, documentId: write.documentId };
    }
    return { ok: false, status: result.status, error: result.error ?? result.status };
  } catch (error) {
    log('document-import-failed', { code: error instanceof Error && 'code' in error ? error.code : 'DATABASE_ERROR' });
    return { ok: false, status: 'database_error', error: 'database_write_failed' };
  }
}

ipcMain.handle('app:ping', (event) => {
  assertTrustedLocalSender(event.sender);
  return knowledgeDatabase
    ? { ok: true, database: { ok: true, schemaVersion: knowledgeDatabase.schemaVersion } }
    : { ok: true, database: { ok: false, error: '本地数据库初始化失败，请检查磁盘权限后重启' } };
});

ipcMain.handle('zhihu:login', (event) => {
  assertTrustedLocalSender(event.sender);
  createRemoteWindow('https://www.zhihu.com/', true);
  return { ok: true, partition: ZHIHU_PARTITION };
});

ipcMain.handle('zhihu:session-summary', async (event) => {
  assertTrustedLocalSender(event.sender);
  const cookies = await session.fromPartition(ZHIHU_PARTITION).cookies.get({ domain: 'zhihu.com' });
  return { partition: ZHIHU_PARTITION, cookieCount: cookies.length };
});

ipcMain.handle('zhihu:capture-collection', async (event, url?: unknown) => {
  assertTrustedLocalSender(event.sender);
  try {
    return await captureCollection(url);
  } catch (error) {
    log('zhihu-capture-failed', { error });
    return captureResult('', [], 0, { failureType: FAILURE_TYPES.HTTP_ERROR });
  }
});

ipcMain.handle('zhihu:stop-capture', (event) => {
  assertTrustedLocalSender(event.sender);
  collectionCaptureStopRequested = true;
  return { ok: collectionCaptureInProgress };
});

ipcMain.handle('document:import-file', (event, input?: { name?: unknown; kind?: unknown; content?: unknown }) => {
  assertTrustedLocalSender(event.sender);
  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  const kind = typeof input?.kind === 'string' ? input.kind : '';
  if (!name) return persistImportResult({ ok: false, status: 'invalid_input', error: 'file_name_required' });
  const result = parseDocument({
    kind,
    content: input?.content,
    source: 'file',
    externalId: `file:${name}`,
  });
  return persistImportResult(result.ok ? result : { ...result, source: 'file', externalId: `file:${name}` });
});

ipcMain.handle('document:import-url', async (event, url?: unknown) => {
  assertTrustedLocalSender(event.sender);
  if (!isAllowedZhihuUrl(typeof url === 'string' ? url : '')) return persistImportResult({ ok: false, status: 'unsupported_source', error: 'unsupported_zhihu_url' });
  try {
    const target = typeof url === 'string' ? url : '';
    const window = createRemoteWindow(target);
    await loadRemotePage(window, target);
    const result = await importUrl(target, { fetchHtml: (sourceUrl) => fetchHtmlInRemoteSession(window.webContents, sourceUrl) });
    return persistImportResult(result);
  } catch {
    return persistImportResult({ ok: false, status: FAILURE_TYPES.HTTP_ERROR, source: 'zhihu', externalId: typeof url === 'string' ? url : '' });
  }
});

ipcMain.handle('app:smoke-ready', (event) => {
  assertTrustedLocalSender(event.sender);
  if (!smokeMode) return false;
  log('smoke-passed', { checks: ['startup', 'ipc-ping', 'close'] });
  setTimeout(() => app.quit(), 25);
  return true;
});

app.enableSandbox();
app.on('ready', () => {
  log('startup');
  try {
    knowledgeDatabase = openKnowledgeDatabase(path.join(app.getPath('userData'), 'knowledge.sqlite'));
  } catch (error) {
    log('database-startup-failed', { code: error instanceof Error && 'code' in error ? error.code : 'DATABASE_ERROR' });
  }
  configureZhihuSession();
  createMainWindow();
});
app.on('before-quit', () => {
  knowledgeDatabase?.close();
  log('shutdown');
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });
app.on('render-process-gone', (_event, _webContents, details) => log('render-process-gone', { reason: details.reason }));
process.on('uncaughtException', (error) => log('uncaught-exception', { error }));
