import type { SyncItem, SyncJob, SyncMode } from '../contracts/domain';
import type { SyncStore } from '../ports/knowledge-store';
import type { SourceAdapter, SourceResponse } from '../sources/source-adapter';
import { finalSyncJobState, prepareRetrySyncItem, remoteCleanupCandidate, runCollectionSync, shouldFetchSyncItem, syncItemHash } from '../zhihu-sync.mjs';
import { classifyFailure, FAILURE_TYPES } from '../zhihu-m0.mjs';

const MIN_REQUEST_DELAY_MS = 1200;

function summarize(items: SyncItem[]) {
  return {
    total: items.length,
    completed: items.filter((item) => item.status === 'completed').length,
    failed: items.filter((item) => item.status === 'failed').length,
    skipped: items.filter((item) => item.status === 'skipped').length,
    remaining: items.filter((item) => item.status === 'pending').length,
  };
}

function merge(previous: SyncItem[], incoming: SyncItem[]) {
  const merged = new Map(previous.map((item) => [item.externalId, item]));
  for (const item of incoming) if (item.externalId) merged.set(item.externalId, item);
  return [...merged.values()];
}

function responseFailure(response: SourceResponse) {
  if (response.marker !== 'none') return response.marker;
  if (!response.payload || typeof response.payload !== 'object') return classifyFailure({ status: response.status });
  const payload = response.payload as Record<string, unknown>;
  return classifyFailure({ status: response.status, body: JSON.stringify({ code: payload.code, message: payload.message, error: payload.error, name: payload.name, type: payload.type }) });
}

function safeFailureCode(error: unknown) {
  if (!error || typeof error !== 'object') return 'UnknownError';
  const value = error as { code?: unknown; name?: unknown };
  const code = typeof value.code === 'string' ? value.code : typeof value.name === 'string' ? value.name : 'UnknownError';
  return /^[A-Za-z0-9_.-]{1,80}$/.test(code) ? code : 'UnknownError';
}

export class SourceSyncService {
  private active: { jobId: string; state: 'running' | 'paused' | 'cancelled' | 'skip_cleanup'; lastRequestAt: number | null } | null = null;

  constructor(private readonly database: SyncStore, private readonly adapter: SourceAdapter) {}

  get busy() {
    return this.active !== null;
  }

  getJob(jobId: string) {
    return this.database.getSyncJob(jobId) as unknown as SyncJob;
  }

  start(url: string, mode: SyncMode = 'incremental') {
    return this.startBatch([url], mode, false);
  }

  startBatch(urls: string[], mode: SyncMode = 'incremental', removeRemoteAfterSave = false) {
    if (this.active) return { ok: false as const, error: 'sync_already_running' };
    const targets = urls.map((url) => this.adapter.resolve(url));
    const target = targets[0];
    if (!target) return { ok: false as const, error: 'source_required' };
    const job = this.database.createSyncJob({ adapterId: this.adapter.id, type: target.kind, mode, source: target.source, externalId: target.id, url: target.pageUrl });
    this.database.updateSyncJob(job.id, { payloadPatch: {
      sources: targets.map((value) => ({ adapterId: this.adapter.id, type: value.kind, externalId: value.id, url: value.pageUrl, name: value.name })),
      currentSource: target.pageUrl,
      removeRemoteAfterSave,
      remoteCleanup: { planned: 0, completed: 0, failed: 0, errors: [] },
    } });
    void this.execute(job.id, target.pageUrl);
    return { ok: true as const, job: this.getJob(job.id) };
  }

  pause(jobId: string) {
    if (this.active?.jobId !== jobId) return { ok: false as const, error: 'job_not_running' };
    this.active.state = 'paused';
    return { ok: true as const, job: this.database.updateSyncJob(jobId, { status: 'paused' }) as unknown as SyncJob };
  }

  resume(jobId: string) {
    const job = this.getJob(jobId);
    if (this.active?.jobId === jobId && this.active.state === 'paused') {
      this.active.state = 'running';
      return { ok: true as const, job: this.database.updateSyncJob(jobId, { status: 'running', lastError: null, payloadPatch: { phase: 'running', failureType: null } }) as unknown as SyncJob };
    }
    if (this.active) return { ok: false as const, error: 'sync_already_running' };
    if (job.status !== 'paused') return { ok: false as const, error: 'job_not_paused' };
    const sourceUrl = String(job.payload.source?.url ?? '');
    void this.execute(jobId, sourceUrl);
    return { ok: true as const, job: this.getJob(jobId) };
  }

