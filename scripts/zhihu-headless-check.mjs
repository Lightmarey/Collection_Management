import { app, BrowserWindow, session } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runtimeDataRoot } from '../src/portable-paths.mjs';
import { importUrl } from '../src/document-import.mjs';
import { captureCollection } from '../src/zhihu-capture.mjs';
import { signZhihuRequest } from '../src/zhihu-signature.mjs';
import { openKnowledgeDatabase } from '../src/database.mjs';
import { matchesSyncItemHash, runCollectionSync, syncItemHash } from '../src/zhihu-sync.mjs';

const url = process.argv.slice(2).find((value) => value.startsWith('https://'))
  ?? process.env.ZHIHU_TEST_SOURCE_URL;
if (!url) throw new Error('pass a Zhihu collection URL or set ZHIHU_TEST_SOURCE_URL');
const partition = 'persist:zhihu-m0';
const timeoutMs = 15000;
const verifyIncremental = process.argv.includes('--verify-incremental');
let stage = 'startup';

app.setPath('userData', runtimeDataRoot({ isPackaged: app.isPackaged, execPath: process.execPath, appPath: app.getAppPath(), appDataPath: app.getPath('appData'), override: process.env.KNOWLEDGE_DATA_DIR, portable: process.env.KNOWLEDGE_PORTABLE }));

function timeout(value) {
  return Promise.race([
    value,
    new Promise((resolve) => setTimeout(() => resolve({ status: 599, payload: null, marker: 'http_error' }), timeoutMs)),
  ]);
}

async function main() {
  await app.whenReady();
  stage = 'session';
  const zhihuSession = session.fromPartition(partition);
  const dC0 = (await zhihuSession.cookies.get({ url: 'https://www.zhihu.com/', name: 'd_c0' })).find((cookie) => cookie.name === 'd_c0')?.value;
  if (!dC0) throw new Error('missing session credential');
  const window = new BrowserWindow({
    show: false,
    webPreferences: { partition, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await timeout(window.loadURL(url));
  stage = 'capture';

  const fetchJson = async (target, include = '') => {
    const requestUrl = new URL(target);
    if (include) requestUrl.searchParams.set('include', include);
    const headers = signZhihuRequest(requestUrl.href, dC0);
    return timeout(window.webContents.executeJavaScript(`
      fetch(${JSON.stringify(requestUrl.href)}, { credentials: 'include', headers: ${JSON.stringify({ Accept: 'application/json', ...headers })} }).then(async (response) => {
        let payload = null;
        try { payload = await response.json(); } catch {}
        return { status: response.status, payload, marker: response.ok ? 'none' : 'http_error', fetchedAt: new Date().toISOString() };
      })
    `, true));
  };

  const authenticated = await timeout(window.webContents.executeJavaScript(`fetch('https://www.zhihu.com/api/v4/me', { credentials: 'include' }).then(async (response) => ({ status: response.status, payload: await response.json().catch(() => null) }))`, true));
  const captured = await captureCollection(url, { fetchJson });
  stage = 'details';
  const answerItem = captured.items.find((item) => item.kind === 'answer' && item.url);
  const articleItem = captured.items.find((item) => item.kind === 'article' && item.url);
  const answer = answerItem ? await importUrl(answerItem.url, { fetchJson }) : null;
  if (answerItem && articleItem) await new Promise((resolve) => setTimeout(resolve, 1200));
  const article = articleItem ? await importUrl(articleItem.url, { fetchJson }) : null;
  const imageUrl = [answer, article]
    .flatMap((result) => result?.document?.mediaRefs ?? [])
    .find((media) => media.type === 'img' && typeof media.url === 'string' && media.url.startsWith('https://'))?.url;
  let imageDownloaded = null;
  if (imageUrl) {
    const imageResponse = await timeout(zhihuSession.fetch(imageUrl, {
      credentials: 'include',
      headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,*/*;q=0.8', referer: 'https://www.zhihu.com/' },
    }));
    imageDownloaded = imageResponse?.ok === true && imageResponse.headers?.get('content-type')?.startsWith('image/') === true
      && (await imageResponse.arrayBuffer()).byteLength > 0;
  }
  let secondSync = null;
  if (verifyIncremental) {
    stage = 'incremental';
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-zhihu-incremental-'));
    const database = openKnowledgeDatabase(path.join(temporaryDirectory, 'knowledge.sqlite'), { startupBackup: false });
    const collection = database.upsertCollection({ source: 'zhihu:collection', externalId: new URL(url).pathname.split('/').filter(Boolean).at(-1), name: 'incremental-check' });
    captured.items.forEach((item, index) => {
      const document = database.upsertDocument({ source: 'zhihu', externalId: item.url, url: item.url, title: 'incremental-check', body: '<p>stored</p>' });
      database.linkCollectionDocument(collection.collectionId, document.documentId, index, syncItemHash(item));
    });
    const capturedAgain = await captureCollection(url, { fetchJson });
    let detailRequests = 0;
    const result = await runCollectionSync({
      capture: async () => capturedAgain,
      shouldFetchItem: async (item) => !matchesSyncItemHash(database.getCollectionItemSyncHash(collection.collectionId, String(item.url ?? item.externalId ?? '')), item),
      fetchDocument: async () => { detailRequests += 1; return { ok: true }; },
    });
    secondSync = { skipped: result.progress.skipped, detailRequests };
    database.close();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
  const summary = {
    ok: captured.ok && authenticated.status === 200 && answer?.ok === true && article?.ok === true && (!imageUrl || imageDownloaded === true)
      && (!verifyIncremental || (secondSync?.skipped === captured.itemCount && secondSync.detailRequests === 0)),
    authenticated: authenticated.status === 200,
    itemCount: captured.itemCount,
    pageCount: captured.pageCount,
    answerDownloaded: answer?.ok === true,
    articleDownloaded: article?.ok === true,
    imageDownloaded,
    secondSync,
  };
  console.log(JSON.stringify(summary));
  window.destroy();
  app.exit(summary.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, failureType: 'http_error', stage, code: error?.code ?? error?.name ?? 'unknown' }));
  app.exit(1);
});
