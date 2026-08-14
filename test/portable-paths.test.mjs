import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { isSquirrelInstall, runtimeDataRoot } from '../src/portable-paths.mjs';

test('uses repository-local data while developing', () => {
  assert.equal(runtimeDataRoot({ isPackaged: false, execPath: 'ignored', appPath: 'E:/repo', appDataPath: 'ignored' }), path.resolve('E:/repo/.portable-data'));
});

test('keeps installed Squirrel data in AppData across upgrades', () => {
  const executable = path.resolve('C:/Users/Test/AppData/Local/knowledge_management/app-0.1.0/knowledge-management.exe');
  assert.equal(isSquirrelInstall(executable, () => true), true);
  assert.equal(runtimeDataRoot({ isPackaged: true, execPath: executable, appPath: 'ignored', appDataPath: 'C:/Users/Test/AppData/Roaming', platform: 'win32', exists: () => true }), path.resolve('C:/Users/Test/AppData/Roaming/knowledge-management'));
});

test('keeps ZIP portable data beside the executable', () => {
  const executable = path.resolve('D:/Knowledge/knowledge-management.exe');
  assert.equal(runtimeDataRoot({ isPackaged: true, execPath: executable, appPath: 'ignored', appDataPath: 'ignored', platform: 'win32', exists: () => false }), path.resolve('D:/Knowledge/data'));
});

test('supports explicit data directory and distribution overrides', () => {
  const executable = path.resolve('C:/installed/app-1.0.0/app.exe');
  assert.equal(runtimeDataRoot({ isPackaged: true, execPath: executable, appPath: 'ignored', appDataPath: 'C:/AppData', override: 'E:/MyData', exists: () => true }), path.resolve('E:/MyData'));
  assert.equal(runtimeDataRoot({ isPackaged: true, execPath: executable, appPath: 'ignored', appDataPath: 'C:/AppData', platform: 'win32', portable: '1', exists: () => true }), path.resolve('C:/installed/app-1.0.0/data'));
  assert.equal(runtimeDataRoot({ isPackaged: true, execPath: 'D:/portable/app.exe', appPath: 'ignored', appDataPath: 'C:/AppData', platform: 'win32', portable: '0', exists: () => false }), path.resolve('C:/AppData/knowledge-management'));
});
