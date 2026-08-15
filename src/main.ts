/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  protocol,
  shell,
} from "electron";
import path from "node:path";
import { openKnowledgeDatabase, type KnowledgeDatabase } from "./database.mjs";
import { isLocalUiUrl, sanitizeForLog } from "./security.mjs";
import { ZhihuSource } from "./sources/zhihu/zhihu-source";
import { SourceRegistry } from "./sources/source-registry";
import { SourceSyncCoordinator } from "./services/source-sync-coordinator";
import { ReaderService } from "./services/reader-service";
import { registerSourceIpc } from "./transports/electron/register-source-ipc";
import { registerReaderIpc } from "./transports/electron/register-reader-ipc";
import { LocalMediaStore } from "./adapters/local-media-store";
import { runtimeDataRoot } from "./portable-paths.mjs";
import { DataBackupService } from "./services/data-backup-service";
import { registerBackupIpc } from "./transports/electron/register-backup-ipc";
import { appendAppLog, exportAppLogs } from "./app-log.mjs";

const smokeMode =
  process.env.KNOWLEDGE_SMOKE === "1" || process.argv.includes("--smoke");
const dataRoot = runtimeDataRoot({
  isPackaged: app.isPackaged,
  execPath: process.execPath,
  appPath: app.getAppPath(),
  appDataPath: app.getPath("appData"),
  override: process.env.KNOWLEDGE_DATA_DIR,
  portable: process.env.KNOWLEDGE_PORTABLE,
});
let mainWindow: BrowserWindow | null = null;
let database: KnowledgeDatabase | null = null;
let databaseStartupError = "database_unavailable";
const logDirectory = path.join(dataRoot, "logs");

