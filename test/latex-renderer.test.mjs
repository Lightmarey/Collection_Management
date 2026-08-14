import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderLatexImages } from "../src/renderer/latex.ts";

test("renders Zhihu TeX image alternatives with KaTeX and MathML", () => {
  const dom = new JSDOM("");
  const html = renderLatexImages(
    '<p>A <img src="km-media://asset/formula.svg" alt="\\frac{x_1}{y^2}"> B</p>',
    dom.window.document,
  );
  assert.match(html, /class="latex-formula latex-inline"/);
  assert.match(html, /<math/);
  assert.match(html, /katex-html/);
  assert.doesNotMatch(html, /<img/);
  dom.window.close();
});

test("renders display delimiters and keeps SVG when TeX is invalid", () => {
  const dom = new JSDOM("");
  assert.match(
    renderLatexImages(
      '<img src="km-media://asset/formula.svg" alt="\\[x^2\\]">',
      dom.window.document,
    ),
    /latex-display/,
  );
  assert.match(
    renderLatexImages(
      '<img src="km-media://asset/formula.svg" alt="\\notacommand{">',
      dom.window.document,
    ),
    /<img/,
  );
  assert.match(
    renderLatexImages(
      '<p>公式 <img src="km-media://asset/formula.svg" alt="\\notacommand{"> 后文</p>',
      dom.window.document,
    ),
    /latex-inline-image/,
  );
  dom.window.close();
});

test("renders content-addressed and quoted inline formulas inline", () => {
  const dom = new JSDOM("");
  assert.match(
    renderLatexImages(
      '<p>自然常数 <img class="ee_img" src="km-media://asset/abcdef" alt="e"> 不变</p>',
      dom.window.document,
    ),
    /latex-inline/,
  );
  assert.match(
    renderLatexImages(
      '<blockquote><p>圆周率 <img src="km-media://asset/abcdef" alt="\\[\\pi\\]"> 写在句中</p></blockquote>',
      dom.window.document,
    ),
    /latex-inline/,
  );
  assert.doesNotMatch(
    renderLatexImages(
      '<p>圆周率 <img src="km-media://asset/abcdef" alt="\\[\\pi\\]"> 写在句中</p>',
      dom.window.document,
    ),
    /latex-display/,
  );
  assert.match(
    renderLatexImages(
      '<p>变量 <img src="km-media://asset/abcdef.svg" alt="x"> 仍在行内</p>',
      dom.window.document,
    ),
    /latex-inline/,
  );
  dom.window.close();
});
