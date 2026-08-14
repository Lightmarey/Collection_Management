import test from "node:test";
import assert from "node:assert/strict";
import { classifyFailure, FAILURE_TYPES, membershipRemovalRequest, membershipRemovalResult, normalizeCollectionPage, redact, safeLogEvent, zhihuContentId } from "../src/zhihu-m0.mjs";
import { captureCollection, captureSource, sourceTarget } from "../src/zhihu-capture.mjs";

const fixture = {
  data: {
    items: Array.from({ length: 20 }, (_, index) => {
      const id = `sample-${String(index + 1).padStart(3, "0")}`;
      return {
        id,
        type: "answer",
        url: `https://www.zhihu.com/question/sample/answer/${id}`,
        title: `[SAMPLE_TITLE_${id}]`,
        content_html: `<p>[SAMPLE_BODY_${id}]</p>`,
      };
    }),
    paging: { is_end: false, next: "[REDACTED_PAGE_TOKEN]" },
  },
};

test("ambiguous remote removal never succeeds without confirming absence", () => {
  assert.deepEqual(membershipRemovalResult(204), { ok: true });
  assert.deepEqual(membershipRemovalResult(404), { ok: false, error: "remote_state_unknown" });
  assert.deepEqual(membershipRemovalResult(599, true), { ok: false, error: "remote_membership_still_present" });
  assert.deepEqual(membershipRemovalResult(599, false), { ok: true, verifiedAbsent: true });
});

test("builds the Zhihu collection removal PUT request", () => {
  assert.deepEqual(membershipRemovalRequest("412785244", "987654321", "answer"), {
    url: "https://api.zhihu.com/collections/contents/answer/987654321",
    method: "PUT",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "remove_collections=412785244",
  });
  assert.throws(() => membershipRemovalRequest("not-an-id", "987654321", "answer"), /invalid/);
});

test("normalizes twenty-item fixture without retaining content or page tokens", () => {
  const result = normalizeCollectionPage(fixture);
  assert.equal(result.status, "ok");
  assert.equal(result.items.length, 20);
  assert.equal(result.nextPage, true);
  assert.ok(result.items.every((item) => item.contentHash?.length === 64));
  assert.ok(!JSON.stringify(result).includes("SAMPLE_BODY"));
  assert.ok(!JSON.stringify(result).includes("PAGE_TOKEN"));
});

