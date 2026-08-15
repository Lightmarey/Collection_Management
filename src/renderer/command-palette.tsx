import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";

export type AppCommand = {
  id: string;
  title: string;
  category: string;
  shortcut?: string;
  defaultBinding?: string;
  contexts?: Array<"global" | "library" | "reader" | "settings" | "annotations">;
  keywords?: string[];
  disabledReason?: string;
  palette?: boolean;
  run(): void;
};

export function CommandPalette({
  mode,
  commands,
  close,
}: {
  mode: "commands" | "shortcuts";
  commands: AppCommand[];
  close(): void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const visible = useMemo(() => {
    const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    return commands.filter((command) => {
      if (mode === "commands" && command.palette === false) return false;
      if (mode === "shortcuts" && !command.shortcut) return false;
      const haystack = [command.title, command.category, ...(command.keywords ?? []), command.shortcut ?? ""]
        .join(" ")
        .toLocaleLowerCase();
      return words.every((word) => haystack.includes(word));
    });
  }, [commands, mode, query]);

  useEffect(() => setActive(0), [query, mode]);
  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    inputRef.current?.focus();
    return () => {
      if (panel?.contains(document.activeElement))
        previousFocus.current?.focus();
    };
  }, []);

  function run(command: AppCommand) {
    if (command.disabledReason) return;
    close();
    command.run();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => (index + direction + visible.length) % Math.max(1, visible.length));
    } else if (event.key === "Enter" && visible[active]) {
      event.preventDefault();
      run(visible[active]);
    } else if (event.key === "Tab") {
      const focusable = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>('input,button:not([disabled])') ?? [],
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  const categories = [...new Set(visible.map((command) => command.category))];
  return (
    <div
      className="command-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
      onKeyDown={onKeyDown}
    >
      <section
        className="command-palette"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={mode === "commands" ? "命令面板" : "快捷键帮助"}
      >
        <header>
          <Search size={17} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={mode === "commands" ? "输入命令" : "搜索快捷键"}
            aria-label={mode === "commands" ? "输入命令" : "搜索快捷键"}
          />
          <button onClick={close} aria-label="关闭">
            <X size={16} />
          </button>
        </header>
        <div className="command-results" role="listbox">
          {categories.map((category) => (
            <section key={category}>
              <h3>{category}</h3>
              {visible.map((command, index) =>
                command.category === category ? (
                  <button
                    key={command.id}
                    role="option"
                    aria-selected={index === active}
                    aria-disabled={Boolean(command.disabledReason)}
                    className={index === active ? "active" : ""}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => run(command)}
                  >
                    <span>
                      <b>{command.title}</b>
                      {command.disabledReason && <small>{command.disabledReason}</small>}
                    </span>
                    {command.shortcut ? (
                      <kbd>{command.shortcut}</kbd>
                    ) : null}
                  </button>
                ) : null,
              )}
            </section>
          ))}
          {!visible.length && <p className="command-empty">没有匹配命令</p>}
        </div>
        <footer>
          <span>↑↓ 选择</span><span>Enter 执行</span><span>Esc 关闭</span>
        </footer>
      </section>
    </div>
  );
}
