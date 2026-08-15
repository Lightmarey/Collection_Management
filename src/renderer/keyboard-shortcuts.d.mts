export type ShortcutContext = "library" | "reader" | "settings" | "annotations";
export type ShortcutCommand = {
  id: string;
  title: string;
  defaultBinding: string;
  contexts: Array<ShortcutContext | "global">;
};
export function shortcutStroke(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): string;
export function formatShortcut(binding: string, mac?: boolean): string;
export function isCharacterBinding(binding: string): boolean;
export function commandBinding(command: ShortcutCommand, overrides?: Record<string, string>): string;
export function resolveShortcut(input: {
  commands: ShortcutCommand[];
  overrides?: Record<string, string>;
  context: ShortcutContext;
  pending?: string;
  stroke: string;
  characterShortcuts?: boolean;
}): { commandId: string | null; pending: string; options: Array<{ id: string; title: string; binding: string }> };
export function shortcutConflict(commands: ShortcutCommand[], overrides: Record<string, string>, commandId: string, binding: string): ShortcutCommand | null;

