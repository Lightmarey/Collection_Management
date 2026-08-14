import { app, BrowserWindow, session } from 'electron';
import path from 'node:path';
import { runtimeDataRoot } from '../src/portable-paths.mjs';
import { signZhihuRequest } from '../src/zhihu-signature.mjs';

const partition = 'persist:zhihu-m0';
const timeoutMs = 30000;
const pageUrl = process.argv[2] ?? 'https://www.zhihu.com/collection/REDACTED_COLLECTION_ID';
let stage = 'startup';

app.setPath('userData', runtimeDataRoot({ isPackaged: app.isPackaged, execPath: process.execPath, appPath: app.getAppPath(), appDataPath: app.getPath('appData'), override: process.env.KNOWLEDGE_DATA_DIR, portable: process.env.KNOWLEDGE_PORTABLE }));

function header(headers, name) {
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  return match?.[1];
}

async function main() {
  await app.whenReady();
  stage = 'cookies';
  const zhihuSession = session.fromPartition(partition);
  const cookies = await zhihuSession.cookies.get({ url: 'https://www.zhihu.com/', name: 'd_c0' });
  const dC0 = cookies.find((cookie) => cookie.name === 'd_c0')?.value;
  if (!dC0) throw new Error('missing session credential');

  let targetRequestId = null;
  let finishTarget;
  let finishCompleted;
  const observed = new Promise((resolve) => { finishTarget = resolve; });
  const completed = new Promise((resolve) => { finishCompleted = resolve; });
  zhihuSession.webRequest.onBeforeSendHeaders({ urls: ['https://www.zhihu.com/api/v4/*'] }, (details, callback) => {
    const actual96 = header(details.requestHeaders, 'x-zse-96');
    if (targetRequestId == null && details.method === 'GET' && actual96) {
      targetRequestId = details.id;
      finishTarget({ url: details.url });
    }
    callback({ requestHeaders: details.requestHeaders });
  });
  zhihuSession.webRequest.onCompleted({ urls: ['https://www.zhihu.com/api/v4/*'] }, (details) => {
    if (details.id === targetRequestId) finishCompleted(details.statusCode);
  });

  const window = new BrowserWindow({
    show: false,
    webPreferences: { partition, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  stage = 'initial-load';
  await window.loadURL(pageUrl);
  stage = 'observe';
  const comparison = await Promise.race([
    Promise.all([observed, completed]),
    new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
  if (!comparison) throw new Error('no signed request observed');
  const [{ url }, officialStatus] = comparison;
  const headers = signZhihuRequest(url, dC0);
  const independentStatus = await window.webContents.executeJavaScript(`fetch(${JSON.stringify(url)}, { credentials: 'include', headers: ${JSON.stringify({ Accept: 'application/json', ...headers })} }).then((response) => response.status)`, true);
  const passed = officialStatus >= 200 && officialStatus < 300 && independentStatus === officialStatus;
  console.log(JSON.stringify({ ok: passed }));
  window.destroy();
  app.exit(passed === true ? 0 : 1);
}

main().catch(() => {
  console.error(JSON.stringify({ ok: false, stage }));
  app.exit(1);
});
