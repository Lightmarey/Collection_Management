import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { classifyFailure, FAILURE_TYPES, normalizeCollectionPage, redact, safeLogEvent } from "../src/zhihu-m0.mjs";

const fixture = JSON.parse(await readFile(new URL("../fixtures/zhihu/collection-page.sample.json", import.meta.url)));

test("normalizes twenty-item fixture without retaining content or page tokens", () => {
  const result = normalizeCollectionPage(fixture);
  assert.equal(result.status, "ok");
  assert.equal(result.items.length, 20);
  assert.equal(result.nextPage, true);
  assert.ok(result.items.every((item) => item.contentHash?.length === 64));
  assert.ok(!JSON.stringify(result).includes("SAMPLE_BODY"));
  assert.ok(!JSON.stringify(result).includes("PAGE_TOKEN"));
});

test("redacts credentials, bodies, and query secrets recursively", () => {
  const safe = redact({ cookie: "private", content_html: "private body", url: "https://example.test/a?token=private" });
  assert.deepEqual(safe, { cookie: "[REDACTED]", content_html: "[REDACTED]", url: "https://example.test/a?[REDACTED]" });
  assert.deepEqual(safeLogEvent({ type: "response", status: 429, body: "private body", token: "private" }), {
    type: "response",
    status: 429,
    token: "[REDACTED]",
  });
});

test("classifies expected access failures without exposing response bodies", () => {
  assert.equal(classifyFailure({ status: 401 }), FAILURE_TYPES.LOGIN_EXPIRED);
  assert.equal(classifyFailure({ status: 429 }), FAILURE_TYPES.RATE_LIMITED);
  assert.equal(classifyFailure({ body: "安全验证" }), FAILURE_TYPES.CAPTCHA);
  assert.equal(classifyFailure({ body: "盐选内容" }), FAILURE_TYPES.UNAVAILABLE);
  assert.equal(classifyFailure({ status: 500 }), FAILURE_TYPES.HTTP_ERROR);
  assert.equal(normalizeCollectionPage({ data: {} }).status, FAILURE_TYPES.STRUCTURE_CHANGED);
});
