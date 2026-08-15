import { contextBridge, ipcRenderer } from "electron";
import type { DesktopApi } from "./contracts/desktop";

const desktop: DesktopApi = {
  getAppInfo: () => ipcRenderer.invoke("app:info"),
  exportDiagnosticLogs: () => ipcRenderer.invoke("app:export-logs"),
  openDataDirectory: () => ipcRenderer.invoke("app:open-data-directory"),
  copyDiagnosticInfo: () => ipcRenderer.invoke("app:copy-diagnostics"),
  checkForUpdates: () => ipcRenderer.invoke("app:check-update"),
  openUpdatePage: (url) => ipcRenderer.invoke("app:open-update", url),
  openProjectPage: () => ipcRenderer.invoke("app:open-project"),
  createDataBackup: () => ipcRenderer.invoke("backup:create"),
  restoreDataBackup: () => ipcRenderer.invoke("backup:restore"),
  minimizeAppWindow: () => ipcRenderer.invoke("app:window-minimize"),
  toggleMaximizeAppWindow: () =>
    ipcRenderer.invoke("app:window-toggle-maximize"),
  closeAppWindow: () => ipcRenderer.invoke("app:window-close"),
  ping: () => ipcRenderer.invoke("app:ping"),
  loginZhihu: () => ipcRenderer.invoke("zhihu:login"),
  openZhihuUrl: (url) => ipcRenderer.invoke("zhihu:open-url", url),
  zhihuSessionSummary: () => ipcRenderer.invoke("zhihu:session-summary"),
  captureZhihuCollection: (url) =>
    ipcRenderer.invoke("zhihu:capture-collection", url),
  stopZhihuCapture: () => ipcRenderer.invoke("zhihu:stop-capture"),
  startZhihuSync: (url, mode = "incremental") =>
    ipcRenderer.invoke("zhihu:sync-start", url, mode),
  syncZhihuDocument: (url) => ipcRenderer.invoke("document:import-url", url),
  getZhihuSyncStatus: (jobId) => ipcRenderer.invoke("zhihu:sync-status", jobId),
  pauseZhihuSync: (jobId) => ipcRenderer.invoke("zhihu:sync-pause", jobId),
  resumeZhihuSync: (jobId) => ipcRenderer.invoke("zhihu:sync-resume", jobId),
  cancelZhihuSync: (jobId) => ipcRenderer.invoke("zhihu:sync-cancel", jobId),
  retryZhihuSyncItem: (input) =>
    ipcRenderer.invoke("zhihu:sync-retry-item", input),
  importDocumentFile: (input) =>
    ipcRenderer.invoke("document:import-file", input),
  importDocumentUrl: (url) => ipcRenderer.invoke("document:import-url", url),
  listSources: () => ipcRenderer.invoke("source:list"),
  getSourceAccountState: (adapterId) =>
    ipcRenderer.invoke("source:account-state", adapterId),
  loginSource: (adapterId) => ipcRenderer.invoke("source:login", adapterId),
  discoverSources: (adapterId) =>
    ipcRenderer.invoke("source:discover", adapterId),
  resolvePublicSource: (adapterId, url) =>
    ipcRenderer.invoke("source:resolve-public", adapterId, url),
  startSourceSync: (input) => ipcRenderer.invoke("source:sync-start", input),
  getLatestSourceSync: () => ipcRenderer.invoke("source:sync-latest"),
  skipSourceRemoteCleanup: (jobId) =>
    ipcRenderer.invoke("source:sync-skip-remote-cleanup", jobId),
  removeDocumentSourceMemberships: (documentId) =>
    ipcRenderer.invoke("source:remove-document-memberships", documentId),
  readerBootstrap: (options = {}) =>
    ipcRenderer.invoke("reader:bootstrap", options),
  getReaderDocument: (documentId, versionId) =>
    ipcRenderer.invoke("reader:get-document", documentId, versionId),
  saveReadingState: (input) => ipcRenderer.invoke("reader:save-state", input),
  updateDocumentProperties: (input) =>
    ipcRenderer.invoke("reader:update-properties", input),
  saveReaderSession: (selectedDocumentId) =>
    ipcRenderer.invoke("reader:save-session", selectedDocumentId),
  listReaderAnnotations: (input = {}) =>
    ipcRenderer.invoke("reader:list-annotations", input),
  createHighlight: (input) =>
    ipcRenderer.invoke("annotation:create-highlight", input),
  updateHighlight: (id, input) =>
    ipcRenderer.invoke("annotation:update-highlight", id, input),
  deleteHighlight: (id) =>
    ipcRenderer.invoke("annotation:delete-highlight", id),
  createNote: (input) => ipcRenderer.invoke("annotation:create-note", input),
  updateNote: (id, body) =>
    ipcRenderer.invoke("annotation:update-note", id, { body }),
  deleteNote: (id) => ipcRenderer.invoke("annotation:delete-note", id),
  addDocumentTag: (documentId, name) =>
    ipcRenderer.invoke("annotation:add-tag", documentId, name),
  updateDocumentTagMemberships: (input) =>
    ipcRenderer.invoke("annotation:update-tag-memberships", input),
  removeDocumentTag: (documentId, tagId) =>
    ipcRenderer.invoke("annotation:remove-tag", documentId, tagId),
  renameDocumentTag: (tagId, name) =>
    ipcRenderer.invoke("annotation:rename-tag", tagId, name),
  trashDocument: (documentId) => ipcRenderer.invoke("reader:trash", documentId),
  restoreDocument: (documentId) =>
    ipcRenderer.invoke("reader:restore", documentId),
  deleteDocumentPermanently: (documentId) =>
    ipcRenderer.invoke("reader:delete-permanently", documentId),
  emptyTrash: () => ipcRenderer.invoke("reader:empty-trash"),
  getReaderPreferences: () => ipcRenderer.invoke("reader:preferences"),
  saveReaderPreferences: (input) =>
    ipcRenderer.invoke("reader:save-preferences", input),
  importReaderFont: (input) => ipcRenderer.invoke("reader:import-font", input),
  smokeReady: (input) => ipcRenderer.invoke("app:smoke-ready", input),
};

contextBridge.exposeInMainWorld("desktop", desktop);
