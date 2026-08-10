/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

import { app, BrowserWindow, ipcMain, session } from 'electron';
import path from 'node:path';
import { isAllowedZhihuUrl, isLocalUiUrl, sanitizeForLog } from './security.mjs';

const ZHIHU_PARTITION = 'persist:zhihu-m0';
const smokeMode = process.env.KNOWLEDGE_SMOKE === '1' || process.argv.includes('--smoke');
let mainWindow: BrowserWindow | null = null;
let remoteWindow: BrowserWindow | null = null;

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

function createRemoteWindow(url = 'https://www.zhihu.com/') {
  if (!isAllowedZhihuUrl(url)) throw new Error('unsupported remote url');
  if (remoteWindow && !remoteWindow.isDestroyed()) {
    remoteWindow.focus();
    return;
  }

  configureZhihuSession();
  remoteWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    title: '知乎登录与内容窗口',
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

ipcMain.handle('app:ping', (event) => {
  assertTrustedLocalSender(event.sender);
  return { ok: true };
});

ipcMain.handle('zhihu:open', (event, url?: unknown) => {
  assertTrustedLocalSender(event.sender);
  const target = url === undefined ? 'https://www.zhihu.com/' : url;
  if (typeof target !== 'string' || !isAllowedZhihuUrl(target)) throw new Error('unsupported remote url');
  createRemoteWindow(target);
  return { ok: true, partition: ZHIHU_PARTITION };
});

ipcMain.handle('zhihu:session-summary', async (event) => {
  assertTrustedLocalSender(event.sender);
  const cookies = await session.fromPartition(ZHIHU_PARTITION).cookies.get({ domain: 'zhihu.com' });
  return { partition: ZHIHU_PARTITION, cookieCount: cookies.length };
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
  configureZhihuSession();
  createMainWindow();
});
app.on('before-quit', () => log('shutdown'));
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });
app.on('render-process-gone', (_event, _webContents, details) => log('render-process-gone', { reason: details.reason }));
process.on('uncaughtException', (error) => log('uncaught-exception', { error }));
