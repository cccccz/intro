import assert from "node:assert/strict";
import { describe, it } from "node:test";
import markdownit from "markdown-it";
import { add, flattenRivetSpecs, parse, strip } from "../../marks/index.ts";
import {
  fallbackMath,
  hasMarkDelimiters,
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

/** Rivets first (parse/strip), then markdown on clean text. */
function renderFromMarked(body: string, openIds: readonly string[] = []): string {
  const parsed = parse(body);
  return renderHtml(strip(body), flattenRivetSpecs(parsed.rivets), openIds);
}

describe("rivets first, then markdown", () => {
  it("detects 做法 A delimiters", () => {
    assert.equal(hasMarkDelimiters('<<r id="r1">>x<</r id="r1">>'), true);
    assert.equal(hasMarkDelimiters("**hello**"), false);
    assert.equal(hasMarkDelimiters("# Title"), false);
  });

  it("parses marks on the tagged body; markdown only sees strip()", () => {
    const clean = "see **x** and *y*";
    const body = add(clean, [{ id: "r1", start: 4, end: 9 }]);
    assert.equal(hasMarkDelimiters(body), true);
    assert.equal(hasMarkDelimiters(strip(body)), false);
    assert.equal(strip(body), clean);
    assert.deepEqual(parse(body).damage, []);

    const html = renderFromMarked(body);
    assert.doesNotMatch(html, /<<r/);
    assert.equal(
      html,
      "<p>see <mark data-rivet=\"r1\"><strong>x</strong></mark> and <em>y</em></p>\n",
    );
  });

  it("does not let ** wrap or split mark delimiters", () => {
    const clean = "**x**";
    const body = add(clean, [{ id: "r1", start: 2, end: 3 }]);
    assert.equal(body, '**<<r id="r1">>x<</r id="r1">>**');
    assert.deepEqual(parse(body).damage, []);
    assert.equal(strip(body), clean);

    const html = renderFromMarked(body);
    assert.equal(html, '<p><strong><mark data-rivet="r1">x</mark></strong></p>\n');
    assert.doesNotMatch(html, /<<r/);
    assert.doesNotMatch(html, /&lt;&lt;r/);
  });

  it("does not let # split a rivet that sits in a heading", () => {
    const clean = "# Hello";
    const body = add(clean, [{ id: "r1", start: 2, end: 7 }]);
    assert.equal(body, '# <<r id="r1">>Hello<</r id="r1">>');
    assert.equal(strip(body), clean);

    const html = renderFromMarked(body);
    assert.equal(html, '<h1><mark data-rivet="r1">Hello</mark></h1>\n');
    assert.doesNotMatch(html, /<<r/);
  });

  it("keeps nested rivets after markdown", () => {
    const clean = "outer inner end";
    const body = add(clean, [
      { id: "outer", start: 0, end: 11 },
      { id: "inner", start: 6, end: 11 },
    ]);
    const html = renderFromMarked(body, ["inner"]);
    assert.equal(
      html,
      '<p><mark data-rivet="outer">outer <mark data-rivet="inner" class="open">inner</mark></mark> end</p>\n',
    );
  });
});
