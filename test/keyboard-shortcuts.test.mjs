import assert from "node:assert/strict";
import test from "node:test";
import {
  formatShortcut,
  resolveShortcut,
  shortcutConflict,
  shortcutStroke,
  tagTogglePlan,
} from "../src/renderer/keyboard-shortcuts.mjs";

const commands = [
  { id: "palette", title: "Palette", defaultBinding: "Mod+k", contexts: ["global"] },
  { id: "short", title: "Short", defaultBinding: "c 1", contexts: ["library", "reader"] },
  { id: "archive", title: "Archive", defaultBinding: "c 2", contexts: ["library", "reader"] },
  { id: "list-next", title: "Next", defaultBinding: "Down", contexts: ["library"] },
  { id: "scroll", title: "Scroll", defaultBinding: "Down", contexts: ["reader"] },
];

test("normalizes platform modifiers and readable shortcut labels", () => {
  assert.equal(shortcutStroke({ key: "K", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }), "Mod+k");
  assert.equal(shortcutStroke({ key: "K", ctrlKey: true, metaKey: false, altKey: false, shiftKey: true }), "Mod+Shift+k");
  assert.equal(shortcutStroke({ key: "?", ctrlKey: false, metaKey: false, altKey: false, shiftKey: true }), "?");
  assert.equal(shortcutStroke({ key: "ArrowDown", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }), "Down");
  assert.equal(formatShortcut("c 1"), "C  1");
});

test("resolves context-specific commands and two-stroke sequences", () => {
  assert.equal(resolveShortcut({ commands, context: "library", stroke: "Down" }).commandId, "list-next");
  assert.equal(resolveShortcut({ commands, context: "reader", stroke: "Down" }).commandId, "scroll");
  const prefix = resolveShortcut({ commands, context: "reader", stroke: "c" });
  assert.equal(prefix.pending, "c");
  assert.equal(resolveShortcut({ commands, context: "reader", pending: prefix.pending, stroke: "1" }).commandId, "short");
});

test("can disable character-only shortcuts and detects overlapping conflicts", () => {
  assert.equal(resolveShortcut({ commands, context: "reader", stroke: "c", characterShortcuts: false }).pending, "");
  assert.equal(shortcutConflict(commands, {}, "list-next", "Down"), null);
  assert.equal(shortcutConflict(commands, {}, "short", "Mod+k")?.id, "palette");
  assert.equal(shortcutConflict(commands, {}, "short", "c")?.id, "archive");
});

test("quick tags add missing tags and remove them when every target has one", () => {
  assert.deepEqual(tagTogglePlan(["a", "b"], ["a"]), {
    remove: false,
    targets: ["b"],
  });
  assert.deepEqual(tagTogglePlan(["a", "b"], ["a", "b"]), {
    remove: true,
    targets: ["a", "b"],
  });
});
