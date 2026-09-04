import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { add, parse, strip } from "../marks/index.ts";
import { HOST_EXT, OVERLAY_EXT, isPdfMagic, minimalPdf } from "../pdf/index.ts";
import { OverlayError } from "../pdf/overlay.ts";
import { Library } from "./library.ts";
import { PIECE_EXT } from "./types.ts";

const temps: string[] = [];

function tmpLibrary(): Library {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "intro-lib-"));
  temps.push(root);
  return new Library(root);
}

afterEach(() => {
  for (const root of temps.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("library on disk", () => {
  it("creates a piece as {id}.intro.md and resolves id to path", () => {
    const lib = tmpLibrary();
    const piece = lib.createPiece({ id: "host01", body: "正文" });
    assert.equal(piece.id, "host01");
    assert.equal(path.basename(piece.path), `host01${PIECE_EXT}`);
    assert.equal(lib.resolve("host01"), piece.path);
    assert.equal(lib.load("host01").body, "正文");
  });

  it("round-trips load/save of a marked body", () => {
    const lib = tmpLibrary();
    const clean = "宿主一段可以再挂侧边。";
    const marked = add(clean, [{ id: "rv1", to: "side01", start: 0, end: 2 }]);
    lib.createPiece({ id: "host01", body: marked });
    lib.createPiece({ id: "side01", body: "侧边" });

    const loaded = lib.load("host01");
    assert.equal(loaded.body, marked);
    assert.equal(strip(loaded.body), clean);
    assert.deepEqual(parse(loaded.body).damage, []);

    const updated = add(clean, [
      { id: "rv1", to: "side01", start: 0, end: 2 },
      { id: "rv2", to: "side01", start: 2, end: 4 },
    ]);
    lib.save("host01", updated);
    assert.equal(lib.load("host01").body, updated);
    assert.equal(strip(lib.load("host01").body), clean);
  });

  it("resolves a piece in a subdirectory", () => {
    const lib = tmpLibrary();
    const nested = lib.createPiece({
      id: "noteA",
      dir: "drafts",
      body: "nested",
    });
    assert.ok(nested.path.includes(`${path.sep}drafts${path.sep}`));
    assert.equal(lib.resolve("noteA"), nested.path);
    assert.equal(lib.load("noteA").body, "nested");
  });

  it("generates a ULID when id is omitted", () => {
    const lib = tmpLibrary();
    const piece = lib.createPiece({ body: "" });
    assert.match(piece.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
    assert.ok(lib.resolve(piece.id));
  });

  it("lists piece ids without reading bodies", () => {
    const lib = tmpLibrary();
    lib.createPiece({ id: "b", body: "keep-out-of-list-io" });
    lib.createPiece({ id: "a", dir: "drafts", body: "also" });
    assert.deepEqual(
      lib.list().map((p) => p.id),
      ["a", "b"],
    );
    assert.ok(lib.list()[0].path.includes(`${path.sep}drafts${path.sep}`));
  });
});

describe("display titles", () => {
  it("writes YAML frontmatter in the same .intro.md and keeps mark body", () => {
    const lib = tmpLibrary();
    const piece = lib.createPiece({ id: "note01", body: "hello", title: " First note " });
    assert.equal(piece.title, "First note");
    assert.equal(piece.titled, true);
    assert.equal(lib.load("note01").body, "hello");
    const disk = fs.readFileSync(path.join(lib.root, "note01.intro.md"), "utf8");
    assert.match(disk, /^---\ntitle: First note\n---\nhello$/);
    assert.equal(fs.existsSync(path.join(lib.root, "note01.intro.meta.json")), false);
  });

  it("renames via frontmatter without changing id, filename, or rivet marks", () => {
    const lib = tmpLibrary();
    const marked = add("宿主正文", [{ id: "rv1", to: "side01", start: 0, end: 2 }]);
    lib.createPiece({ id: "host01", body: marked });
    const before = lib.load("host01").body;
    const saved = lib.saveTitle("host01", "  Proof sketch  ");
    assert.equal(saved.medium, "text");
    assert.equal(saved.id, "host01");
    assert.equal(path.basename(saved.path), "host01.intro.md");
    assert.equal(saved.title, "Proof sketch");
    assert.equal(lib.load("host01").body, before);
    assert.match(lib.load("host01").body, /<<r id="rv1"/);
    const raw = fs.readFileSync(path.join(lib.root, "host01.intro.md"), "utf8");
    assert.match(raw, /^---\ntitle: Proof sketch\n---\n/);
    assert.ok(raw.endsWith(marked) || raw.includes(marked));
    assert.equal(fs.existsSync(path.join(lib.root, "host01.intro.meta.json")), false);
    assert.equal(lib.list().find((p) => p.id === "host01")?.title, "Proof sketch");
  });

  it("falls back to short id; PDF defaults to the filename; sides use frontmatter", () => {
    const lib = tmpLibrary();
    lib.createPiece({ id: "note01", body: "x" });
    assert.equal(lib.load("note01").title, "note01");
    assert.equal(lib.load("note01").titled, false);
    lib.saveTitle("note01", "   ");
    assert.equal(lib.load("note01").title, "note01");
    assert.equal(fs.readFileSync(path.join(lib.root, "note01.intro.md"), "utf8"), "x");
    const src = path.join(lib.root, "paper.pdf");
    fs.writeFileSync(src, minimalPdf());
    const host = lib.attachPdf(src, { id: "pdf01" });
    assert.equal(host.title, "paper.pdf");
    assert.equal(host.titled, false);
    const renamed = lib.saveTitle("pdf01", "Levy processes");
    assert.equal(renamed.title, "Levy processes");
    assert.equal(renamed.titled, true);
    assert.equal(path.basename(renamed.path), "pdf01.intro.host.json");
    assert.equal(lib.load("pdf01").title, "Levy processes");
    assert.ok(isPdfMagic(lib.readPdfBytes("pdf01")));
    assert.equal(fs.existsSync(path.join(lib.root, "pdf01.intro.md")), false);
    assert.equal(fs.existsSync(path.join(lib.root, "pdf01.intro.meta.json")), false);
  });
});

describe("PDF host on disk", () => {
  it("copies a PDF and writes host + overlay sidecars, not an .intro.md body", () => {
    const lib = tmpLibrary();
    const src = path.join(lib.root, "_incoming.pdf");
    const bytes = minimalPdf("sample host");
    fs.writeFileSync(src, bytes);
    const host = lib.attachPdf(src, { id: "host01" });
    assert.equal(host.medium, "pdf");
    assert.equal(host.body, "");
    assert.equal(path.basename(host.path), `host01${HOST_EXT}`);
    assert.equal(path.basename(host.pdfPath), "host01.pdf");
    assert.equal(path.basename(host.overlayPath), `host01${OVERLAY_EXT}`);
    assert.deepEqual(host.overlay.rivets, []);
    assert.ok(isPdfMagic(fs.readFileSync(host.pdfPath)));
    assert.equal(fs.readFileSync(host.pdfPath).equals(Buffer.from(bytes)), true);
    assert.equal(lib.resolve("host01"), host.path);
    assert.equal(lib.list().find((p) => p.id === "host01")?.medium, "pdf");
    assert.equal(lib.list().find((p) => p.id === "host01")?.title, "_incoming.pdf");
    assert.equal(host.title, "_incoming.pdf");
    assert.equal(fs.existsSync(path.join(lib.root, "host01.intro.md")), false);
  });

  it("refuses to save text marks onto a PDF host", () => {
    const lib = tmpLibrary();
    const src = path.join(lib.root, "in.pdf");
    fs.writeFileSync(src, minimalPdf());
    lib.attachPdf(src, { id: "host01" });
    assert.throws(() => lib.save("host01", "not a mark host"), OverlayError);
    assert.ok(isPdfMagic(lib.readPdfBytes("host01")));
  });
});
