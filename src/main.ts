/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

import { app, BrowserWindow, ipcMain, session } from 'electron';
import path from 'node:path';
import { isAllowedZhihuUrl, isLocalUiUrl, sanitizeForLog } from './security.mjs';
import { FAILURE_TYPES } from './zhihu-m0.mjs';
import { captureCollection, captureSource, collectionTarget, sourceTarget } from './zhihu-capture.mjs';
import { runCollectionSync, SYNC_STATUS } from './zhihu-sync.mjs';
import { openKnowledgeDatabase, type KnowledgeDatabase } from './database.mjs';
import { importUrl, parseDocument, type ParsedDocument } from './document-import.mjs';

const ZHIHU_PARTITION = 'persist:zhihu-m0';
const ZHIHU_USER_DATA_DIR = 'knowledge-management';
const ZHIHU_REQUEST_TIMEOUT_MS = 15000;
const smokeMode = process.env.KNOWLEDGE_SMOKE === '1' || process.argv.includes('--smoke');
let mainWindow: BrowserWindow | null = null;
let remoteWindow: BrowserWindow | null = null;
let collectionCaptureInProgress = false;
let collectionCaptureStopRequested = false;
let knowledgeDatabase: KnowledgeDatabase | null = null;
let activeSync: { jobId: string; state: 'running' | 'paused' | 'cancelled'; lastRequestAt: number | null } | null = null;

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

async function captureWithRemoteSession(url: string, controls: Record<string, unknown> = {}) {
  const target = collectionTarget(url);
  const window = createRemoteWindow(`https://www.zhihu.com/collection/${target.id}`);
  await loadRemotePage(window, `https://www.zhihu.com/collection/${target.id}`);
  return captureCollection(url, {
    fetchJson: (targetUrl: string) => fetchJsonInRemoteSession(window.webContents, targetUrl),
    ...controls,
  });
}

type SyncItem = {
  externalId: string;
  kind: string;
  url: string | null;
  status: string;
  failureType?: string | null;
  documentId?: string;
  versionCreated?: boolean;
};

function summarizeSyncItems(items: SyncItem[]) {
  return {
    total: items.length,
    completed: items.filter((item) => item.status === 'completed').length,
    failed: items.filter((item) => item.status === 'failed').length,
    remaining: items.filter((item) => item.status === 'pending').length,
  };
}

function mergeSyncItems(previous: SyncItem[], incoming: SyncItem[]) {
  const merged = new Map(previous.map((item) => [item.externalId, item]));
  for (const item of incoming) {
    if (item.externalId) merged.set(item.externalId, item);
  }
  return [...merged.values()];
}

async function waitForSync(jobId: string) {
  while (activeSync?.jobId === jobId && activeSync.state === 'paused') await new Promise((resolve) => setTimeout(resolve, 100));
  return activeSync?.jobId === jobId && activeSync.state === 'running';
}

async function recordSyncRequest(jobId: string, kind: string) {
  if (!knowledgeDatabase || activeSync?.jobId !== jobId) return;
  const at = Date.now();
  const delayMs = activeSync.lastRequestAt == null ? null : Math.max(0, at - activeSync.lastRequestAt);
  activeSync.lastRequestAt = at;
  knowledgeDatabase.recordSyncRequest(jobId, { kind, at: new Date(at).toISOString(), delayMs });
}

async function importSyncItem(jobId: string, sourceId: string, item: SyncItem, position: number, window: BrowserWindow) {
  if (!knowledgeDatabase) return { ok: false, failureType: FAILURE_TYPES.HTTP_ERROR };
  if (item.status !== 'ok' || !item.url) {
    knowledgeDatabase.recordImportError({
      source: 'zhihu',
      externalId: item.url ?? `collection-item:${item.externalId}`,
      url: item.url,
      body: '',
      importError: item.failureType ?? (item.status === 'ok' ? FAILURE_TYPES.UNAVAILABLE : item.status),
      fetchedAt: new Date().toISOString(),
    });
    return { ok: false, failureType: item.failureType ?? (item.status === 'ok' ? FAILURE_TYPES.UNAVAILABLE : item.status) };
  }

  const result = await importUrl(item.url, {
    fetchHtml: async (targetUrl) => {
      if (!(await waitForSync(jobId))) return { status: 499, body: '', fetchedAt: new Date().toISOString() };
      await recordSyncRequest(jobId, 'document');
      return fetchHtmlInRemoteSession(window.webContents, targetUrl);
    },
  });
  if (result.ok && result.document) {
    const write = knowledgeDatabase.upsertDocument(result.document);
    knowledgeDatabase.linkCollectionDocument(sourceId, write.documentId, position);
    return { ok: true, documentId: write.documentId, versionCreated: write.versionCreated };
  }

  if (result.source && result.externalId) {
    knowledgeDatabase.recordImportError({
      source: result.source,
      externalId: result.externalId,
      url: result.url ?? item.url,
      body: '',
      importError: result.status,
      fetchedAt: new Date().toISOString(),
    });
  }
  return { ok: false, failureType: result.status };
}

