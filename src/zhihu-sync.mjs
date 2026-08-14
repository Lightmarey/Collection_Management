import { createHash } from 'node:crypto';
import { FAILURE_TYPES } from './zhihu-m0.mjs';

export const SYNC_STATUS = Object.freeze({
  COMPLETED: 'completed',
  STOPPED: 'stopped',
  CANCELLED: 'cancelled',
});

const SAFE_STOP_FAILURES = new Set([
  FAILURE_TYPES.LOGIN_EXPIRED,
  FAILURE_TYPES.RATE_LIMITED,
  FAILURE_TYPES.CAPTCHA,
  FAILURE_TYPES.STRUCTURE_CHANGED,
]);

function failureType(value) {
  return typeof value === 'string' && value ? value : FAILURE_TYPES.HTTP_ERROR;
}

function skipPending(states, reason) {
  for (const state of states) {
    if (state.status !== 'pending') continue;
    state.status = 'skipped';
    state.skipped = true;
    state.failureType = reason ?? null;
  }
}

export function syncItemHash(item = {}) {
  const updatedAt = item.updatedAt == null || item.updatedAt === '' ? null : String(item.updatedAt);
  const identity = {
    externalId: item.externalId ?? null,
    url: item.url ?? null,
    status: item.status ?? null,
  };
  const changeSignal = updatedAt == null
    ? { titleHash: item.titleHash ?? null, contentHash: item.contentHash ?? null }
    : { updatedAt };
  return createHash('sha256').update(JSON.stringify({ ...identity, ...changeSignal })).digest('hex');
}

export function matchesSyncItemHash(storedHash, item = {}) {
  if (storedHash === syncItemHash(item)) return true;
  const updatedAt = item.updatedAt == null || item.updatedAt === '' ? null : String(item.updatedAt);
  const identity = { externalId: item.externalId ?? null, url: item.url ?? null, status: item.status ?? null };
  const changeSignal = updatedAt == null
    ? { titleHash: item.titleHash ?? null, contentHash: item.contentHash ?? null }
    : { updatedAt };
  const accidentalMediaHash = createHash('sha256').update(JSON.stringify({ pipeline: 'media-v2', ...identity, ...changeSignal })).digest('hex');
  return storedHash === accidentalMediaHash;
}

export function shouldFetchSyncItem(mode, storedHash, item = {}) {
  return mode === 'full' || item.status !== 'ok' || !matchesSyncItemHash(storedHash, item);
}

export function prepareRetrySyncItem(item = {}) {
  return { ...item, status: 'ok', failureType: null, httpStatus: null, failureStage: null, failureCode: null };
}

export function remoteCleanupCandidate(item = {}, hasCompleteDocument = () => false) {
  const externalId = String(item.externalId ?? '').trim();
  if (!externalId || !['completed', 'skipped'].includes(item.status)) return null;
  const documentId = String(item.documentId ?? item.url ?? externalId).trim();
  if (!documentId || !hasCompleteDocument(documentId)) return null;
  return {
    externalId,
    documentId,
    kind: item.kind === 'article' ? 'article' : 'answer',
    status: item.status,
  };
}

export function finalSyncJobState(result = {}) {
  const status = result.status === SYNC_STATUS.COMPLETED
    ? Number(result.progress?.failed ?? 0) > 0 ? 'failed' : SYNC_STATUS.COMPLETED
    : result.status === SYNC_STATUS.CANCELLED ? SYNC_STATUS.CANCELLED : SYNC_STATUS.STOPPED;
  const failureType = result.failureType ?? result.items?.find((item) => item.status === 'failed')?.failureType ?? null;
  return { status, failureType };
}

export async function runCollectionSync({
  capture,
  fetchDocument,
  controls = {},
  onProgress = () => {},
  shouldFetchItem = async () => true,
} = {}) {
  if (typeof capture !== 'function' || typeof fetchDocument !== 'function') throw new TypeError('capture and fetchDocument are required');

  const waitUntilReady = typeof controls.waitUntilReady === 'function' ? controls.waitUntilReady : async () => true;
  const captured = await capture({
    isStopped: () => controls.isStopped?.() === true,
    beforeRequest: waitUntilReady,
    onRequest: controls.onRequest,
  });
  const items = Array.isArray(captured?.items) ? captured.items : [];
  const states = items.map((item) => ({
    externalId: item.externalId ?? '',
    kind: item.kind ?? 'unknown',
    title: item.title ?? '',
    url: item.url ?? null,
    status: item.status === 'ok' ? 'pending' : 'failed',
    failureType: item.status === 'ok' ? null : failureType(item.status),
    skipped: false,
  }));

  const progress = () => ({
    total: states.length,
    completed: states.filter((item) => item.status === 'completed').length,
    failed: states.filter((item) => item.status === 'failed').length,
    skipped: states.filter((item) => item.status === 'skipped').length,
    remaining: states.filter((item) => item.status === 'pending').length,
  });
  const report = (extra = {}) => onProgress({ items: states.map((item) => ({ ...item })), progress: progress(), ...extra });

  report({ phase: 'discovered' });
  if (!captured?.ok) {
    skipPending(states, failureType(captured?.failureType));
    return {
      status: captured?.failureType === FAILURE_TYPES.STOPPED ? SYNC_STATUS.CANCELLED : SYNC_STATUS.STOPPED,
      failureType: failureType(captured?.failureType),
      items: states,
      progress: progress(),
      capture: captured,
    };
  }

  for (let index = 0; index < states.length; index += 1) {
    const state = states[index];
    if (state.status !== 'pending') continue;
    if (!(await waitUntilReady())) {
      skipPending(states, FAILURE_TYPES.STOPPED);
      return { status: SYNC_STATUS.CANCELLED, failureType: FAILURE_TYPES.STOPPED, items: states, progress: progress(), capture: captured };
    }

    if (!(await shouldFetchItem(items[index], index))) {
      state.status = 'skipped';
      state.skipped = true;
      report({ phase: 'item', currentExternalId: state.externalId });
      continue;
    }

    try {
      const result = await fetchDocument(items[index], index);
      if (result?.ok) {
        state.status = 'completed';
        state.failureType = null;
        state.httpStatus = null;
        state.failureStage = null;
        state.failureCode = null;
        state.documentId = result.documentId;
        state.created = result.created === true;
        state.versionCreated = result.versionCreated === true;
      } else {
        state.status = 'failed';
        state.failureType = failureType(result?.failureType ?? result?.status);
        state.httpStatus = Number.isInteger(result?.httpStatus) ? result.httpStatus : null;
        state.failureStage = typeof result?.failureStage === 'string' ? result.failureStage : null;
        state.failureCode = typeof result?.failureCode === 'string' ? result.failureCode : null;
      }
    } catch {
      state.status = 'failed';
      state.failureType = FAILURE_TYPES.HTTP_ERROR;
      state.httpStatus = null;
      state.failureStage = 'document_import';
      state.failureCode = 'UnhandledError';
    }
    report({ phase: 'item', currentExternalId: state.externalId });

    if (state.failureType && SAFE_STOP_FAILURES.has(state.failureType)) {
      skipPending(states, state.failureType);
      return { status: SYNC_STATUS.STOPPED, failureType: state.failureType, items: states, progress: progress(), capture: captured };
    }
  }

  return { status: SYNC_STATUS.COMPLETED, items: states, progress: progress(), capture: captured };
}
