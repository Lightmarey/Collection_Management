import katex from "katex";

function formula(value: string, inlineContext = false) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\\[") && trimmed.endsWith("\\]")) ||
    (trimmed.startsWith("$$") && trimmed.endsWith("$$"))
  )
    return {
      display: !inlineContext,
      source: trimmed.slice(2, -2).trim(),
    };
  if (trimmed.startsWith("\\(") && trimmed.endsWith("\\)"))
    return { display: false, source: trimmed.slice(2, -2).trim() };
  if (trimmed.startsWith("$") && trimmed.endsWith("$"))
    return { display: false, source: trimmed.slice(1, -1).trim() };
  return { display: false, source: trimmed };
}

export function renderLatexImages(html: string, document: Document) {
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const image of Array.from(template.content.querySelectorAll("img"))) {
    const alt = image.getAttribute("alt") ?? "";
    const source = image.getAttribute("src") ?? "";
    const likelyFormulaAlt =
      /[\\$_^{}=+*/()[\]]/.test(alt) ||
      /^[A-Za-z0-9.+\-]{1,24}$/.test(alt.trim());
    const localFormulaSvg =
      /^km-media:\/\/asset\/[^?]+\.svg(?:\?|$)/i.test(source) &&
      likelyFormulaAlt;
    if (
      !image.classList.contains("ee_img") &&
      !image.hasAttribute("eeimg") &&
      !localFormulaSvg &&
      !/\\[A-Za-z]+|[_^{}]/.test(alt)
    )
      continue;
    const inlineContext = [image.previousSibling, image.nextSibling].some(
      (node) => Boolean(node?.textContent?.trim()),
    );
    const parsed = formula(alt, inlineContext);
    try {
      const node = document.createElement(parsed.display ? "div" : "span");
      node.className = parsed.display
        ? "latex-formula latex-display"
        : "latex-formula latex-inline";
      node.setAttribute("role", "math");
      node.setAttribute("aria-label", alt);
      node.innerHTML = katex.renderToString(parsed.source, {
        displayMode: parsed.display,
        output: "htmlAndMathml",
        throwOnError: true,
        trust: false,
        strict: "ignore",
      });
      image.replaceWith(node);
    } catch {
      // Keep the sanitized local SVG as the lossless fallback.
      image.classList.add(
        parsed.display ? "latex-display-image" : "latex-inline-image",
      );
    }
  }
  return template.innerHTML;
}
