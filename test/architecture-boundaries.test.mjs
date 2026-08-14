import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const serviceFiles = [
  '../src/services/reader-service.ts',
  '../src/services/source-sync-service.ts',
  '../src/services/source-sync-coordinator.ts',
  '../src/services/data-backup-service.ts',
];

test('application services stay independent from Electron and the SQLite implementation', async () => {
  for (const file of serviceFiles) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from ['"]electron['"]/);
    assert.doesNotMatch(source, /from ['"]\.\.\/database\.mjs['"]/);
  }
});

test('the renderer reader uses the replaceable ReaderClient composition boundary', async () => {
  const readerClient = await readFile(new URL('../src/renderer/reader-client.ts', import.meta.url), 'utf8');
  const readerContract = await readFile(new URL('../src/contracts/reader-client.ts', import.meta.url), 'utf8');
  assert.match(readerClient, /ReaderClient/);
  assert.match(readerContract, /HTTPS for web\/mobile/);
});
