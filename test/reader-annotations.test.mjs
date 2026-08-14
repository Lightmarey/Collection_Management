import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { annotateReaderHtml } from "../src/reader-annotations.mjs";

test("serializes stable highlights and inline note badges from resolved offsets", () => {
  const dom = new JSDOM("");
  const annotations = {
    highlights: [
      {
        id: "h1",
        color: "blue",
        status: "resolved",
        resolvedStart: 6,
        resolvedEnd: 10,
      },
      {
        id: "h2",
        color: "pink",
        status: "resolved",
        resolvedStart: 8,
        resolvedEnd: 12,
      },
    ],
    notes: [
      {
        id: "n1",
        body: "remember this",
        status: "resolved",
        resolvedStart: 6,
        resolvedEnd: 10,
      },
    ],
  };
  const first = annotateReaderHtml(
    "<p>alpha beta</p><p>gamma</p>",
    annotations,
    dom.window.document,
  );
  const second = annotateReaderHtml(
    "<p>alpha beta</p><p>gamma</p>",
    annotations,
    dom.window.document,
  );
  const root = dom.window.document.createElement("div");
  root.innerHTML = first;

  assert.equal(second, first);
  assert.equal(root.textContent, "alpha betagamma");
  assert.ok(root.querySelectorAll("mark.reader-annotation").length >= 2);
  assert.match(
    root.querySelector('[data-highlight-ids="h1 h2"]').textContent,
    /ta/,
  );
  assert.equal(
    [...root.querySelectorAll('[data-note-ids="n1"].reader-note-anchor')]
      .map((node) => node.textContent)
      .join(""),
    "beta",
  );
  assert.equal(
    root.querySelector('[data-reader-note="n1"]').dataset.noteIds,
    "n1",
  );
  assert.equal(
    root.querySelector('[data-reader-note="n1"]').dataset.noteBody,
    "remember this",
  );
  dom.window.close();
});
