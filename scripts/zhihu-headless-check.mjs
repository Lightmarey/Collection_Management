import { app, BrowserWindow } from "electron";
import path from "node:path";
import { captureCollection } from "../src/zhihu-capture.mjs";

const url = process.argv[2] ?? "https://www.zhihu.com/collection/REDACTED_COLLECTION_ID";
const partition = "persist:zhihu-m0";
const timeoutMs = 15000;

app.setPath("userData", path.join(app.getPath("appData"), "knowledge-management"));

function timeout(value) {
  return Promise.race([
    value,
    new Promise((resolve) => setTimeout(() => resolve({ status: 599, payload: null, marker: "none" }), timeoutMs)),
  ]);
}

async function main() {
  await app.whenReady();
  const window = new BrowserWindow({
    show: false,
    webPreferences: { partition, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await timeout(window.loadURL(url));
  const result = await captureCollection(url, {
    fetchJson: async (target) => timeout(window.webContents.executeJavaScript(`
      (async () => {
        const response = await fetch(${JSON.stringify(target)}, { credentials: "include", headers: { Accept: "application/json" } });
        let payload = null;
        try { payload = await response.json(); } catch {}
        const source = payload && typeof payload === "object" ? JSON.stringify({ code: payload.code, message: payload.message, error: payload.error }) : "";
        const marker = /captcha|安全验证|人机验证/i.test(source) ? "captcha" : /付费|盐选|无权限|permission|forbidden/i.test(source) ? "unavailable" : "none";
        return { status: response.status, payload: response.ok ? payload : null, marker };
      })()
    `, true)),
  });
  console.log(JSON.stringify(result));
  window.destroy();
  app.exit(result.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, failureType: "http_error", error: error instanceof Error ? error.message : "headless check failed" }));
  app.exit(1);
});
