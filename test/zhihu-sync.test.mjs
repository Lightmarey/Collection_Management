import test from 'node:test';
import assert from 'node:assert/strict';
import { FAILURE_TYPES } from '../src/zhihu-m0.mjs';
import { runCollectionSync, SYNC_STATUS } from '../src/zhihu-sync.mjs';

test('repeats a redacted twenty-item sync, continues after one item failure, and reports progress', async () => {
  const items = Array.from({ length: 20 }, (_, index) => ({
    externalId: `sample-${index}`,
    kind: 'answer',
    url: `https://www.zhihu.com/question/${index}/answer/${index}`,
    status: 'ok',
  }));
  const processed = [];
  const progress = [];
  const result = await runCollectionSync({
    capture: async () => ({ ok: true, items }),
    fetchDocument: async (item) => {
      processed.push(item.externalId);
      return item.externalId === 'sample-7'
        ? { ok: false, failureType: FAILURE_TYPES.UNAVAILABLE }
        : { ok: true, documentId: `document-${item.externalId}`, versionCreated: item.externalId === 'sample-3' };
    },
    onProgress: (value) => progress.push(value),
  });

  assert.equal(result.status, SYNC_STATUS.COMPLETED);
  assert.deepEqual(result.progress, { total: 20, completed: 19, failed: 1, skipped: 0, remaining: 0 });
  assert.equal(processed.length, 20);
  assert.equal(progress.at(-1).items.find((item) => item.externalId === 'sample-7').failureType, FAILURE_TYPES.UNAVAILABLE);
  assert.ok(!JSON.stringify(result).includes('BODY'));
});

test('stops safely when a single response signals login expiry', async () => {
  let calls = 0;
  const result = await runCollectionSync({
    capture: async () => ({ ok: true, items: [
      { externalId: 'first', kind: 'answer', url: 'https://www.zhihu.com/question/1/answer/1', status: 'ok' },
      { externalId: 'second', kind: 'answer', url: 'https://www.zhihu.com/question/2/answer/2', status: 'ok' },
    ] }),
    fetchDocument: async () => {
      calls += 1;
      return { ok: false, failureType: FAILURE_TYPES.LOGIN_EXPIRED };
    },
  });

  assert.equal(result.status, SYNC_STATUS.STOPPED);
  assert.equal(result.failureType, FAILURE_TYPES.LOGIN_EXPIRED);
  assert.equal(calls, 1);
  assert.equal(result.progress.remaining, 1);
});

test('skips unchanged items without fetching their正文', async () => {
  let fetched = 0;
  const result = await runCollectionSync({
    capture: async () => ({ ok: true, items: [
      { externalId: 'unchanged', status: 'ok' },
      { externalId: 'changed', status: 'ok' },
    ] }),
    shouldFetchItem: async (item) => item.externalId === 'changed',
    fetchDocument: async (item) => {
      fetched += 1;
      return { ok: true, documentId: item.externalId, created: false, versionCreated: true };
    },
  });

  assert.equal(fetched, 1);
  assert.equal(result.progress.skipped, 1);
  assert.equal(result.items[0].status, 'skipped');
  assert.equal(result.items[1].versionCreated, true);
});
