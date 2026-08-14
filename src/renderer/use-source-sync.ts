import { useEffect, useMemo, useState } from 'react';
import type { SyncJob, SyncMode } from '../contracts/domain';

export function useSourceSync() {
  const [job, setJob] = useState<SyncJob>();

  useEffect(() => { void window.desktop.getLatestSourceSync().then((result) => { if (result.job) setJob(result.job); }); }, []);

  useEffect(() => {
    if (!job?.id || !['queued', 'running', 'paused'].includes(job.status)) return undefined;
    const timer = window.setInterval(() => {
      void window.desktop.getZhihuSyncStatus(job.id).then((result) => { if (result.job) setJob(result.job); });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [job?.id, job?.status]);

  const summary = useMemo(() => ({
    active: Boolean(job && ['queued', 'running', 'paused'].includes(job.status)),
    progress: job?.payload.progress,
    failures: job?.payload.items?.filter((item) => item.status === 'failed') ?? [],
    created: job?.payload.items?.filter((item) => item.status === 'completed' && item.created).length ?? 0,
    updated: job?.payload.items?.filter((item) => item.status === 'completed' && item.versionCreated && !item.created).length ?? 0,
  }), [job]);

  async function start(url: string, mode: SyncMode) {
    const result = await window.desktop.startZhihuSync(url, mode);
    if (result.job) setJob(result.job);
    return result;
  }

  async function startBatch(urls: string[], mode: SyncMode, removeRemoteAfterSave: boolean) {
    const result = await window.desktop.startSourceSync({ urls, mode, removeRemoteAfterSave });
    if (result.job) setJob(result.job);
    return result;
  }

  async function pause() { if (job) { const result = await window.desktop.pauseZhihuSync(job.id); if (result.job) setJob(result.job); return result; } }
  async function resume() { if (job) { const result = await window.desktop.resumeZhihuSync(job.id); if (result.job) setJob(result.job); return result; } }
  async function cancel() { if (job) { const result = await window.desktop.cancelZhihuSync(job.id); if (result.job) setJob(result.job); return result; } }
  async function skipRemoteCleanup() { if (job) { const result = await window.desktop.skipSourceRemoteCleanup(job.id); if (result.job) setJob(result.job); return result; } }
  async function retry(externalId: string) { if (job) { const result = await window.desktop.retryZhihuSyncItem({ jobId: job.id, externalId }); if (result.job) setJob(result.job); return result; } }

  return { job, ...summary, start, startBatch, pause, resume, cancel, skipRemoteCleanup, retry };
}
