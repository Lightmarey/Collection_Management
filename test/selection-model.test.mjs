import test from "node:test";
import assert from "node:assert/strict";
import { toggleSelection } from "../src/renderer/selection-model.mjs";

test("Ctrl/Cmd selection toggles an item on and off like Windows Explorer", () => {
  const first = toggleSelection(new Set(), "a", "b");
  assert.deepEqual([...first].sort(), ["a", "b"]);
  const second = toggleSelection(first, "b", "a");
  assert.deepEqual([...second], ["b"]);
  const third = toggleSelection(second, "a", "b");
  assert.deepEqual([...third], []);
});
