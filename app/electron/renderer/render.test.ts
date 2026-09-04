import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fallbackMath, markupInline, renderHtml } from "./render.ts";

describe("markupInline", () => {
  it("escapes HTML", () => {
    assert.equal(markupInline("a <b>"), "a &lt;b&gt;");
  });

  it("marks bold, italic, code, headings, and lists", () => {
    assert.equal(markupInline("**bold**"), "<strong>bold</strong>");
    assert.equal(markupInline("*em*"), "<em>em</em>");
    assert.equal(markupInline("`x < y`"), "<code>x &lt; y</code>");
    assert.equal(markupInline("# Title"), '<strong class="h1">Title</strong>');
    assert.equal(markupInline("## Head"), '<strong class="h2">Head</strong>');
    assert.equal(markupInline("- item"), '<span class="li">item</span>');
  });

  it("does not treat ** inside code as bold", () => {
    assert.equal(markupInline("`**x**`"), "<code>**x**</code>");
  });

  it("wraps $...$ and $$...$$ via the math renderer", () => {
    const math = (tex: string, display: boolean) =>
      `[${display ? "D" : "I"}:${tex}]`;
    assert.equal(markupInline("see $a+b$ here", math), "see [I:a+b] here");
    assert.equal(markupInline("$$x^2$$", math), "[D:x^2]");
  });

  it("leaves unmatched $ as text", () => {
    assert.equal(markupInline("cost $5"), "cost $5");
  });

  it("fallbackMath escapes TeX", () => {
    assert.equal(fallbackMath("a<b", false), '<span class="tex">a&lt;b</span>');
    assert.equal(fallbackMath("x", true), '<div class="tex display">x</div>');
  });
});

describe("renderHtml", () => {
  it("wraps rivet ranges so geometry can still find them", () => {
    const html = renderHtml("hello world", [{ id: "r1", start: 0, end: 5 }], ["r1"]);
    assert.equal(html, '<mark data-rivet="r1" class="open">hello</mark> world');
  });

  it("renders markup inside and outside a rivet", () => {
    const html = renderHtml("see **x** and *y*", [{ id: "r1", start: 4, end: 9 }]);
    assert.equal(
      html,
      'see <mark data-rivet="r1"><strong>x</strong></mark> and <em>y</em>',
    );
  });

  it("keeps TeX as source-shaped math, not a second SoT", () => {
    const html = renderHtml("phi $x$ end", [{ id: "r1", start: 4, end: 7 }]);
    assert.equal(
      html,
      'phi <mark data-rivet="r1"><span class="tex">x</span></mark> end',
    );
  });
});
