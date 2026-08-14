import { ipcMain } from "electron";
import { parseDocument, type ParsedDocument } from "../../document-import.mjs";
import type { DocumentImportResult, SyncMode } from "../../contracts/domain";
import type { ImportStore } from "../../ports/knowledge-store";
import { FAILURE_TYPES } from "../../zhihu-m0.mjs";
import { isAllowedZhihuUrl } from "../../security.mjs";
import { SourceSyncCoordinator } from "../../services/source-sync-coordinator";
import { ZhihuSource } from "../../sources/zhihu/zhihu-source";

type ImportResult = {
  ok: boolean;
  status: string;
  error?: string;
  source?: string;
  externalId?: string;
  url?: string;
  document?: ParsedDocument;
};

export function registerSourceIpc(options: {
  database: ImportStore | null;
  zhihu: ZhihuSource;
  sync: SourceSyncCoordinator | null;
  assertTrusted(sender: Electron.WebContents): void;
  log(event: string, details?: Record<string, unknown>): void;
}) {
  const { database, zhihu, sync, assertTrusted, log } = options;
  let captureBusy = false;

  ipcMain.handle("source:list", (event) => {
    assertTrusted(event.sender);
    return { ok: true, sources: [{ id: "zhihu", name: "知乎" }] };
  });

  ipcMain.handle("source:account-state", async (event, adapterId?: unknown) => {
    assertTrusted(event.sender);
    if (adapterId !== "zhihu") return { ok: false, error: "source_not_found" };
    return {
      ok: true,
      state: { adapterId: "zhihu", authenticated: await zhihu.verifySession() },
    };
  });

  ipcMain.handle("source:login", (event, adapterId?: unknown) => {
    assertTrusted(event.sender);
    if (adapterId !== "zhihu") return { ok: false, error: "source_not_found" };
    zhihu.openLogin();
    return { ok: true };
  });

  ipcMain.handle("source:discover", async (event, adapterId?: unknown) => {
    assertTrusted(event.sender);
    if (adapterId !== "zhihu") return { ok: false, error: "source_not_found" };
    try {
      const sources = await zhihu.discoverSources();
      return {
        ok: true,
        sources: sources.map((source) => ({
          adapterId: "zhihu",
          kind: source.kind,
          id: source.id,
          url: source.pageUrl,
          name: source.name,
          owned: source.owned,
          writable: source.writable,
          itemCount: source.itemCount,
        })),
      };
    } catch {
      return { ok: false, error: "source_discovery_failed" };
    }
  });

  ipcMain.handle(
    "source:resolve-public",
    (event, adapterId?: unknown, value?: unknown) => {
      assertTrusted(event.sender);
      if (
        adapterId !== "zhihu" ||
        typeof value !== "string" ||
        !/^https:\/\/www\.zhihu\.com\/(?:collection\/\d+|column\/[A-Za-z0-9_-]+)\/?(?:[?#].*)?$/.test(
          value,
        )
      )
        return { ok: false, error: "unsupported_public_source" };
      try {
        const source = zhihu.resolve(value);
        return {
          ok: true,
          source: {
            adapterId: "zhihu",
            kind: source.kind,
            id: source.id,
            url: source.pageUrl,
            name: source.name,
            owned: false,
            writable: false,
          },
        };
      } catch {
        return { ok: false, error: "unsupported_public_source" };
      }
    },
  );

  function persist(result: ImportResult): DocumentImportResult {
    if (!database)
      return {
        ok: false,
        status: "database_error",
        error: "database_unavailable",
      };
    try {
      if (result.ok && result.document) {
        const write = database.upsertDocument(result.document);
        return {
          ok: true,
          status: result.status,
          documentId: write.documentId,
          versionId: write.versionId,
          created: write.created,
          versionCreated: write.versionCreated,
          title: result.document.title,
        };
      }
      if (result.source && result.externalId) {
        const write = database.recordImportError({
          source: result.source,
          externalId: result.externalId,
          url: result.url ?? null,
          body: "",
          importError: result.status,
          fetchedAt: new Date().toISOString(),
        });
        return {
          ok: false,
          status: result.status,
          error: result.error ?? result.status,
          documentId: write.documentId,
        };
      }
      return {
        ok: false,
        status: result.status,
        error: result.error ?? result.status,
      };
    } catch (error) {
      log("document-import-failed", {
        code:
          error instanceof Error && "code" in error
            ? error.code
            : "DATABASE_ERROR",
      });
      return {
        ok: false,
        status: "database_error",
        error: "database_write_failed",
      };
    }
  }

  ipcMain.handle("zhihu:login", (event) => {
    assertTrusted(event.sender);
    zhihu.openLogin();
    return { ok: true, partition: zhihu.partition };
  });

  ipcMain.handle("zhihu:open-url", async (event, url?: unknown) => {
    assertTrusted(event.sender);
    if (typeof url !== "string" || !isAllowedZhihuUrl(url))
      return { ok: false, error: "unsupported_source" };
    try {
      await zhihu.openPage(url);
      return { ok: true };
    } catch {
      return { ok: false, error: "open_failed" };
    }
  });

  ipcMain.handle("zhihu:session-summary", async (event) => {
    assertTrusted(event.sender);
    return zhihu.sessionSummary();
  });

  ipcMain.handle("zhihu:capture-collection", async (event, url?: unknown) => {
    assertTrusted(event.sender);
    if (captureBusy || sync?.busy)
      return {
        ok: false,
        collectionId: "",
        itemCount: 0,
        pageCount: 0,
        items: [],
        failureType: FAILURE_TYPES.HTTP_ERROR,
      };
    captureBusy = true;
    zhihu.resetCapture();
    try {
      return await zhihu.capture(typeof url === "string" ? url : "");
    } catch (error) {
      log("zhihu-capture-failed", {
        code:
          error instanceof Error && "code" in error
            ? error.code
            : "CAPTURE_FAILED",
      });
      return {
        ok: false,
        collectionId: "",
        itemCount: 0,
        pageCount: 0,
        items: [],
        failureType: FAILURE_TYPES.HTTP_ERROR,
      };
    } finally {
      captureBusy = false;
      zhihu.resetCapture();
    }
  });

  ipcMain.handle("zhihu:stop-capture", (event) => {
    assertTrusted(event.sender);
    zhihu.stopCapture();
    return { ok: captureBusy };
  });

  ipcMain.handle("zhihu:sync-start", (event, url?: unknown, mode?: unknown) => {
    assertTrusted(event.sender);
    if (!sync) return { ok: false, error: "database_unavailable" };
    try {
      return sync.start(
        typeof url === "string" ? url : "",
        mode === "full" ? "full" : ("incremental" as SyncMode),
      );
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "sync_start_failed",
      };
    }
  });

  ipcMain.handle(
    "source:sync-start",
    (
      event,
      input?: {
        urls?: unknown;
        mode?: unknown;
        removeRemoteAfterSave?: unknown;
      },
    ) => {
      assertTrusted(event.sender);
      if (!sync) return { ok: false, error: "database_unavailable" };
      const urls = Array.isArray(input?.urls)
        ? input.urls.filter((url): url is string => typeof url === "string")
        : [];
      try {
        return sync.startBatch(
          urls,
          input?.mode === "full" ? "full" : "incremental",
          input?.removeRemoteAfterSave === true,
        );
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "sync_start_failed",
        };
      }
    },
  );

  ipcMain.handle("zhihu:sync-status", (event, jobId?: unknown) => {
    assertTrusted(event.sender);
    if (!sync) return { ok: false, error: "database_unavailable" };
    try {
      return typeof jobId === "string"
        ? { ok: true, job: sync.getJob(jobId) }
        : { ok: false, error: "job_not_found" };
    } catch {
      return { ok: false, error: "job_not_found" };
    }
  });

  ipcMain.handle("source:sync-latest", (event) => {
    assertTrusted(event.sender);
    if (!sync) return { ok: false, error: "database_unavailable" };
    return { ok: true, job: sync.getLatestJob() ?? undefined };
  });

  ipcMain.handle("source:sync-skip-remote-cleanup", (event, jobId?: unknown) => {
    assertTrusted(event.sender);
    if (!sync || typeof jobId !== "string")
      return { ok: false, error: "job_not_found" };
    try {
      return sync.skipRemoteCleanup(jobId);
    } catch {
      return { ok: false, error: "remote_cleanup_skip_failed" };
    }
  });

  ipcMain.handle(
    "source:remove-document-memberships",
    async (event, documentId?: unknown) => {
      assertTrusted(event.sender);
      if (!sync || typeof documentId !== "string")
        return { ok: false, error: "database_unavailable" };
      try {
        return await sync.removeDocumentMemberships(documentId);
      } catch (error) {
        log("remote-cleanup-failed", {
          code: error instanceof Error ? error.message : "unknown",
        });
        return { ok: false, error: "remote_cleanup_failed" };
      }
    },
  );

  ipcMain.handle("zhihu:sync-pause", (event, jobId?: unknown) => {
    assertTrusted(event.sender);
    if (!sync) return { ok: false, error: "database_unavailable" };
    return typeof jobId === "string"
      ? sync.pause(jobId)
      : { ok: false, error: "job_not_running" };
  });

  ipcMain.handle("zhihu:sync-resume", (event, jobId?: unknown) => {
    assertTrusted(event.sender);
    if (!sync) return { ok: false, error: "database_unavailable" };
    try {
      return typeof jobId === "string"
        ? sync.resume(jobId)
        : { ok: false, error: "job_not_found" };
    } catch {
      return { ok: false, error: "sync_resume_failed" };
    }
  });

  ipcMain.handle("zhihu:sync-cancel", (event, jobId?: unknown) => {
    assertTrusted(event.sender);
    if (!sync) return { ok: false, error: "database_unavailable" };
    try {
      return typeof jobId === "string"
        ? sync.cancel(jobId)
        : { ok: false, error: "job_not_found" };
    } catch {
      return { ok: false, error: "job_not_found" };
    }
  });

  ipcMain.handle(
    "zhihu:sync-retry-item",
    (event, input?: { jobId?: unknown; externalId?: unknown }) => {
      assertTrusted(event.sender);
      if (!sync) return { ok: false, error: "database_unavailable" };
      try {
        return typeof input?.jobId === "string" &&
          typeof input.externalId === "string"
          ? sync.retry(input.jobId, input.externalId)
          : { ok: false, error: "retry_unavailable" };
      } catch {
        return { ok: false, error: "retry_failed" };
      }
    },
  );

  ipcMain.handle(
    "document:import-file",
    (event, input?: { name?: unknown; kind?: unknown; content?: unknown }) => {
      assertTrusted(event.sender);
      const name = typeof input?.name === "string" ? input.name.trim() : "";
      const kind = typeof input?.kind === "string" ? input.kind : "";
      if (!name)
        return persist({
          ok: false,
          status: "invalid_input",
          error: "file_name_required",
        });
      const result = parseDocument({
        kind,
        content: input?.content,
        source: "file",
        externalId: `file:${name}`,
      });
      return persist(
        result.ok
          ? result
          : { ...result, source: "file", externalId: `file:${name}` },
      );
    },
  );

  ipcMain.handle("document:import-url", async (event, url?: unknown) => {
    assertTrusted(event.sender);
    const target = typeof url === "string" ? url : "";
    if (!isAllowedZhihuUrl(target))
      return persist({
        ok: false,
        status: "unsupported_source",
        error: "unsupported_zhihu_url",
      });
    try {
      await zhihu.open(zhihu.resolve(target));
      const result = await zhihu.importDocument(target);
      if (
        !result.ok &&
        (result.status === FAILURE_TYPES.LOGIN_EXPIRED ||
          result.status === FAILURE_TYPES.CAPTCHA)
      ) {
        await zhihu.recover(
          {
            status: 0,
            payload: null,
            marker: result.status,
            fetchedAt: new Date().toISOString(),
          },
          result.status,
        );
      }
      return persist(
        result.ok && result.document
          ? { ...result, document: await zhihu.localize(result.document) }
          : result,
      );
    } catch {
      return persist({
        ok: false,
        status: FAILURE_TYPES.HTTP_ERROR,
        source: "zhihu",
        externalId: target,
      });
    }
  });
}
