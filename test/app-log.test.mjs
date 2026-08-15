import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendAppLog, exportAppLogs } from "../src/app-log.mjs";
import { sanitizeForLog } from "../src/security.mjs";

test("rotates and exports redacted application log entries", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "km-log-"));
  try {
    appendAppLog(
      root,
      sanitizeForLog({ at: "one", token: "private" }),
      60,
    );
    appendAppLog(root, { at: "two", detail: "x".repeat(40) }, 60);
    const destination = path.join(root, "diagnostics.jsonl");
    const result = exportAppLogs(root, destination, { version: "1.0.0" });
    const exported = fs.readFileSync(destination, "utf8");
    assert.equal(result.files, 2);
    assert.match(exported, /diagnostic-export/);
    assert.match(exported, /\[REDACTED\]/);
    assert.doesNotMatch(exported, /private/);
    assert.match(exported, /"at":"two"/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