  cancel(jobId: string) {
    if (this.active?.jobId === jobId) {
      this.active.state = 'cancelled';
      return { ok: true as const, job: this.database.updateSyncJob(jobId, {
        status: 'cancelled',
        lastError: FAILURE_TYPES.STOPPED,
        payloadPatch: { phase: 'finished', failureType: FAILURE_TYPES.STOPPED, currentExternalId: null },
      }) as unknown as SyncJob };
    }
    return { ok: true as const, job: this.database.updateSyncJob(jobId, { status: 'cancelled', lastError: FAILURE_TYPES.STOPPED }) as unknown as SyncJob };
  }

  skipRemoteCleanup(jobId: string) {
    const job = this.getJob(jobId);
    if (this.active?.jobId !== jobId || this.active.state !== 'paused' || job.payload.phase !== 'awaiting_remote_cleanup_confirmation')
      return { ok: false as const, error: 'remote_cleanup_not_awaiting_confirmation' };
    this.active.state = 'skip_cleanup';
    return {
      ok: true as const,
      job: this.database.updateSyncJob(jobId, {
        status: 'running',
        payloadPatch: {
          phase: 'remote_cleanup_skipped',
          remoteCleanup: { ...(job.payload.remoteCleanup ?? { planned: 0, completed: 0, failed: 0, errors: [] }), awaitingConfirmation: false, skipped: true },
        },
      }) as unknown as SyncJob,
    };
  }

  retry(jobId: string, externalId: string) {
    if (this.active) return { ok: false as const, error: 'retry_unavailable' };
    const job = this.getJob(jobId);
    const items = job.payload.items ?? [];
    const item = items.find((candidate) => candidate.externalId === externalId);
    if (!item || item.status !== 'failed') return { ok: false as const, error: 'item_not_failed' };
    const pending = items.map((candidate) => candidate.externalId === externalId ? { ...candidate, status: 'pending', failureType: null } : candidate);
    const queued = this.database.updateSyncJob(jobId, { status: 'queued', lastError: null, payloadPatch: { items: pending, progress: summarize(pending), failureType: null } });
    void this.execute(jobId, String(job.payload.source?.url ?? ''), externalId);
    return { ok: true as const, job: queued as unknown as SyncJob };
  }

  private async wait(jobId: string) {
    while (this.active?.jobId === jobId && this.active.state === 'paused') await new Promise((resolve) => setTimeout(resolve, 100));
    return this.active?.jobId === jobId && this.active.state === 'running';
  }

  private async awaitCleanupDecision(jobId: string) {
    while (this.active?.jobId === jobId && this.active.state === 'paused') await new Promise((resolve) => setTimeout(resolve, 100));
    if (this.active?.jobId !== jobId || this.active.state === 'cancelled') return 'cancelled' as const;
    return this.active.state === 'skip_cleanup' ? 'skipped' as const : 'approved' as const;
  }

  private async beforeRequest(jobId: string, kind: string) {
    if (!(await this.wait(jobId))) return false;
    const previousAt = this.active?.lastRequestAt ?? null;
    if (previousAt != null) {
      const remaining = MIN_REQUEST_DELAY_MS - (Date.now() - previousAt);
      if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
    }
    if (!(await this.wait(jobId)) || !this.active) return false;
    const at = Date.now();
    this.active.lastRequestAt = at;
    this.database.recordSyncRequest(jobId, { kind, at: new Date(at).toISOString(), delayMs: previousAt == null ? null : Math.max(0, at - previousAt) });
    return true;
  }

  private async fetch(jobId: string, url: string, include = '', kind = 'document') {
    if (!(await this.beforeRequest(jobId, kind))) return { status: 499, payload: null, marker: FAILURE_TYPES.STOPPED, fetchedAt: new Date().toISOString() };
    let response = await this.adapter.fetchJson(url, include);
    const failureType = responseFailure(response);
    if (failureType !== FAILURE_TYPES.LOGIN_EXPIRED && failureType !== FAILURE_TYPES.CAPTCHA) return response;
    if (this.active?.jobId !== jobId) return response;
    this.active.state = 'paused';
    this.database.updateSyncJob(jobId, {
      status: 'paused',
      lastError: failureType,
      payloadPatch: { phase: failureType === FAILURE_TYPES.LOGIN_EXPIRED ? 'awaiting_login' : 'awaiting_verification', failureType },
    });
    await this.adapter.recover(response, failureType);
    if (!(await this.wait(jobId))) return { status: 499, payload: null, marker: FAILURE_TYPES.STOPPED, fetchedAt: new Date().toISOString() };
    if (await this.adapter.verifySession() === false) return { ...response, marker: FAILURE_TYPES.LOGIN_EXPIRED };
    if (!(await this.beforeRequest(jobId, `${kind}-retry`))) return { status: 499, payload: null, marker: FAILURE_TYPES.STOPPED, fetchedAt: new Date().toISOString() };
    response = await this.adapter.fetchJson(url, include);
    if (!responseFailure(response)) this.adapter.hideRecovery();
    return response;
  }

