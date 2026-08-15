const NAMED_KEYS = new Map([
  [" ", "Space"],
  ["ArrowUp", "Up"],
  ["ArrowDown", "Down"],
  ["ArrowLeft", "Left"],
  ["ArrowRight", "Right"],
  ["Escape", "Esc"],
]);

export function shortcutStroke(event) {
  const key = NAMED_KEYS.get(event.key) ??
    (event.key.length === 1 ? event.key.toLowerCase() : event.key);
  if (["Control", "Meta", "Alt", "Shift"].includes(key)) return "";
  const modifiers = [];
  if (event.ctrlKey || event.metaKey) modifiers.push("Mod");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey && (event.key.length > 1 || /^[a-z]$/i.test(event.key))) modifiers.push("Shift");
  return [...modifiers, key].join("+");
}

export function formatShortcut(binding, mac = false) {
  return String(binding ?? "")
    .split(" ")
    .filter(Boolean)
    .map((stroke) => stroke
      .split("+")
      .map((part) => part === "Mod" ? (mac ? "Cmd" : "Ctrl") :
        part.length === 1 ? part.toUpperCase() : part)
      .join("+"))
    .join("  ");
}

export function isCharacterBinding(binding) {
  const strokes = String(binding ?? "").split(" ").filter(Boolean);
  return strokes.length > 0 && strokes.every((stroke) =>
    !stroke.includes("+") && stroke.length === 1,
  );
}

function active(command, context) {
  return command.contexts.includes("global") || command.contexts.includes(context);
}

export function commandBinding(command, overrides = {}) {
  return Object.prototype.hasOwnProperty.call(overrides, command.id)
    ? overrides[command.id]
    : command.defaultBinding;
}

export function resolveShortcut({
  commands,
  overrides = {},
  context,
  pending = "",
  stroke,
  characterShortcuts = true,
}) {
  const sequence = [pending, stroke].filter(Boolean).join(" ");
  const candidates = commands
    .filter((command) => active(command, context))
    .map((command) => ({ command, binding: commandBinding(command, overrides) }))
    .filter(({ binding }) => binding && (characterShortcuts || !isCharacterBinding(binding)));
  const exact = candidates.find(({ binding }) => binding === sequence);
  if (exact) return { commandId: exact.command.id, pending: "", options: [] };
  const options = candidates.filter(({ binding }) => binding.startsWith(`${sequence} `));
  if (options.length) return {
    commandId: null,
    pending: sequence,
    options: options.map(({ command, binding }) => ({ id: command.id, title: command.title, binding })),
  };
  return { commandId: null, pending: "", options: [] };
}

export function shortcutConflict(commands, overrides, commandId, binding) {
  if (!binding) return null;
  const target = commands.find((command) => command.id === commandId);
  if (!target) return null;
  return commands.find((command) => {
    if (command.id === commandId) return false;
    const other = commandBinding(command, overrides);
    const overlaps = command.contexts.includes("global") ||
      target.contexts.includes("global") ||
      command.contexts.some((context) => target.contexts.includes(context));
    return overlaps && Boolean(other) &&
      (other === binding || other.startsWith(`${binding} `) || binding.startsWith(`${other} `));
  }) ?? null;
}

export function tagTogglePlan(ids, taggedIds) {
  const tagged = new Set(taggedIds);
  const remove = ids.every((id) => tagged.has(id));
  return { remove, targets: remove ? ids : ids.filter((id) => !tagged.has(id)) };
}