app.setPath("userData", dataRoot);
protocol.registerSchemesAsPrivileged([
  {
    scheme: "km-media",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

function log(event: string, details: Record<string, unknown> = {}) {
  const entry = sanitizeForLog({
    at: new Date().toISOString(),
    event,
    ...details,
  }) as Record<string, unknown>;
  console.log(JSON.stringify(entry));
  try {
    appendAppLog(logDirectory, entry);
  } catch {
    console.error("Application log could not be written");
  }
}

function distributionMode() {
  if (!app.isPackaged) return "development";
  return path.resolve(dataRoot) ===
    path.resolve(path.dirname(process.execPath), "data")
    ? "portable"
    : "installed";
}

function diagnosticInfo() {
  return {
    version: app.getVersion(),
    distribution: distributionMode(),
    platform: `${process.platform}-${process.arch}`,
    database: database
      ? `ok (schema ${database.schemaVersion})`
      : databaseStartupError,
    dataPath: dataRoot,
  };
}

function diagnosticText() {
  const info = diagnosticInfo();
  return [
    `Innerse ${info.version}`,
    `模式：${info.distribution}`,
    `平台：${info.platform}`,
    `数据库：${info.database}`,
    `数据目录：${info.dataPath}`,
  ].join("\n");
}

function isTrusted(sender: Electron.WebContents) {
  return (
    sender === mainWindow?.webContents &&
    isLocalUiUrl(sender.getURL(), MAIN_WINDOW_VITE_DEV_SERVER_URL)
  );
}

function assertTrusted(sender: Electron.WebContents) {
  if (!isTrusted(sender)) throw new Error("untrusted ipc sender");
}

function applyThemePreference(theme: unknown) {
  nativeTheme.themeSource =
    theme === "light" || theme === "dark" ? theme : "system";
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    height: 860,
    minWidth: 900,
    minHeight: 640,
    width: 1360,
    title: "Innerse",
    frame: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#242629" : "#ffffff",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const contents = mainWindow.webContents;
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event, url) => {
    if (!isLocalUiUrl(url, MAIN_WINDOW_VITE_DEV_SERVER_URL))
      event.preventDefault();
  });
  contents.on("will-redirect", (event, url) => {
    if (!isLocalUiUrl(url, MAIN_WINDOW_VITE_DEV_SERVER_URL))
      event.preventDefault();
  });
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(
      `${MAIN_WINDOW_VITE_DEV_SERVER_URL}${smokeMode ? "?smoke=1" : ""}`,
    );
  } else {
    void mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
      { query: smokeMode ? { smoke: "1" } : undefined },
    );
  }
  contents.on("did-finish-load", () => log("ui-loaded"));
  contents.on("did-fail-load", (_event, errorCode, errorDescription) =>
    log("ui-load-failed", { errorCode, errorDescription }),
  );
  contents.on("console-message", (event) => {
    if (
      event.level === "error" &&
      !/Content Security Policy directive/.test(event.message)
    )
      log("ui-console-error", { message: event.message });
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function registerAppIpc() {
  ipcMain.handle("app:info", (event) => {
    assertTrusted(event.sender);
    return {
      ok: true,
      version: app.getVersion(),
      packaged: app.isPackaged,
      updateConfigured: true,
      distribution: distributionMode(),
      dataPath: dataRoot,
      database: database
        ? { ok: true, schemaVersion: database.schemaVersion }
        : { ok: false, error: databaseStartupError },
    };
  });
  ipcMain.handle("app:export-logs", async (event) => {
    assertTrusted(event.sender);
    if (!mainWindow) return { ok: false, error: "window_unavailable" };
    const selected = await dialog.showSaveDialog(mainWindow, {
      title: "导出诊断日志",
      defaultPath: path.join(
        app.getPath("documents"),
        `innerse-diagnostics-${new Date().toISOString().slice(0, 10)}.jsonl`,
      ),
      filters: [{ name: "JSON Lines", extensions: ["jsonl"] }],
    });
    if (selected.canceled || !selected.filePath)
      return { ok: true, cancelled: true };
    try {
      const result = exportAppLogs(
        logDirectory,
        selected.filePath,
        sanitizeForLog({ at: new Date().toISOString(), ...diagnosticInfo() }) as Record<string, unknown>,
      );
      log("diagnostic-log-exported", { files: result.files });
      return { ok: true, ...result };
    } catch {
      log("diagnostic-log-export-failed");
      return { ok: false, error: "log_export_failed" };
    }
  });
  ipcMain.handle("app:open-data-directory", async (event) => {
    assertTrusted(event.sender);
    const error = await shell.openPath(dataRoot);
    return error ? { ok: false, error: "open_data_directory_failed" } : { ok: true };
  });
  ipcMain.handle("app:copy-diagnostics", (event) => {
    assertTrusted(event.sender);
    clipboard.writeText(diagnosticText());
    return { ok: true };
  });
  ipcMain.handle("app:check-update", async (event) => {
    assertTrusted(event.sender);
    try {
      const response = await fetch(
        "https://api.github.com/repos/Lightmarey/Collection_Management/releases/latest",
        {
          headers: { Accept: "application/vnd.github+json" },
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!response.ok) return { ok: false, error: "update_request_failed" };
      const release = (await response.json()) as {
        tag_name?: unknown;
        html_url?: unknown;
      };
      const latestVersion =
        typeof release.tag_name === "string"
          ? release.tag_name.replace(/^v/i, "")
          : "";
      if (!/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(latestVersion))
        return { ok: false, error: "update_manifest_invalid" };
      const currentVersion = app.getVersion();
      const parts = (value: string) =>
        value.split(/[.+-]/, 3).map((part) => Number(part) || 0);
      const current = parts(currentVersion);
      const latest = parts(latestVersion);
      const updateAvailable = latest.some(
        (part, index) =>
          part > current[index] &&
          latest.slice(0, index).every((value, i) => value === current[i]),
      );
      return {
        ok: true,
        currentVersion,
        latestVersion,
        updateAvailable,
        downloadUrl:
          typeof release.html_url === "string" ? release.html_url : null,
      };
    } catch {
      return { ok: false, error: "update_request_failed" };
    }
  });
  ipcMain.handle("app:open-update", async (event, url: unknown) => {
    assertTrusted(event.sender);
    if (
      typeof url !== "string" ||
      !/^https:\/\/github\.com\/Lightmarey\/Collection_Management\/releases\//i.test(url)
    )
      return { ok: false, error: "update_url_invalid" };
    await shell.openExternal(url);
    return { ok: true };
  });
  ipcMain.handle("app:open-project", async (event) => {
    assertTrusted(event.sender);
    await shell.openExternal("https://github.com/Lightmarey/Collection_Management");
    return { ok: true };
  });
  ipcMain.handle("app:window-minimize", (event) => {
    assertTrusted(event.sender);
    BrowserWindow.fromWebContents(event.sender)?.minimize();
    return { ok: true };
  });
  ipcMain.handle("app:window-toggle-maximize", (event) => {
    assertTrusted(event.sender);
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window?.isMaximized()) window.unmaximize();
    else window?.maximize();
    return { ok: true, maximized: Boolean(window?.isMaximized()) };
  });
  ipcMain.handle("app:window-close", (event) => {
    assertTrusted(event.sender);
    BrowserWindow.fromWebContents(event.sender)?.close();
    return { ok: true };
  });
  ipcMain.handle("app:ping", (event) => {
    assertTrusted(event.sender);
    return database
      ? {
          ok: true,
          database: { ok: true, schemaVersion: database.schemaVersion },
        }
      : { ok: true, database: { ok: false, error: databaseStartupError } };
  });
  ipcMain.handle(
    "app:smoke-ready",
    (event, input?: { readerLoaded?: unknown; hasDocuments?: unknown; windowControls?: unknown; collapsedTags?: unknown }) => {
      assertTrusted(event.sender);
      if (!smokeMode) return false;
      if (input?.windowControls !== true) {
        log("smoke-failed", { check: "window-controls" });
        return false;
      }
      if (input?.collapsedTags !== true) {
        log("smoke-failed", { check: "collapsed-tags" });
        return false;
      }
      const checks = ["startup", "ipc-ping"];
      if (input?.hasDocuments === true && input.readerLoaded === true)
        checks.push("reader-sqlite");
      if (input?.windowControls === true) checks.push("window-controls");
      if (input?.collapsedTags === true) checks.push("collapsed-tags");
      checks.push("close");
      log("smoke-passed", { checks });
      setTimeout(() => app.quit(), 25);
      return true;
    },
  );
}

function registerUnavailableReaderIpc() {
  for (const channel of [
    "reader:bootstrap",
    "reader:get-document",
    "reader:list-annotations",
    "reader:save-state",
    "reader:update-properties",
    "reader:save-session",
    "annotation:create-highlight",
    "annotation:update-highlight",
    "annotation:delete-highlight",
    "annotation:create-note",
    "annotation:update-note",
    "annotation:delete-note",
    "annotation:add-tag",
    "annotation:update-tag-memberships",
    "annotation:remove-tag",
    "annotation:rename-tag",
    "reader:trash",
    "reader:restore",
    "reader:delete-permanently",
    "reader:empty-trash",
    "reader:preferences",
    "reader:save-preferences",
    "reader:import-font",
  ])
    ipcMain.handle(channel, (event) => {
      assertTrusted(event.sender);
      return { ok: false, error: "database_unavailable" };
    });
}

app.enableSandbox();
app.on("ready", () => {
  log("startup");
  Menu.setApplicationMenu(null);
  try {
    database = openKnowledgeDatabase(
      path.join(app.getPath("userData"), "knowledge.sqlite"),
    );
  } catch (error) {
    databaseStartupError = "database_repair_required";
    log("database-startup-failed", {
      code:
        error instanceof Error && "code" in error
          ? error.code
          : "DATABASE_ERROR",
    });
  }
  const mediaStore = new LocalMediaStore(
    path.join(app.getPath("userData"), "media"),
  );
  registerBackupIpc({
    service: database
      ? new DataBackupService(
          database,
          app.getPath("userData"),
          path.join(app.getPath("userData"), "media"),
        )
      : null,
    getWindow: () => mainWindow,
    assertTrusted,
    log,
  });
  void protocol.handle("km-media", async (request) => {
    const media = await mediaStore.read(request.url);
    return media
      ? new Response(media.bytes as BodyInit, {
          headers: {
            "content-type": media.mimeType,
            "cache-control": "no-store",
          },
        })
      : new Response("Not found", { status: 404 });
  });
  const sources = new SourceRegistry([new ZhihuSource(mediaStore)]);
  const zhihu = sources.get("zhihu") as ZhihuSource;
  zhihu.configureSession();
  registerAppIpc();
  const sync = database ? new SourceSyncCoordinator(database, sources) : null;
  registerSourceIpc({ database, zhihu, sync, assertTrusted, log });
  if (database) {
    const reader = new ReaderService(database, mediaStore);
    applyThemePreference(reader.preferences().theme);
    registerReaderIpc({
      reader,
      assertTrusted,
      log,
      onPreferencesSaved: (preferences) =>
        applyThemePreference(preferences.theme),
    });
  } else registerUnavailableReaderIpc();
  createMainWindow();
});

app.on("before-quit", () => {
  database?.close();
  log("shutdown");
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});
app.on("render-process-gone", (_event, _contents, details) =>
  log("render-process-gone", { reason: details.reason }),
);
process.on("uncaughtException", (error) =>
  log("uncaught-exception", { error }),
);