async function executeSyncJob(jobId: string, sourceUrl: string, retryExternalId: string | null = null) {
  if (!knowledgeDatabase || activeSync) return;
  const job = knowledgeDatabase.getSyncJob(jobId);
  const target = sourceTarget(sourceUrl || String((job.payload.source as { url?: string } | undefined)?.url ?? ''));
  const source = knowledgeDatabase.upsertCollection({
    source: target.source,
    externalId: target.id,
    name: target.kind === 'collection' ? `知乎收藏夹 ${target.id}` : target.kind === 'column' ? `知乎专栏 ${target.id}` : `知乎赞同 ${target.id}`,
  });
  const retryItem = retryExternalId
    ? (job.payload.items as SyncItem[] | undefined)?.find((item) => item.externalId === retryExternalId)
    : null;
  if (retryExternalId && !retryItem) throw new Error('sync item not found');

  activeSync = { jobId, state: 'running', lastRequestAt: null };
  collectionCaptureInProgress = true;
  collectionCaptureStopRequested = false;
  try {
    knowledgeDatabase.updateSyncJob(jobId, { status: 'running', lastError: null, incrementAttempts: true });
    const remote = createRemoteWindow(target.pageUrl);
    await loadRemotePage(remote, target.pageUrl);
    const controls = {
      waitUntilReady: () => waitForSync(jobId),
      isStopped: () => activeSync?.state === 'cancelled',
      onRequest: ({ kind }: { kind: string }) => recordSyncRequest(jobId, kind),
    };
    const result = await runCollectionSync({
      capture: retryItem
        ? async () => ({ ok: true, sourceType: target.kind, sourceId: target.id, itemCount: 1, pageCount: 0, items: [retryItem] })
        : (hooks) => (target.kind === 'collection' ? captureCollection : captureSource)(sourceUrl, {
          fetchJson: (targetUrl: string) => fetchJsonInRemoteSession(remote.webContents, targetUrl),
          ...hooks,
        }),
      fetchDocument: (rawItem, position: number) => importSyncItem(jobId, source.collectionId, rawItem as unknown as SyncItem, position, remote),
      controls,
      onProgress: ({ items, progress, phase, currentExternalId }) => {
        const current = knowledgeDatabase?.getSyncJob(jobId);
        const merged = mergeSyncItems((current?.payload.items as SyncItem[] | undefined) ?? [], items as SyncItem[]);
        knowledgeDatabase?.updateSyncJob(jobId, {
          payloadPatch: {
            items: merged,
            progress: summarizeSyncItems(merged),
            phase,
            currentExternalId: currentExternalId ?? null,
          },
        });
      },
    });
    const current = knowledgeDatabase.getSyncJob(jobId);
    const merged = mergeSyncItems((current.payload.items as SyncItem[] | undefined) ?? [], result.items as SyncItem[]);
    const finalStatus = result.status === SYNC_STATUS.COMPLETED
      ? SYNC_STATUS.COMPLETED
      : result.status === SYNC_STATUS.CANCELLED ? SYNC_STATUS.CANCELLED : SYNC_STATUS.STOPPED;
    knowledgeDatabase.updateSyncJob(jobId, {
      status: finalStatus,
      lastError: result.failureType ?? null,
      payloadPatch: {
        items: merged,
        progress: summarizeSyncItems(merged),
        phase: 'finished',
        failureType: result.failureType ?? null,
        currentExternalId: null,
      },
    });
  } catch (error) {
    log('zhihu-sync-failed', { code: error instanceof Error && 'code' in error ? error.code : 'SYNC_FAILED' });
    knowledgeDatabase.updateSyncJob(jobId, { status: 'failed', lastError: 'sync_failed', payloadPatch: { phase: 'finished', failureType: FAILURE_TYPES.HTTP_ERROR } });
  } finally {
    collectionCaptureInProgress = false;
    collectionCaptureStopRequested = false;
    if (activeSync?.jobId === jobId) activeSync = null;
  }
}

