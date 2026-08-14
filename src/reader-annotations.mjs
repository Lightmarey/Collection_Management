const COLORS = new Set(["yellow", "blue", "green", "pink"]);

function resolved(annotation) {
  const start = Number(annotation?.resolvedStart);
  const end = Number(annotation?.resolvedEnd);
  return annotation?.status === "resolved" &&
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 0 &&
    end > start
    ? { ...annotation, start, end }
    : null;
}

function noteBadge(document, note) {
  const badge = document.createElement("button");
  badge.type = "button";
  badge.className = "reader-note-badge";
  badge.dataset.readerNote = note.id;
  badge.dataset.noteIds = note.id;
  badge.dataset.noteBody = note.body;
  badge.title = note.body;
  badge.setAttribute("aria-label", `批注：${note.body}`);
  return badge;
}

export function annotateReaderHtml(
  html,
  annotations = {},
  document = globalThis.document,
) {
  const root = document.createElement("div");
  root.innerHTML = html;
  const highlights = (annotations.highlights ?? [])
    .map(resolved)
    .filter(Boolean);
  const notes = (annotations.notes ?? [])
    .map(resolved)
    .filter((note) => note?.body);
  const walker = document.createTreeWalker(root, 4);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  let offset = 0;
  for (const node of nodes) {
    const start = offset;
    const end = start + node.data.length;
    offset = end;
    const nodeHighlights = highlights.filter(
      (item) => item.start < end && item.end > start,
    );
    const nodeNotes = notes.filter(
      (item) => item.start < end && item.end > start,
    );
    if (!nodeHighlights.length && !nodeNotes.length) continue;

    const boundaries = new Set([0, node.data.length]);
    for (const item of [...nodeHighlights, ...nodeNotes]) {
      boundaries.add(Math.max(0, item.start - start));
      boundaries.add(Math.min(node.data.length, item.end - start));
    }
    const points = [...boundaries].sort((left, right) => left - right);
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < points.length - 1; index += 1) {
      const from = points[index];
      const to = points[index + 1];
      if (to <= from) continue;
      const absoluteStart = start + from;
      const absoluteEnd = start + to;
      const activeHighlights = nodeHighlights.filter(
        (item) => item.start < absoluteEnd && item.end > absoluteStart,
      );
      const activeNotes = nodeNotes.filter(
        (item) => item.start < absoluteEnd && item.end > absoluteStart,
      );
      const text = document.createTextNode(node.data.slice(from, to));
      if (activeHighlights.length || activeNotes.length) {
        const mark = document.createElement("mark");
        mark.className = "reader-annotation";
        if (activeHighlights.length) {
          const color = COLORS.has(activeHighlights.at(-1).color)
            ? activeHighlights.at(-1).color
            : "yellow";
          mark.classList.add(`reader-highlight-${color}`);
          mark.dataset.highlightIds = activeHighlights
            .map((item) => item.id)
            .join(" ");
        }
        if (activeNotes.length) {
          mark.classList.add("reader-note-anchor");
          mark.dataset.noteIds = activeNotes.map((item) => item.id).join(" ");
        }
        mark.append(text);
        fragment.append(mark);
      } else fragment.append(text);
      for (const note of nodeNotes.filter((item) => item.end === absoluteEnd))
        fragment.append(noteBadge(document, note));
    }
    node.replaceWith(fragment);
  }
  return root.innerHTML;
}
