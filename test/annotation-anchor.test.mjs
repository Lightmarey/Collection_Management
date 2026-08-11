import test from 'node:test';
import assert from 'node:assert/strict';
import { createTextAnchor, locateTextAnchor } from '../src/annotation-anchor.mjs';

test('uses surrounding context to resolve the intended repeated quote', () => {
  const body = '脱敏前文。重点句。中间内容。重点句。脱敏后文。';
  const secondStart = body.lastIndexOf('重点句。');
  const anchor = createTextAnchor({ text: body, start: secondStart, end: secondStart + 4, contextLength: 5 });
  const resolved = locateTextAnchor(body, anchor);
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.start, secondStart);
});

test('survives insertion before and after the anchored text', () => {
  const body = '开头。可恢复的摘录。结尾。';
  const start = body.indexOf('可恢复的摘录');
  const anchor = createTextAnchor({ text: body, start, end: start + 6 });
  const changed = `新增开头。${body}新增结尾。`;
  const resolved = locateTextAnchor(changed, anchor);
  assert.deepEqual(resolved, { status: 'resolved', start: changed.indexOf('可恢复的摘录'), end: changed.indexOf('可恢复的摘录') + 6, exact: '可恢复的摘录' });
});

test('marks an anchor for repair when its exact quote disappeared', () => {
  const anchor = createTextAnchor({ text: '保留句。待修复句。', start: 4, end: 9 });
  assert.equal(locateTextAnchor('保留句。替换内容。', anchor).status, 'needs_repair');
});

