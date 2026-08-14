import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { matchesSyncItemHash, shouldFetchSyncItem, syncItemHash } from '../src/zhihu-sync.mjs';

test('list update time participates in the incremental hash', () => {
  const base = { externalId: 'answer-1', url: 'https://www.zhihu.com/question/1/answer/1', titleHash: 'title', contentHash: null, status: 'ok' };
  assert.notEqual(syncItemHash({ ...base, updatedAt: '100' }), syncItemHash({ ...base, updatedAt: '101' }));
});

test('fallback hash remains stable when list update time is missing', () => {
  const base = { externalId: 'answer-1', url: 'https://www.zhihu.com/question/1/answer/1', titleHash: 'title', contentHash: 'excerpt', status: 'ok' };
  assert.equal(syncItemHash(base), syncItemHash({ ...base, updatedAt: null }));
});

test('stable list update time ignores volatile excerpts', () => {
  const base = { externalId: 'answer-1', url: 'https://www.zhihu.com/question/1/answer/1', titleHash: 'title', status: 'ok', updatedAt: '101' };
  assert.equal(syncItemHash({ ...base, contentHash: 'excerpt-a' }), syncItemHash({ ...base, contentHash: 'excerpt-b' }));
});

test('accepts the accidental media-v2 hash without refetching正文', () => {
  const item = { externalId: 'answer-1', url: 'https://www.zhihu.com/question/1/answer/1', status: 'ok', updatedAt: '101' };
  const accidental = createHash('sha256').update(JSON.stringify({ pipeline: 'media-v2', externalId: item.externalId, url: item.url, status: item.status, updatedAt: item.updatedAt })).digest('hex');
  assert.equal(matchesSyncItemHash(accidental, item), true);
  assert.notEqual(accidental, syncItemHash(item));
});

test('keeps incremental, full, and changed-item fetch decisions separate', () => {
  const item = { externalId: 'answer-1', url: 'https://www.zhihu.com/question/1/answer/1', status: 'ok', updatedAt: '101' };
  const stored = syncItemHash(item);
  assert.equal(shouldFetchSyncItem('incremental', stored, item), false);
  assert.equal(shouldFetchSyncItem('full', stored, item), true);
  assert.equal(shouldFetchSyncItem('incremental', stored, { ...item, updatedAt: '102' }), true);
});
