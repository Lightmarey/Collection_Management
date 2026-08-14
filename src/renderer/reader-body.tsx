import { memo, useMemo, type RefObject } from "react";
import DOMPurify from "dompurify";
import type { ReaderDocument } from "../contracts/domain";
import { annotateReaderHtml } from "../reader-annotations.mjs";
import type { SelectionAnchor } from "./annotation-toolbar";
import { renderLatexImages } from "./latex";
import "katex/dist/katex.min.css";

function safeHtml(body: string) {
  return DOMPurify.sanitize(body, {
    FORBID_TAGS: [
      "base",
      "embed",
      "form",
      "iframe",
      "input",
      "link",
      "meta",
      "object",
      "script",
      "style",
      "template",
    ],
    FORBID_ATTR: ["style", "onerror", "onclick", "onload"],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|km-media:\/\/asset\/)/i,
  });
}

function selectedAnchor(root: HTMLElement): SelectionAnchor | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed)
    return null;
  const range = selection.getRangeAt(0);
  if (
    !root.contains(range.startContainer) ||
    !root.contains(range.endContainer)
  )
    return null;
  const startRange = document.createRange();
  startRange.selectNodeContents(root);
  startRange.setEnd(range.startContainer, range.startOffset);
  const start = startRange.toString().length;
  const exact = range.toString();
  if (!exact.trim()) return null;
  const end = start + exact.length;
  const content = root.textContent ?? "";
  const rect = range.getBoundingClientRect();
  return {
    exact,
    start,
    end,
    prefix: content.slice(Math.max(0, start - 32), start),
    suffix: content.slice(end, end + 32),
    x: Math.max(
      105,
      Math.min(window.innerWidth - 105, rect.left + rect.width / 2),
    ),
    y:
      rect.bottom + 110 > window.innerHeight
        ? Math.max(8, rect.top - 42)
        : rect.bottom + 8,
    range: range.cloneRange(),
  };
}

function ReaderBodyView({
  reader,
  bodyRef,
  onSelection,
  onHighlightClick,
  onNoteClick,
}: {
  reader: ReaderDocument;
  bodyRef: RefObject<HTMLDivElement | null>;
  onSelection(value: SelectionAnchor | null): void;
  onHighlightClick(ids: string[], anchor: SelectionAnchor): void;
  onNoteClick(id: string, anchor: SelectionAnchor): void;
}) {
  const html = useMemo(
    () =>
      renderLatexImages(
        annotateReaderHtml(safeHtml(reader.body), {
          highlights: reader.highlights,
          notes: reader.notes,
        }),
        document,
      ),
    [reader.body, reader.highlights, reader.notes],
  );
  if (reader.bodyState !== "ok")
    return (
      <div className="empty-state body-empty">
        <span className="empty-icon">
          {reader.bodyState === "corrupt" ? "!" : "∅"}
        </span>
        <strong>
          {reader.bodyState === "corrupt" ? "正文损坏" : "正文为空"}
        </strong>
        <span>该条内容没有可安全显示的离线正文。</span>
      </div>
    );
  return (
    <div
      ref={bodyRef}
      className="article-body"
      onMouseUp={() =>
        onSelection(bodyRef.current ? selectedAnchor(bodyRef.current) : null)
      }
      onClick={(event) => {
        const target = event.target as HTMLElement;
        const noteMark = target.closest<HTMLElement>("[data-note-ids]");
        const mark = target.closest<HTMLElement>("[data-highlight-ids]");
        const opensNote =
          noteMark?.classList.contains("reader-note-badge") ||
          (noteMark && !noteMark.dataset.highlightIds);
        if (
          (!mark && !noteMark) ||
          !bodyRef.current?.contains((opensNote ? noteMark : mark)!) ||
          window.getSelection()?.toString().trim()
        )
          return;
        if (opensNote && noteMark) {
          const id = (noteMark.dataset.noteIds ?? "")
            .split(/\s+/)
            .find(Boolean);
          const note = reader.notes.find((item) => item.id === id);
          if (!note) return;
          const rect = noteMark.getBoundingClientRect();
          onNoteClick(note.id, {
            exact: note.exact,
            prefix: note.prefix,
            suffix: note.suffix,
            start: note.resolvedStart ?? note.start ?? 0,
            end: note.resolvedEnd ?? note.end ?? 0,
            x: Math.max(
              105,
              Math.min(window.innerWidth - 105, rect.left + rect.width / 2),
            ),
            y:
              rect.bottom + 180 > window.innerHeight
                ? Math.max(8, rect.top - 42)
                : rect.bottom + 8,
          });
          return;
        }
        if (!mark) return;
        const ids = (mark.dataset.highlightIds ?? "")
          .split(/\s+/)
          .filter(Boolean);
        const first = reader.highlights.find((item) => ids.includes(item.id));
        if (!first || !ids.length) return;
        const rect = mark.getBoundingClientRect();
        onHighlightClick(ids, {
          exact: first.exact || first.quote,
          prefix: first.prefix,
          suffix: first.suffix,
          start: first.resolvedStart ?? first.start ?? 0,
          end: first.resolvedEnd ?? first.end ?? 0,
          x: Math.max(
            105,
            Math.min(window.innerWidth - 105, rect.left + rect.width / 2),
          ),
          y:
            rect.bottom + 110 > window.innerHeight
              ? Math.max(8, rect.top - 42)
              : rect.bottom + 8,
        });
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export const ReaderBody = memo(
  ReaderBodyView,
  (before, after) =>
    before.reader === after.reader && before.bodyRef === after.bodyRef,
);
