import assert from 'node:assert/strict';
import test from 'node:test';
import { signZhihuRequest } from '../src/zhihu-signature.mjs';

const COOKIE = 'test-cookie-value';

test('signZhihuRequest is deterministic and signs the final encoded URL', () => {
  const first = signZhihuRequest('https://www.zhihu.com/api/v4/answers/1?include=a%2Cb&limit=10', COOKIE);
  const second = signZhihuRequest('https://www.zhihu.com/api/v4/answers/1?include=a%2Cb&limit=10', COOKIE);
  assert.deepEqual(first, second);
  assert.equal(first['x-zse-93'], '101_3_3.0');
  assert.equal(first['x-requested-with'], 'fetch');
  assert.match(first['x-zse-96'], /^2\.0_[A-Za-z0-9+/=]+$/);
});

test('query order and encoding are part of the signature', () => {
  const ordered = signZhihuRequest('https://www.zhihu.com/api/v4/questions/1?include=a%2Cb&limit=10', COOKIE);
  const reordered = signZhihuRequest('https://www.zhihu.com/api/v4/questions/1?limit=10&include=a%2Cb', COOKIE);
  const differentlyEncoded = signZhihuRequest('https://www.zhihu.com/api/v4/questions/1?include=a,b&limit=10', COOKIE);
  assert.notEqual(ordered['x-zse-96'], reordered['x-zse-96']);
  assert.notEqual(ordered['x-zse-96'], differentlyEncoded['x-zse-96']);
});

test('different URLs produce different signatures', () => {
  const first = signZhihuRequest('https://www.zhihu.com/api/v4/answers/1', COOKIE);
  const second = signZhihuRequest('https://www.zhihu.com/api/v4/answers/2', COOKIE);
  assert.notEqual(first['x-zse-96'], second['x-zse-96']);
});

test('missing d_c0 and non-Zhihu URLs are rejected', () => {
  assert.throws(() => signZhihuRequest('https://www.zhihu.com/api/v4/me', ''), /d_c0/);
  assert.throws(() => signZhihuRequest('https://example.com/api/v4/me', COOKIE), /unsupported/);
});