async function captureSample(url: string) {
  if (collectionCaptureInProgress || activeSync) throw new Error('collection capture already running');
  collectionCaptureInProgress = true;
  collectionCaptureStopRequested = false;
  try {
    return await captureWithRemoteSession(url, {
      isStopped: () => collectionCaptureStopRequested,
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
    return await captureSample(typeof url === 'string' ? url : '');
  } catch (error) {
    log('zhihu-capture-failed', { code: error instanceof Error && 'code' in error ? error.code : 'CAPTURE_FAILED' });
    return { ok: false, collectionId: '', itemCount: 0, pageCount: 0, items: [], failureType: FAILURE_TYPES.HTTP_ERROR };
  }
});

ipcMain.handle('zhihu:stop-capture', (event) => {
  assertTrustedLocalSender(event.sender);
  if (activeSync) {
    activeSync.state = 'cancelled';
    return { ok: true };
  }
  collectionCaptureStopRequested = true;
  return { ok: collectionCaptureInProgress };
});

ipcMain.handle('zhihu:sync-start', (event, url?: unknown) => {
  assertTrustedLocalSender(event.sender);
  if (!knowledgeDatabase) return { ok: false, error: 'database_unavailable' };
  if (activeSync || collectionCaptureInProgress) return { ok: false, error: 'sync_already_running' };
  try {
    const target = sourceTarget(typeof url === 'string' ? url : '');
    const job = knowledgeDatabase.createSyncJob({ type: target.kind, source: target.source, externalId: target.id, url: target.pageUrl });
    void executeSyncJob(job.id, target.pageUrl);
    return { ok: true, job: knowledgeDatabase.getSyncJob(job.id) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'sync_start_failed' };
  }
});

ipcMain.handle('zhihu:sync-status', (event, jobId?: unknown) => {
  assertTrustedLocalSender(event.sender);
  if (!knowledgeDatabase || typeof jobId !== 'string') return { ok: false, error: 'job_not_found' };
  try {
    return { ok: true, job: knowledgeDatabase.getSyncJob(jobId) };
  } catch {
    return { ok: false, error: 'job_not_found' };
  }
});

ipcMain.handle('zhihu:sync-pause', (event, jobId?: unknown) => {
  assertTrustedLocalSender(event.sender);
  if (!knowledgeDatabase || typeof jobId !== 'string' || activeSync?.jobId !== jobId) return { ok: false, error: 'job_not_running' };
  activeSync.state = 'paused';
  return { ok: true, job: knowledgeDatabase.updateSyncJob(jobId, { status: 'paused' }) };
});

ipcMain.handle('zhihu:sync-resume', (event, jobId?: unknown) => {
  assertTrustedLocalSender(event.sender);
  if (!knowledgeDatabase || typeof jobId !== 'string') return { ok: false, error: 'job_not_found' };
  try {
    const job = knowledgeDatabase.getSyncJob(jobId);
    if (activeSync?.jobId === jobId && activeSync.state === 'paused') {
      activeSync.state = 'running';
      return { ok: true, job: knowledgeDatabase.updateSyncJob(jobId, { status: 'running' }) };
    }
    if (activeSync) return { ok: false, error: 'sync_already_running' };
    if (job.status !== 'paused') return { ok: false, error: 'job_not_paused' };
    const sourceUrl = String((job.payload.source as { url?: string } | undefined)?.url ?? '');
    void executeSyncJob(jobId, sourceUrl);
    return { ok: true, job: knowledgeDatabase.getSyncJob(jobId) };
  } catch {
    return { ok: false, error: 'sync_resume_failed' };
  }
});

ipcMain.handle('zhihu:sync-cancel', (event, jobId?: unknown) => {
  assertTrustedLocalSender(event.sender);
  if (!knowledgeDatabase || typeof jobId !== 'string') return { ok: false, error: 'job_not_found' };
  try {
    if (activeSync?.jobId === jobId) {
      activeSync.state = 'cancelled';
      return { ok: true, job: knowledgeDatabase.getSyncJob(jobId) };
    }
    return { ok: true, job: knowledgeDatabase.updateSyncJob(jobId, { status: 'cancelled', lastError: FAILURE_TYPES.STOPPED }) };
  } catch {
    return { ok: false, error: 'job_not_found' };
  }
});

ipcMain.handle('zhihu:sync-retry-item', (event, input?: { jobId?: unknown; externalId?: unknown }) => {
  assertTrustedLocalSender(event.sender);
  if (!knowledgeDatabase || typeof input?.jobId !== 'string' || typeof input.externalId !== 'string' || activeSync) return { ok: false, error: 'retry_unavailable' };
  try {
    const job = knowledgeDatabase.getSyncJob(input.jobId);
    const items = (job.payload.items as SyncItem[] | undefined) ?? [];
    const item = items.find((candidate) => candidate.externalId === input.externalId);
    if (!item || item.status !== 'failed') return { ok: false, error: 'item_not_failed' };
    const pending = items.map((candidate) => candidate.externalId === item.externalId ? { ...candidate, status: 'pending', failureType: null } : candidate);
    const queued = knowledgeDatabase.updateSyncJob(input.jobId, { status: 'queued', lastError: null, payloadPatch: { items: pending, progress: summarizeSyncItems(pending), failureType: null } });
    const sourceUrl = String((job.payload.source as { url?: string } | undefined)?.url ?? '');
    void executeSyncJob(input.jobId, sourceUrl, item.externalId);
    return { ok: true, job: queued };
  } catch {
    return { ok: false, error: 'retry_failed' };
  }
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

function readerDatabaseError(operation: string, error: unknown) {
  log(operation, { code: error instanceof Error && 'code' in error ? error.code : 'DATABASE_ERROR' });
  return { ok: false, error: error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'database_error' };
}

ipcMain.handle('reader:bootstrap', (event, options?: ReaderListOptions) => {
  assertTrustedLocalSender(event.sender);
  if (!knowledgeDatabase) return { ok: false, error: 'database_unavailable' };
  try {
    return {
      ok: true,
      documents: knowledgeDatabase.listDocuments(options ?? {}),
      tags: knowledgeDatabase.listTags(),
      session: knowledgeDatabase.getReaderSession(),
    };
  } catch (error) {
    return readerDatabaseError('reader-bootstrap-failed', error);
  }
});

ipcMain.handle('reader:get-document', (event, documentId?: unknown, versionId?: unknown) => {
  assertTrustedLocalSender(event.sender);
  if (!knowledgeDatabase) return { ok: false, error: 'database_unavailable' };
  try {
    const document = knowledgeDatabase.getDocument(typeof documentId === 'string' ? documentId : '', typeof versionId === 'string' ? versionId : null);
    if (document && typeof document === 'object' && 'id' in document) {
      (document as Record<string, unknown>).versions = knowledgeDatabase.listDocumentVersions(document.id as string);
    }
    return document ? { ok: true, document } : { ok: false, error: 'document_not_found' };
  } catch (error) {
    return readerDatabaseError('reader-document-failed', error);
  }
});

function objectInput(value: unknown) {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

ipcMain.handle('annotation:create-highlight', (event, input?: unknown) => {
  assertTrustedLocalSender(event.sender);
  if (!knowledgeDatabase) return { ok: false, error: 'database_unavailable' };
  try { return { ok: true, highlight: knowledgeDatabase.addHighlight(objectInput(input) as Parameters<KnowledgeDatabase['addHighlight']>[0]) }; } catch (error) { return readerDatabaseError('highlight-create-failed', error); }
});

ipcMain.handle('annotation:update-highlight', (event, id?: unknown, input?: unknown) => {
  assertTrustedLocalSender(event.sender);
  if (!knowledgeDatabase) return { ok: false, error: 'database_unavailable' };
  try { return { ok: true, highlight: knowledgeDatabase.updateHighlight(typeof id === 'string' ? id : '', objectInput(input)) }; } catch (error) { return readerDatabaseError('highlight-update-failed', error); }
});

ipcMain.handle('annotation:delete-highlight', (event, id?: unknown) => {
  assertTrustedLocalSender(event.sender);
  if (!knowledgeDatabase) return { ok: false, error: 'database_unavailable' };
  try { return { ok: true, ...knowledgeDatabase.deleteHighlight(typeof id === 'string' ? id : '') }; } catch (error) { return readerDatabaseError('highlight-delete-failed', error); }
});

ipcMain.handle('annotation:create-note', (event, input?: unknown) => {
  assertTrustedLocalSender(event.sender);
  if (!knowledgeDatabase) return { ok: false, error: 'database_unavailable' };
  try { return { ok: true, note: knowledgeDatabase.addNote(objectInput(input) as Parameters<KnowledgeDatabase['addNote']>[0]) }; } catch (error) { return readerDatabaseError('note-create-failed', error); }
});

ipcMain.handle('annotation:update-note', (event, id?: unknown, input?: unknown) => {
  assertTrustedLocalSender(event.sender);
  if (!knowledgeDatabase) return { ok: false, error: 'database_unavailable' };
  try { return { ok: true, note: knowledgeDatabase.updateNote(typeof id === 'string' ? id : '', objectInput(input)) }; } catch (error) { return readerDatabaseError('note-update-failed', error); }
});

ipcMain.handle('annotation:delete-note', (event, id?: unknown) => {
  assertTrustedLocalSender(event.sender);
  if (!knowledgeDatabase) return { ok: false, error: 'database_unavailable' };
  try { return { ok: true, ...knowledgeDatabase.deleteNote(typeof id === 'string' ? id : '') }; } catch (error) { return readerDatabaseError('note-delete-failed', error); }
});

ipcMain.handle('annotation:add-tag', (event, documentId?: unknown, name?: unknown) => {
  assertTrustedLocalSender(event.sender);
  if (!knowledgeDatabase) return { ok: false, error: 'database_unavailable' };
  try { return { ok: true, tag: knowledgeDatabase.addTag(typeof documentId === 'string' ? documentId : '', typeof name === 'string' ? name : '') }; } catch (error) { return readerDatabaseError('tag-create-failed', error); }
});

ipcMain.handle('annotation:remove-tag', (event, documentId?: unknown, tagId?: unknown) => {
  assertTrustedLocalSender(event.sender);
  if (!knowledgeDatabase) return { ok: false, error: 'database_unavailable' };
  try { return { ok: true, ...knowledgeDatabase.removeTag(typeof documentId === 'string' ? documentId : '', typeof tagId === 'string' ? tagId : '') }; } catch (error) { return readerDatabaseError('tag-delete-failed', error); }
});

ipcMain.handle('annotation:rename-tag', (event, tagId?: unknown, name?: unknown) => {
  assertTrustedLocalSender(event.sender);
  if (!knowledgeDatabase) return { ok: false, error: 'database_unavailable' };
  try { return { ok: true, tag: knowledgeDatabase.renameTag(typeof tagId === 'string' ? tagId : '', typeof name === 'string' ? name : '') }; } catch (error) { return readerDatabaseError('tag-update-failed', error); }
});

ipcMain.handle('reader:save-state', (event, input?: unknown) => {
  assertTrustedLocalSender(event.sender);
  if (!knowledgeDatabase) return { ok: false, error: 'database_unavailable' };
  try {
    return { ok: true, state: knowledgeDatabase.saveReadingState(input && typeof input === 'object' ? input as { documentId: string; status?: string; favorite?: boolean; knowledgeLevel?: string; scrollTop?: number } : { documentId: '' }) };
  } catch (error) {
    return readerDatabaseError('reader-state-save-failed', error);
  }
});

ipcMain.handle('reader:save-session', (event, selectedDocumentId?: unknown) => {
  assertTrustedLocalSender(event.sender);
  if (!knowledgeDatabase) return { ok: false, error: 'database_unavailable' };
  try {
    return { ok: true, session: knowledgeDatabase.saveReaderSession(typeof selectedDocumentId === 'string' ? selectedDocumentId : null) };
  } catch (error) {
    return readerDatabaseError('reader-session-save-failed', error);
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
