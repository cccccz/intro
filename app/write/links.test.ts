import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { Library } from "../library/index.ts";
import { minimalPdf } from "../pdf/index.ts";
import { libraryLinks } from "./links.ts";
import { hangPdfSide, hangSide } from "./loop.ts";

const temps: string[] = [];

function tmpLibrary(): Library {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "intro-links-"));
  temps.push(root);
  return new Library(root);
}

afterEach(() => {
  for (const root of temps.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("library links", () => {
  it("lists text and PDF hangs without writing anything", () => {
    const lib = tmpLibrary();
    const clean = "第一句挂侧边。第二句也挂。";
    lib.createPiece({ id: "host01", body: clean });
    const first = hangSide(lib, "host01", { start: 0, end: 3 });
    const reuse = hangSide(lib, "host01", { start: 7, end: 10 }, { sideId: first.side.id });
    const src = path.join(lib.root, "in.pdf");
    fs.writeFileSync(src, minimalPdf());
    lib.attachPdf(src, { id: "pdf01" });
    fs.rmSync(src);
    const pdf = hangPdfSide(lib, "pdf01", [{ page: 1, rect: { x: 10, y: 500, width: 80, height: 20 } }], { sideId: first.side.id });
    const before = fs.readdirSync(lib.root).sort();

    const links = libraryLinks(lib);
    assert.deepEqual(fs.readdirSync(lib.root).sort(), before);
    const toSide = links.filter((link) => link.sideId === first.side.id);
    assert.equal(toSide.length, 3);
    assert.deepEqual(
      toSide.filter((link) => link.hostId === "host01").map((link) => [link.rivetId, link.excerpt]).sort(),
      [[first.rivetId, "第一句"], [reuse.rivetId, "第二句"]].sort(),
    );
    const onPdf = toSide.find((link) => link.hostId === "pdf01")!;
    assert.equal(onPdf.rivetId, pdf.rivetId);
    assert.equal(onPdf.page, 1);
  });

  it("skips a damaged piece instead of failing the whole library", () => {
    const lib = tmpLibrary();
    lib.createPiece({ id: "good01", body: "好的" });
    hangSide(lib, "good01", { start: 0, end: 2 });
    fs.writeFileSync(path.join(lib.root, "bad01.intro.host.json"), "{ not json");
    const links = libraryLinks(lib);
    assert.equal(links.length, 1);
    assert.equal(links[0]!.hostId, "good01");
  });
});