  private async importItem(jobId: string, collectionId: string, item: SyncItem, position: number) {
    if (item.status !== 'ok' || !item.url) {
      const failureType = item.failureType ?? (item.status === 'ok' ? FAILURE_TYPES.UNAVAILABLE : item.status);
      try { this.database.recordImportError({ source: this.adapter.id, externalId: item.url ?? `source-item:${item.externalId}`, url: item.url, body: '', importError: failureType, fetchedAt: new Date().toISOString() }); } catch {}
      return { ok: false, failureType };
    }
    let result;
    try {
      result = await this.adapter.importDocument(item.url, (url, include) => this.fetch(jobId, url, include, 'document'));
    } catch (error) {
      return { ok: false, failureType: FAILURE_TYPES.HTTP_ERROR, httpStatus: null, failureStage: 'document_detail', failureCode: safeFailureCode(error) };
    }
    if (result.ok && result.document) {
      let localized;
      try { localized = await this.adapter.localize(result.document); }
      catch (error) { return { ok: false, failureType: FAILURE_TYPES.HTTP_ERROR, httpStatus: null, failureStage: 'media_localization', failureCode: safeFailureCode(error) }; }
      let write;
      try { write = this.database.upsertDocument(localized); }
      catch (error) { return { ok: false, failureType: FAILURE_TYPES.HTTP_ERROR, httpStatus: null, failureStage: 'database_write', failureCode: safeFailureCode(error) }; }
      try { this.database.linkCollectionDocument(collectionId, write.documentId, position, syncItemHash(item)); }
      catch (error) { return { ok: false, failureType: FAILURE_TYPES.HTTP_ERROR, httpStatus: null, failureStage: 'collection_link', failureCode: safeFailureCode(error) }; }
      return { ok: true, documentId: write.documentId, created: write.created, versionCreated: write.versionCreated };
    }
    if (result.source && result.externalId) {
      try { this.database.recordImportError({ source: result.source, externalId: result.externalId, url: result.url ?? item.url, body: '', importError: result.status, fetchedAt: new Date().toISOString() }); } catch {}
    }
    return { ok: false, failureType: result.status, httpStatus: result.httpStatus ?? null, failureStage: result.failureStage ?? 'document_detail', failureCode: result.failureCode ?? undefined };
  }

