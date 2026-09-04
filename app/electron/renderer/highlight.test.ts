import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { highlightHtml } from "./highlight.ts";

describe("highlightHtml", () => {
  it("escapes text when there are no rivets", () => {
    assert.equal(highlightHtml("a <b>", []), "a &lt;b&gt;\n");
  });

  it("wraps one span and marks the open rivet", () => {
    const html = highlightHtml("hello world", [{ id: "r1", start: 0, end: 5 }], ["r1"]);
    assert.equal(html, '<mark data-rivet="r1" class="open">hello</mark> world\n');
  });

  it("nests marks when ranges nest", () => {
    const html = highlightHtml("hello world", [
      { id: "outer", start: 0, end: 11 },
      { id: "inner", start: 6, end: 11 },
    ]);
    assert.equal(
      html,
      '<mark data-rivet="outer">hello <mark data-rivet="inner">world</mark></mark>\n',
    );
  });

  it("places adjacent marks without overlap", () => {
    const html = highlightHtml("abcdef", [
      { id: "a", start: 0, end: 3 },
      { id: "b", start: 3, end: 6 },
    ]);
    assert.equal(
      html,
      '<mark data-rivet="a">abc</mark><mark data-rivet="b">def</mark>\n',
    );
  });

  it("marks several open rivets in one host", () => {
    const html = highlightHtml(
      "abcdef",
      [
        { id: "a", start: 0, end: 3 },
        { id: "b", start: 3, end: 6 },
      ],
      ["a", "b"],
    );
    assert.equal(
      html,
      '<mark data-rivet="a" class="open">abc</mark><mark data-rivet="b" class="open">def</mark>\n',
    );
  });

  it("skips ranges that no longer fit the clean text", () => {
    assert.equal(
      highlightHtml("ab", [{ id: "gone", start: 0, end: 5 }]),
      "ab\n",
    );
  });

  it("source view does not run markdown", () => {
    const html = highlightHtml("# **x**", [{ id: "r1", start: 2, end: 7 }]);
    assert.equal(html, '# <mark data-rivet="r1">**x**</mark>\n');
    assert.doesNotMatch(html, /<h1>|<strong>/);
  });
});
