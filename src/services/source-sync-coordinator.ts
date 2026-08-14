import type { SyncMode } from "../contracts/domain";
import type { SyncStore } from "../ports/knowledge-store";
import { SourceRegistry } from "../sources/source-registry";
import { SourceSyncService } from "./source-sync-service";

export class SourceSyncCoordinator {
  private readonly services = new Map<string, SourceSyncService>();

  constructor(
    private readonly store: SyncStore,
    private readonly sources: SourceRegistry,
  ) {
    const interrupted = store.getLatestSyncJob();
    if (
      interrupted &&
      (["queued", "running"].includes(String(interrupted.status)) ||
        interrupted.payload.phase === "awaiting_remote_cleanup_confirmation")
    )
      store.updateSyncJob(String(interrupted.id), {
        status: "stopped",
        lastError: "app_restarted",
        payloadPatch: {
          phase: "finished",
          failureType: "app_restarted",
          ...(interrupted.payload.phase === "awaiting_remote_cleanup_confirmation"
            ? {
                remoteCleanup: {
                  ...(interrupted.payload.remoteCleanup &&
                  typeof interrupted.payload.remoteCleanup === "object"
                    ? interrupted.payload.remoteCleanup
                    : {}),
                  awaitingConfirmation: false,
                  blockedReason: "app_restarted_before_cleanup",
                },
              }
            : {}),
        },
      });
  }

  get busy() {
    return [...this.services.values()].some((service) => service.busy);
  }

  private forSource(source: string) {
    let service = this.services.get(source);
    if (!service) {
      service = new SourceSyncService(this.store, this.sources.get(source));
      this.services.set(source, service);
    }
    return service;
  }

  private forJob(jobId: string) {
    const job = this.store.getSyncJob(jobId);
    const source = job.payload.source as
      { adapterId?: string; url?: string } | undefined;
    const adapterId =
      source?.adapterId || this.sources.forUrl(String(source?.url ?? "")).id;
    return this.forSource(adapterId);
  }

  start(url: string, mode: SyncMode = "incremental") {
    if (this.busy) return { ok: false as const, error: "sync_already_running" };
    const adapter = this.sources.forUrl(url);
    return this.forSource(adapter.id).start(url, mode);
  }

  startBatch(
    urls: string[],
    mode: SyncMode = "incremental",
    removeRemoteAfterSave = false,
  ) {
    if (this.busy) return { ok: false as const, error: "sync_already_running" };
    if (!urls.length) return { ok: false as const, error: "source_required" };
    const adapters = urls.map((url) => this.sources.forUrl(url));
    if (adapters.some((adapter) => adapter.id !== adapters[0].id))
      return { ok: false as const, error: "mixed_adapters_unsupported" };
    return this.forSource(adapters[0].id).startBatch(
      urls,
      mode,
      removeRemoteAfterSave,
    );
  }

  getJob(jobId: string) {
    return this.store.getSyncJob(jobId);
  }
  getLatestJob() {
    return this.store.getLatestSyncJob();
  }
  pause(jobId: string) {
    return this.forJob(jobId).pause(jobId);
  }
  resume(jobId: string) {
    return this.forJob(jobId).resume(jobId);
  }
  cancel(jobId: string) {
    return this.forJob(jobId).cancel(jobId);
  }
  skipRemoteCleanup(jobId: string) {
    return this.forJob(jobId).skipRemoteCleanup(jobId);
  }
  retry(jobId: string, externalId: string) {
    return this.forJob(jobId).retry(jobId, externalId);
  }

  async removeDocumentMemberships(documentId: string) {
    if (this.busy) return { ok: false as const, error: "sync_already_running" };
    const memberships = this.store.getDocumentSourceMemberships(
      documentId,
    ) as Array<{
      source: string;
      sourceId: string;
      name: string;
      externalId: string;
      documentSource: string;
      url: string | null;
    }>;
    if (!memberships.length)
      return { ok: false as const, error: "remote_membership_not_found" };
    const adapter = this.sources.get(memberships[0].documentSource);
    if (!adapter.removeMembership)
      return { ok: false as const, error: "remote_cleanup_unsupported" };
    const targets = memberships.filter(
      (membership) => membership.documentSource === adapter.id,
    );
    if (!targets.length)
      return { ok: false as const, error: "remote_membership_not_writable" };
    const errors: Array<{ sourceId: string; error: string }> = [];
    const removedSourceIds: string[] = [];
    let completed = 0;
    for (const [index, membership] of targets.entries()) {
      if (index) await new Promise((resolve) => setTimeout(resolve, 1200));
      let result;
      try {
        result = await adapter.removeMembership(
          {
            source: membership.source,
            kind: "collection",
            id: membership.sourceId,
            pageUrl: `https://www.zhihu.com/collection/${membership.sourceId}`,
            name: membership.name,
          },
          {
            externalId: membership.externalId,
            kind: /zhuanlan\.zhihu\.com\/p\//.test(membership.url ?? "")
              ? "article"
              : "answer",
            url: membership.url,
            status: "completed",
          },
        );
      } catch {
        result = { ok: false, error: "remote_request_failed" };
      }
      if (result.ok) {
        try {
          this.store.unlinkCollectionDocument(
            adapter.id,
            membership.sourceId,
            documentId,
          );
          completed += 1;
          removedSourceIds.push(membership.sourceId);
        } catch {
          errors.push({
            sourceId: membership.sourceId,
            error: "local_membership_update_failed",
          });
        }
      } else
        errors.push({
          sourceId: membership.sourceId,
          error: result.error ?? "remote_cleanup_failed",
        });
    }
    return {
      ok: errors.length === 0,
      completed,
      failed: errors.length,
      remaining: this.store.getDocumentSourceMemberships(documentId).length,
      removedSourceIds,
      errors,
    };
  }
}
