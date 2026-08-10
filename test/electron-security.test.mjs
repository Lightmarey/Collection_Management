import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isAllowedZhihuUrl, isLocalUiUrl, sanitizeForLog } from '../src/security.mjs';

const mainSource = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
const preloadSource = await readFile(new URL('../src/preload.ts', import.meta.url), 'utf8');

test('allows only HTTPS Zhihu URLs and local UI senders', () => {
  assert.equal(isAllowedZhihuUrl('https://www.zhihu.com/'), true);
  assert.equal(isAllowedZhihuUrl('https://zhuanlan.zhihu.com/p/1'), true);
  assert.equal(isAllowedZhihuUrl('http://www.zhihu.com/'), false);
  assert.equal(isAllowedZhihuUrl('https://evil.example/'), false);
  assert.equal(isLocalUiUrl('file:///app/index.html'), true);
  assert.equal(isLocalUiUrl('http://localhost:5173/', 'http://localhost:5173'), true);
  assert.equal(isLocalUiUrl('https://www.zhihu.com/', 'http://localhost:5173'), false);
});

test('redacts secrets before lifecycle/error logging', () => {
  const safe = sanitizeForLog({ cookie: 'private', url: 'https://www.zhihu.com/?token=private', error: new Error('session=private') });
  assert.deepEqual(safe, { cookie: '[REDACTED]', url: 'https://www.zhihu.com/?[REDACTED]', error: { name: 'Error', message: 'session=[REDACTED]' } });
});

test('source keeps remote content outside privileged APIs and uses a narrow bridge', () => {
  for (const setting of ['contextIsolation: true', 'nodeIntegration: false', 'sandbox: true', 'setWindowOpenHandler', 'will-navigate', 'setPermissionRequestHandler']) {
    assert.match(mainSource, new RegExp(setting.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(preloadSource, /contextBridge\.exposeInMainWorld/);
  assert.doesNotMatch(preloadSource, /ipcRenderer\.(send|on|once|removeListener)\b/);
});
