import { app, BrowserWindow, session } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { openKnowledgeDatabase } from "../src/database.mjs";
import { captureCollection } from "../src/zhihu-capture.mjs";
import { membershipRemovalRequest, zhihuContentId } from "../src/zhihu-m0.mjs";
import { signZhihuRequest } from "../src/zhihu-signature.mjs";

if (process.env.ZHIHU_DESTRUCTIVE_TEST !== "1") throw new Error("set ZHIHU_DESTRUCTIVE_TEST=1");

const partition = "persist:zhihu-m0";
const timeoutMs = 15_000;
let stage = "startup";

app.setPath("userData", process.env.KNOWLEDGE_DATA_DIR
  ? path.resolve(process.env.KNOWLEDGE_DATA_DIR)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".portable-data"));

async function main() {
  await app.whenReady();
  const database = openKnowledgeDatabase(path.join(app.getPath("userData"), "knowledge.sqlite"));
  const membership = database.db.prepare(`
    SELECT d.id AS documentId, d.external_id AS externalId, d.url,
      c.external_id AS collectionId
    FROM collection_items ci
    JOIN documents d ON d.id = ci.document_id
    JOIN collections c ON c.id = ci.collection_id
    ORDER BY ci.position
    LIMIT 1
  `).get();
  if (!membership) throw new Error("test membership not found");

  const kind = /zhuanlan\.zhihu\.com\/p\//.test(membership.url ?? "") ? "article" : "answer";
  const contentId = zhihuContentId({ externalId: membership.externalId, url: membership.url, kind });
  if (!contentId) throw new Error("test content id not found");
  const zhihuSession = session.fromPartition(partition);
  const dC0 = (await zhihuSession.cookies.get({ url: "https://www.zhihu.com/", name: "d_c0" }))[0]?.value;
  if (!dC0) throw new Error("missing session credential");
  const window = new BrowserWindow({ show: false, webPreferences: { partition, contextIsolation: true, nodeIntegration: false, sandbox: true } });
  await window.loadURL(`https://www.zhihu.com/collection/${membership.collectionId}`);

  stage = "remove";
  const request = membershipRemovalRequest(membership.collectionId, contentId, kind);
  const status = await window.webContents.executeJavaScript(`fetch(${JSON.stringify(request.url)}, {
    method: ${JSON.stringify(request.method)},
    credentials: 'include',
    headers: ${JSON.stringify({ Accept: "application/json", ...request.headers })},
    body: ${JSON.stringify(request.body)},
    signal: AbortSignal.timeout(${timeoutMs}),
  }).then((response) => response.status)`, true);
  if (status < 200 || status >= 300) throw new Error(`remove returned ${status}`);

  stage = "verify";
  const fetchJson = async (target) => {
    const headers = signZhihuRequest(target, dC0);
    return window.webContents.executeJavaScript(`fetch(${JSON.stringify(target)}, {
      credentials: 'include', headers: ${JSON.stringify({ Accept: "application/json", ...headers })}
    }).then(async (response) => ({ status: response.status, payload: await response.json().catch(() => null), marker: 'none', fetchedAt: new Date().toISOString() }))`, true);
  };
  const captured = await captureCollection(`https://www.zhihu.com/collection/${membership.collectionId}`, { fetchJson, wait: async () => {} });
  const remoteAbsent = captured.ok && !captured.items.some((item) => zhihuContentId(item) === contentId);
  if (!remoteAbsent) throw new Error("membership still present");
  const localRemoved = database.unlinkCollectionDocument("zhihu", membership.collectionId, membership.documentId) === 1;
  if (!localRemoved) throw new Error("local membership not removed");

  console.log(JSON.stringify({ ok: true, status, remoteAbsent, localRemoved }));
  database.close();
  window.destroy();
  app.exit(0);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, stage, code: error instanceof Error ? error.message : "unknown" }));
  app.exit(1);
});