  private async execute(jobId: string, sourceUrl: string, retryExternalId: string | null = null) {
    if (this.active) return;
    const job = this.getJob(jobId);
    const mode = job.payload.mode === 'full' ? 'full' : 'incremental';
    const sourceUrls = retryExternalId
      ? [sourceUrl || String(job.payload.source?.url ?? '')]
      : job.payload.sources?.map((source) => source.url).filter(Boolean) ?? [sourceUrl || String(job.payload.source?.url ?? '')];
    const retryItem = retryExternalId ? job.payload.items?.find((item) => item.externalId === retryExternalId) : null;
    if (retryExternalId && !retryItem) throw new Error('sync item not found');
    this.active = { jobId, state: 'running', lastRequestAt: null };
    try {
      this.database.updateSyncJob(jobId, { status: 'running', lastError: null, incrementAttempts: true });
      let aggregateFailure: string | null = null;
      const cleanupQueue: Array<{ target: ReturnType<SourceAdapter['resolve']>; item: SyncItem }> = [];
      let listingComplete = true;
      for (const currentUrl of sourceUrls) {
        if (!(await this.wait(jobId))) break;
        const target = this.adapter.resolve(currentUrl);
        const source = this.database.upsertCollection({ source: target.source, externalId: target.id, name: target.name });
        this.database.updateSyncJob(jobId, { payloadPatch: { currentSource: target.pageUrl, phase: 'listing' } });
        await this.adapter.open(target);
        const controls = { waitUntilReady: () => this.wait(jobId), isStopped: () => this.active?.state === 'cancelled' };
        const result = await runCollectionSync({
          capture: retryItem
            ? async () => ({ ok: true, sourceType: target.kind, sourceId: target.id, itemCount: 1, pageCount: 0, items: [prepareRetrySyncItem(retryItem)] })
            : (hooks) => this.adapter.capture(currentUrl, { fetchJson: (url: string) => this.fetch(jobId, url, '', 'list'), ...hooks }),
          fetchDocument: (item, position) => this.importItem(jobId, source.collectionId, item as SyncItem, position),
          controls,
          shouldFetchItem: async (item) => {
            const storedHash = this.database.getCollectionItemSyncHash(source.collectionId, String(item.externalId ?? ''));
            return shouldFetchSyncItem(mode, storedHash, item);
          },
          onProgress: ({ items, phase, currentExternalId }) => {
            const current = this.getJob(jobId);
            const merged = merge(current.payload.items ?? [], items as SyncItem[]);
            this.database.updateSyncJob(jobId, { payloadPatch: { items: merged, progress: summarize(merged), phase, currentExternalId: currentExternalId ?? null } });
          },
        });
        const current = this.getJob(jobId);
        const merged = merge(current.payload.items ?? [], result.items as SyncItem[]);
        const final = finalSyncJobState(result);
        listingComplete = listingComplete && result.capture?.ok === true;
        aggregateFailure = final.failureType ?? aggregateFailure;
        this.database.updateSyncJob(jobId, { payloadPatch: { items: merged, progress: summarize(merged), failureType: aggregateFailure, currentExternalId: null } });

        if (!retryItem && current.payload.removeRemoteAfterSave && result.capture?.ok === true && target.kind === 'collection' && this.adapter.removeMembership) {
          for (const item of result.items as SyncItem[]) {
            const candidate = remoteCleanupCandidate(item, (documentId) => this.database.hasCompleteDocument(this.adapter.id, documentId));
            if (candidate) cleanupQueue.push({ target, item: { ...item, ...candidate } });
          }
        }
      }

      const cleanupRequested = !retryItem && job.payload.removeRemoteAfterSave === true;
      if (cleanupRequested && !listingComplete) {
        const live = this.getJob(jobId);
        this.database.updateSyncJob(jobId, { payloadPatch: {
          remoteCleanup: { ...(live.payload.remoteCleanup ?? { planned: 0, completed: 0, failed: 0, errors: [] }), blockedReason: 'listing_incomplete' },
        } });
      }

      let cleanupApproved = false;
      if (cleanupRequested && listingComplete && cleanupQueue.length && this.active?.state === 'running') {
        const live = this.getJob(jobId);
        this.active.state = 'paused';
        this.database.updateSyncJob(jobId, {
          status: 'paused',
          payloadPatch: {
            phase: 'awaiting_remote_cleanup_confirmation',
            remoteCleanup: {
              ...(live.payload.remoteCleanup ?? { completed: 0, failed: 0, errors: [] }),
              planned: cleanupQueue.length,
              awaitingConfirmation: true,
              candidates: cleanupQueue.map(({ target, item }) => ({
                sourceId: target.id,
                sourceName: target.name,
                externalId: item.externalId,
                documentId: item.documentId,
                kind: item.kind,
                status: item.status,
              })),
            },
          },
        });
        cleanupApproved = await this.awaitCleanupDecision(jobId) === 'approved';
      }

      if (cleanupApproved && this.active?.state === 'running') {
        for (const { target, item } of cleanupQueue) {
          if (!(await this.beforeRequest(jobId, 'remote-cleanup'))) break;
          let removal: { ok: boolean; error?: string };
          try { removal = await this.adapter.removeMembership!(target, item); }
          catch { removal = { ok: false, error: 'remote_state_unknown' }; }
          let cleanupError = removal.error;
          if (removal.ok) {
            try { this.database.unlinkCollectionDocument(this.adapter.id, target.id, item.documentId ?? item.externalId); }
            catch { cleanupError = 'local_membership_update_failed'; }
          }
          const live = this.getJob(jobId);
          const cleanup = live.payload.remoteCleanup ?? { planned: cleanupQueue.length, completed: 0, failed: 0, errors: [] };
          const nextCleanup = removal.ok && !cleanupError
            ? { ...cleanup, awaitingConfirmation: false, completed: cleanup.completed + 1 }
            : { ...cleanup, awaitingConfirmation: false, failed: cleanup.failed + 1, errors: [...cleanup.errors, { externalId: item.externalId, error: cleanupError ?? 'remote_cleanup_failed' }] };
          this.database.updateSyncJob(jobId, { payloadPatch: { remoteCleanup: nextCleanup, phase: 'remote_cleanup' } });
        }
      }
      const current = this.getJob(jobId);
      const cancelled = this.active?.state === 'cancelled';
      const failed = current.payload.items?.some((item) => item.status === 'failed');
      this.database.updateSyncJob(jobId, { status: cancelled ? 'cancelled' : failed ? 'stopped' : 'completed', lastError: cancelled ? FAILURE_TYPES.STOPPED : aggregateFailure, payloadPatch: { phase: 'finished', currentSource: null, currentExternalId: null } });
    } catch {
      this.database.updateSyncJob(jobId, { status: 'failed', lastError: 'sync_failed', payloadPatch: { phase: 'finished', failureType: FAILURE_TYPES.HTTP_ERROR } });
    } finally {
      if (this.active?.jobId === jobId) this.active = null;
    }
  }
}
