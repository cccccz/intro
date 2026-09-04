import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  displayTitle,
  joinDoc,
  setMatterTitle,
  shortId,
  splitDoc,
  titleFromMatter,
  withTitle,
} from "./frontmatter.ts";

describe("displayTitle", () => {
  it("uses a manual title when set", () => {
    assert.equal(displayTitle({ id: "host01", title: "  Proof  ", medium: "text" }), "Proof");
    assert.equal(
      displayTitle({ id: "pdf01", title: "My paper", sourceName: "scan.pdf", medium: "pdf" }),
      "My paper",
    );
  });

  it("falls back to excerpt, then filename, then short id — not Untitled", () => {
    assert.equal(displayTitle({ id: "note01", title: "", medium: "text" }), "note01");
    assert.equal(displayTitle({ id: "note01", excerpt: " selected span ", medium: "text" }), "selected span");
    assert.equal(
      displayTitle({ id: "01HTESTID0000000000000000", medium: "text" }),
      "01HTESTI",
    );
    assert.equal(shortId("01HTESTID0000000000000000"), "01HTESTI");
    assert.equal(
      displayTitle({ id: "pdf01", sourceName: "paper.pdf", medium: "pdf" }),
      "paper.pdf",
    );
    assert.equal(displayTitle({ id: "pdf01", medium: "pdf" }), "pdf01");
  });
});

describe("YAML frontmatter title", () => {
  it("round-trips title at the top of the same .intro.md and leaves the body", () => {
    const marked = '<<r id="rv1" to="side01">>宿主<</r id="rv1">>正文';
    const withFm = withTitle(marked, "  Proof sketch  ");
    assert.match(withFm, /^---\ntitle: Proof sketch\n---\n/);
    assert.ok(withFm.endsWith(marked));
    const split = splitDoc(withFm);
    assert.equal(split.body, marked);
    assert.equal(titleFromMatter(split.matterLines), "Proof sketch");
    assert.equal(splitDoc(joinDoc(split)).body, marked);
  });

  it("preserves extra matter keys when the title changes", () => {
    const raw = "---\ntitle: Old\ndraft: true\n---\nbody <<r id=\"a\">>x<</r id=\"a\">>";
    const next = withTitle(raw, "New: name");
    const split = splitDoc(next);
    assert.equal(titleFromMatter(split.matterLines), "New: name");
    assert.ok(split.matterLines.some((line) => line.startsWith("draft:")));
    assert.match(split.body, /<<r id="a">>/);
    assert.equal(withTitle(next, "   "), "---\ndraft: true\n---\n" + split.body);
  });

  it("drops the fence when the last key is a blank title", () => {
    const raw = withTitle("hello", "Temp");
    assert.equal(withTitle(raw, ""), "hello");
    assert.deepEqual(setMatterTitle(["title: X"], undefined), []);
  });

  it("does not treat a body that merely contains --- as frontmatter", () => {
    const body = "a line\n---\nnot matter\n";
    assert.deepEqual(splitDoc(body), { hasFrontmatter: false, matterLines: [], body });
  });
});
