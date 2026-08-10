import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { classifyFailure, FAILURE_TYPES, normalizeCollectionPage, redact, safeLogEvent } from "../src/zhihu-m0.mjs";
import { captureCollection } from "../src/zhihu-capture.mjs";

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

test("normalizes the zhihu-plus-plus collection API shape", () => {
  const result = normalizeCollectionPage({
    data: [{
      created: "2026-08-10T00:00:00Z",
      content: {
        id: "answer-1",
        type: "answer",
        url: "https://www.zhihu.com/question/1/answer/2",
        title: "[SAMPLE_TITLE]",
        excerpt: "[SAMPLE_BODY]",
      },
    }],
    paging: {
      is_end: false,
      next: "https://www.zhihu.com/api/v4/collections/123/items?offset=20&limit=20",
    },
  });

  assert.equal(result.status, "ok");
  assert.equal(result.nextPage, true);
  assert.deepEqual(result.items[0], {
    externalId: "answer-1",
    kind: "answer",
    url: "https://www.zhihu.com/question/1/answer/2",
    titleHash: result.items[0].titleHash,
    contentHash: result.items[0].contentHash,
    status: "ok",
  });
  assert.equal(result.items[0].titleHash?.length, 64);
  assert.equal(result.items[0].contentHash?.length, 64);
  assert.ok(!JSON.stringify(result).includes("SAMPLE_BODY"));
});

test("hashes string content in nested collection items without retaining it", () => {
  const result = normalizeCollectionPage({ data: [{ content: { id: "answer-2", type: "answer", content: "[SAMPLE_BODY]" } }] });
  assert.equal(result.status, "ok");
  assert.equal(result.items[0].contentHash?.length, 64);
  assert.ok(!JSON.stringify(result).includes("SAMPLE_BODY"));
});

test("runs the capture flow headlessly and stops at twenty items", async () => {
  const calls = [];
  const result = await captureCollection("https://www.zhihu.com/collection/123", {
    fetchJson: async (url) => {
      calls.push(url);
      if (url.endsWith("/123")) return { status: 200, payload: {}, marker: "none" };
      return {
        status: 200,
        marker: "none",
        payload: {
          data: Array.from({ length: 20 }, (_, index) => ({ id: `item-${index}`, title: "[SAMPLE]" })),
          paging: { is_end: false, next: "https://www.zhihu.com/api/v4/collections/123/items?offset=20&limit=20" },
        },
      };
    },
    wait: async () => {},
  });
  assert.equal(result.ok, true);
  assert.equal(result.itemCount, 20);
  assert.equal(result.truncated, true);
  assert.equal(calls.length, 2);
  assert.ok(!JSON.stringify(result).includes("SAMPLE"));
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
