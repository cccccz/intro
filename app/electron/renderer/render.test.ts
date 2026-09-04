import assert from "node:assert/strict";
import { describe, it } from "node:test";
import markdownit from "markdown-it";
import {
  fallbackMath,
  markupMarkdown,
  renderHtml,
  sanitizeHtml,
  setMarkdownIt,
} from "./render.ts";

setMarkdownIt(markdownit as unknown as Parameters<typeof setMarkdownIt>[0]);

describe("markupMarkdown", () => {
  it("escapes HTML", () => {
    assert.equal(markupMarkdown("a <b>"), "<p>a &lt;b&gt;</p>\n");
  });

  it("renders headings, lists, bold, italic, and inline code", () => {
    assert.match(markupMarkdown("# Title"), /<h1>Title<\/h1>/);
    assert.match(markupMarkdown("## Head"), /<h2>Head<\/h2>/);
    assert.match(markupMarkdown("- item"), /<ul>\n<li>item<\/li>\n<\/ul>/);
    assert.match(markupMarkdown("**bold**"), /<p><strong>bold<\/strong><\/p>/);
    assert.match(markupMarkdown("*em*"), /<p><em>em<\/em><\/p>/);
    assert.match(markupMarkdown("`x < y`"), /<p><code>x &lt; y<\/code><\/p>/);
  });

  it("renders fenced code without interpreting inner markup", () => {
    const html = markupMarkdown("```js\n**x** $a$\n```");
    assert.match(html, /<pre><code class="language-js">/);
    assert.match(html, /\*\*x\*\*/);
    assert.match(html, /\$a\$/);
    assert.doesNotMatch(html, /<strong>/);
    assert.doesNotMatch(html, /class="tex"/);
  });

  it("renders links and drops javascript hrefs", () => {
    assert.match(
      markupMarkdown("see [ex](https://example.com)"),
      /<a href="https:\/\/example.com">ex<\/a>/,
    );
    const unsafe = markupMarkdown("[x](javascript:alert(1))");
    assert.doesNotMatch(unsafe, /<a\b/i);
    assert.match(unsafe, /javascript:alert\(1\)/);
  });

  it("does not treat ** inside code as bold", () => {
    assert.match(markupMarkdown("`**x**`"), /<code>\*\*x\*\*<\/code>/);
  });

  it("wraps $...$ and $$...$$ via the math renderer", () => {
    const math = (tex: string, display: boolean) => `[${display ? "D" : "I"}:${tex}]`;
    assert.equal(markupMarkdown("see $a+b$ here", math), "<p>see [I:a+b] here</p>\n");
    assert.match(markupMarkdown("$$x^2$$", math), /\[D:x\^2\]/);
    assert.match(markupMarkdown("$$\nz^2\n$$", math), /\[D:z\^2\n?\]/);
  });

  it("leaves unmatched $ as text", () => {
    assert.equal(markupMarkdown("cost $5"), "<p>cost $5</p>\n");
  });

  it("fallbackMath escapes TeX", () => {
    assert.equal(fallbackMath("a<b", false), '<span class="tex">a&lt;b</span>');
    assert.equal(fallbackMath("x", true), '<div class="tex display">x</div>');
  });
});

describe("sanitizeHtml", () => {
  it("strips scripts and event handlers", () => {
    assert.equal(sanitizeHtml('<p onclick="x">ok</p><script>alert(1)</script>'), "<p>ok</p>");
  });

  it("drops unsafe hrefs", () => {
    assert.equal(sanitizeHtml('<p><a href="javascript:alert(1)">x</a></p>'), "<p>x</p>");
  });
});

describe("renderHtml", () => {
  it("wraps rivet ranges so geometry can still find them", () => {
    const html = renderHtml("hello world", [{ id: "r1", start: 0, end: 5 }], ["r1"]);
    assert.equal(html, '<p><mark data-rivet="r1" class="open">hello</mark> world</p>\n');
  });

  it("renders markup inside and outside a rivet", () => {
    const html = renderHtml("see **x** and *y*", [{ id: "r1", start: 4, end: 9 }]);
    assert.equal(
      html,
      "<p>see <mark data-rivet=\"r1\"><strong>x</strong></mark> and <em>y</em></p>\n",
    );
  });

  it("keeps a heading rivet identifiable after real markdown", () => {
    const html = renderHtml("# Hello world", [{ id: "r1", start: 2, end: 7 }]);
    assert.equal(html, '<h1><mark data-rivet="r1">Hello</mark> world</h1>\n');
  });

  it("keeps TeX as source-shaped math, not a second SoT", () => {
    const html = renderHtml("phi $x$ end", [{ id: "r1", start: 4, end: 7 }]);
    assert.equal(
      html,
      '<p>phi <mark data-rivet="r1"><span class="tex">x</span></mark> end</p>\n',
    );
  });

  it("is a projection: highlight markup is not a persist format", () => {
    const html = renderHtml("hello", [{ id: "r1", start: 0, end: 5 }]);
    assert.match(html, /<mark data-rivet="r1">/);
    assert.doesNotMatch(html, /<<r /);
  });
});