test("normalizes nested collection API items", () => {
  const result = normalizeCollectionPage({
    data: [{
      created: "2026-08-10T00:00:00Z",
      content: {
        id: "answer-1",
        type: "answer",
        url: "https://www.zhihu.com/question/1/answer/2",
        title: "[SAMPLE_TITLE]",
        excerpt: "[SAMPLE_BODY]",
        updated_time: 1786320000,
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
    title: "[SAMPLE_TITLE]",
    url: "https://www.zhihu.com/question/1/answer/2",
    titleHash: result.items[0].titleHash,
    contentHash: result.items[0].contentHash,
    updatedAt: '1786320000',
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

test("keeps zhuanlan article URLs from collection items", () => {
  const result = normalizeCollectionPage({ data: [{ id: "article-1", type: "article", url: "https://zhuanlan.zhihu.com/p/123", title: "[TITLE]" }] });
  assert.equal(result.status, "ok");
  assert.equal(result.items[0].url, "https://zhuanlan.zhihu.com/p/123");
});

test("extracts remote membership content ids from stored document URLs", () => {
  assert.equal(zhihuContentId({ externalId: "987654321", kind: "answer" }), "987654321");
  assert.equal(zhihuContentId({ externalId: "https://www.zhihu.com/question/123456789/answer/987654321", kind: "answer" }), "987654321");
  assert.equal(zhihuContentId({ externalId: "https://zhuanlan.zhihu.com/p/246813579", kind: "article" }), "246813579");
  assert.equal(zhihuContentId({ externalId: "not-a-content-id", kind: "answer" }), null);
});

test("runs the capture flow through every collection page", async () => {
  const calls = [];
  const result = await captureCollection("https://www.zhihu.com/collection/123", {
    fetchJson: async (url) => {
      calls.push(url);
      if (url.endsWith("/123")) return { status: 200, payload: {}, marker: "none" };
      const page = new URL(url).searchParams.get('offset');
      return {
        status: 200,
        marker: "none",
        payload: {
          data: Array.from({ length: page === '20' ? 3 : 20 }, (_, index) => ({ id: `item-${page ?? '0'}-${index}`, title: "[SAMPLE]" })),
          paging: page === '20' ? { is_end: true } : { is_end: false, next: "https://www.zhihu.com/api/v4/collections/123/items?offset=20&limit=20" },
        },
      };
    },
    wait: async () => {},
  });
  assert.equal(result.ok, true);
  assert.equal(result.itemCount, 23);
  assert.equal(result.truncated, false);
  assert.equal(result.pageCount, 2);
  assert.equal(calls.length, 3);
  assert.equal(result.items[0].title, "[SAMPLE]");
});

test("supports public column pagination through the existing source boundary", async () => {
  const target = sourceTarget("https://zhuanlan.zhihu.com/crossin");
  assert.equal(target.kind, "column");
  assert.equal(target.itemsUrl, "https://www.zhihu.com/api/v4/columns/crossin/items");
  const result = await captureSource("https://zhuanlan.zhihu.com/crossin", {
    fetchJson: async () => ({
      status: 200,
      marker: "none",
      payload: {
        data: [{ id: "article-1", type: "article", url: "https://zhuanlan.zhihu.com/p/1", title: "[TITLE]", excerpt: "[BODY]" }],
        paging: { is_end: true },
      },
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.sourceType, "column");
  assert.equal(result.items[0].externalId, "article-1");
  assert.equal(result.items[0].contentHash?.length, 64);
  assert.ok(!JSON.stringify(result).includes("[BODY]"));
});

test("collects only explicit vote or like activities", async () => {
  const result = await captureSource("https://www.zhihu.com/people/demo/activities", {
    fetchJson: async () => ({
      status: 200,
      marker: "none",
      payload: {
        data: [
          { verb: "voteup", target: { id: "answer-1", type: "answer", url: "https://www.zhihu.com/question/1/answer/2", title: "[TITLE]", excerpt: "[BODY]" } },
          { verb: "follow", target: { id: "answer-2", type: "answer", url: "https://www.zhihu.com/question/2/answer/3" } },
        ],
        paging: { is_end: true },
      },
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.sourceType, "likes");
  assert.deepEqual(result.items.map((item) => item.externalId), ["answer-1"]);
  assert.ok(!JSON.stringify(result).includes("[BODY]"));
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
  assert.equal(classifyFailure({ status: 401 }), FAILURE_TYPES.HTTP_ERROR);
  assert.equal(classifyFailure({ status: 403 }), FAILURE_TYPES.HTTP_ERROR);
  assert.equal(classifyFailure({ status: 401, body: { code: 'authentication_required' } }), FAILURE_TYPES.LOGIN_EXPIRED);
  assert.equal(classifyFailure({ status: 429 }), FAILURE_TYPES.RATE_LIMITED);
  assert.equal(classifyFailure({ body: "安全验证" }), FAILURE_TYPES.CAPTCHA);
  assert.equal(classifyFailure({ body: "盐选内容" }), FAILURE_TYPES.UNAVAILABLE);
  assert.equal(classifyFailure({ status: 403, body: 'forbidden' }), FAILURE_TYPES.HTTP_ERROR);
  assert.equal(classifyFailure({ status: 500 }), FAILURE_TYPES.HTTP_ERROR);
  assert.equal(normalizeCollectionPage({ data: {} }).status, FAILURE_TYPES.STRUCTURE_CHANGED);
});
