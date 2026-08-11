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

export function syncItemHash(item = {}) {
  return createHash('sha256').update(JSON.stringify({
    externalId: item.externalId ?? null,
    url: item.url ?? null,
    titleHash: item.titleHash ?? null,
    contentHash: item.contentHash ?? null,
    status: item.status ?? null,
  })).digest('hex');
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
      return { status: SYNC_STATUS.CANCELLED, failureType: FAILURE_TYPES.STOPPED, items: states, progress: progress(), capture: captured };
    }

    if (!(await shouldFetchItem(items[index]))) {
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
        state.documentId = result.documentId;
        state.created = result.created === true;
        state.versionCreated = result.versionCreated === true;
      } else {
        state.status = 'failed';
        state.failureType = failureType(result?.failureType ?? result?.status);
      }
    } catch {
      state.status = 'failed';
      state.failureType = FAILURE_TYPES.HTTP_ERROR;
    }
    report({ phase: 'item', currentExternalId: state.externalId });

    if (state.failureType && SAFE_STOP_FAILURES.has(state.failureType)) {
      return { status: SYNC_STATUS.STOPPED, failureType: state.failureType, items: states, progress: progress(), capture: captured };
    }
  }

  return { status: SYNC_STATUS.COMPLETED, items: states, progress: progress(), capture: captured };
}
