import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { parse, strip } from "../marks/index.ts";
import { Library } from "../library/index.ts";
import { hangPdfSide, hangSide, persistClean, pieceView } from "./loop.ts";
import { HOST_EXT, OverlayError, isPdfMagic, minimalPdf } from "../pdf/index.ts";
import {
  ROOT_ID,
  closeNode,
  nodesAtDepth,
  openRoot,
  openSide,
} from "./session.ts";

const temps: string[] = [];

function tmpLibrary(): Library {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "intro-write-"));
  temps.push(root);
  return new Library(root);
}

afterEach(() => {
  for (const root of temps.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("M1 write loop on disk", () => {
  it("grows a nested rivet tree from clean text", () => {
    const lib = new Library(
      fs.mkdtempSync(path.join(os.tmpdir(), "intro-write-")),
    );
    temps.push(lib.root);

    const host = lib.createPiece({ id: "host01", body: "" });
    persistClean(lib, host.id, "宿主一段可以再挂侧边。");

    const first = hangSide(lib, host.id, { start: 0, end: 2 });
    assert.equal(strip(first.host.body), "宿主一段可以再挂侧边。");
    assert.equal(first.side.body, "");
    const hostTree = parse(lib.load("host01").body);
    assert.deepEqual(hostTree.damage, []);
    assert.equal(hostTree.rivets.length, 1);
    assert.equal(hostTree.rivets[0].to, first.side.id);
    assert.ok(fs.existsSync(first.side.path));

    persistClean(lib, first.side.id, "侧边再问一层。");
    const nested = hangSide(lib, first.side.id, { start: 0, end: 2 });
    const sideTree = parse(lib.load(first.side.id).body);
    assert.deepEqual(sideTree.damage, []);
    assert.equal(sideTree.rivets[0].to, nested.side.id);

    const view = pieceView(lib.load("host01"));
    assert.equal(view.clean, "宿主一段可以再挂侧边。");
    assert.equal(view.rivets[0].to, first.side.id);

    let columns = openRoot("host01");
    columns = openSide(columns, ROOT_ID, first.side.id, first.rivetId);
    columns = openSide(columns, first.rivetId, nested.side.id, nested.rivetId);
    assert.equal(columns.length, 3);
    columns = closeNode(columns, first.rivetId);
    assert.deepEqual(
      columns.map((c) => c.pieceId),
      ["host01"],
    );
    assert.ok(lib.resolve(first.side.id));
    assert.ok(lib.resolve(nested.side.id));
    assert.match(lib.load("host01").body, /<<r id="/);
  });

  it("hangs an existing side without creating a new file", () => {
    const lib = tmpLibrary();
    lib.createPiece({ id: "host01", body: "abcdef" });
    lib.createPiece({ id: "reuse01", body: "already there" });
    const hung = hangSide(lib, "host01", { start: 1, end: 4 }, { sideId: "reuse01" });
    assert.equal(hung.side.id, "reuse01");
    assert.equal(hung.side.body, "already there");
    assert.equal(parse(hung.host.body).rivets[0].to, "reuse01");
    assert.equal(lib.list().length, 2);
  });

  it("persistClean writes rivet mark syntax, not highlight HTML", () => {
    const lib = tmpLibrary();
    lib.createPiece({ id: "host01", body: "hello" });
    hangSide(lib, "host01", { start: 0, end: 5 });
    persistClean(lib, "host01", "hello");
    const body = lib.load("host01").body;
    assert.match(body, /<<r id="/);
    assert.doesNotMatch(body, /<mark/);
    assert.doesNotMatch(body, /data-rivet/);
  });

  it("persistClean keeps markdown source and <<r>> marks, not rendered HTML", () => {
    const lib = tmpLibrary();
    lib.createPiece({ id: "host01", body: "" });
    persistClean(lib, "host01", "# Hi\n\n**bold**");
    hangSide(lib, "host01", { start: 8, end: 12 });
    const body = lib.load("host01").body;
    assert.match(body, /# Hi/);
    assert.match(body, /<<r id="[^"]+"[^>]*>>bold<<\/r id="/);
    assert.doesNotMatch(body, /<h1>|<strong>|<mark/);
    assert.equal(strip(body), "# Hi\n\n**bold**");
    assert.deepEqual(parse(body).damage, []);
  });

  it("keeps fitting rivets when clean text is only appended", () => {
    const lib = tmpLibrary();
    lib.createPiece({ id: "host01", body: "hello" });
    hangSide(lib, "host01", { start: 0, end: 5 });
    persistClean(lib, "host01", "hello world");
    const view = pieceView(lib.load("host01"));
    assert.equal(view.clean, "hello world");
    assert.equal(view.rivets.length, 1);
    assert.equal(view.rivets[0].start, 0);
    assert.equal(view.rivets[0].end, 5);
  });

  it("two host rivets stack at d1; hanging from one side opens d2", () => {
    const lib = tmpLibrary();
    lib.createPiece({ id: "host01", body: "alpha beta" });
    const a = hangSide(lib, "host01", { start: 0, end: 5 });
    const b = hangSide(lib, "host01", { start: 6, end: 10 });
    persistClean(lib, a.side.id, "from alpha");
    const nested = hangSide(lib, a.side.id, { start: 0, end: 4 });
    const host = parse(lib.load("host01").body);
    assert.equal(host.rivets.length, 2);
    let nodes = openRoot("host01");
    nodes = openSide(nodes, ROOT_ID, a.side.id, a.rivetId);
    nodes = openSide(nodes, ROOT_ID, b.side.id, b.rivetId);
    nodes = openSide(nodes, a.rivetId, nested.side.id, nested.rivetId);
    assert.equal(nodesAtDepth(nodes, 1).length, 2);
    assert.deepEqual(
      nodesAtDepth(nodes, 2).map((n) => n.pieceId),
      [nested.side.id],
    );
  });
});

describe("open session", () => {
  it("stacks same-depth sides and opens the next depth from a side", () => {
    const root = openRoot("a");
    const one = openSide(root, ROOT_ID, "b", "r1");
    const stacked = openSide(one, ROOT_ID, "c", "r2");
    assert.deepEqual(
      stacked.map((n) => [n.pieceId, n.depth]),
      [
        ["a", 0],
        ["b", 1],
        ["c", 1],
      ],
    );
    const nested = openSide(stacked, "r1", "d", "r3");
    assert.equal(nodesAtDepth(nested, 1).length, 2);
    assert.deepEqual(
      nodesAtDepth(nested, 2).map((n) => n.pieceId),
      ["d"],
    );
    assert.deepEqual(openSide(nested, "r1", "d", "r3").map((n) => n.id), nested.map((n) => n.id));
  });

  it("closeNode drops the subtree and leaves a same-layer sibling", () => {
    const stacked = openSide(openSide(openRoot("a"), ROOT_ID, "b", "r1"), ROOT_ID, "c", "r2");
    const nested = openSide(stacked, "r1", "d", "r3");
    assert.deepEqual(
      closeNode(nested, "r1").map((n) => n.pieceId),
      ["a", "c"],
    );
    assert.deepEqual(closeNode(nested, ROOT_ID), []);
  });
});

describe("PDF overlay hang", () => {
  it("hangs a text side from page+rect without mutating the PDF", () => {
    const lib = tmpLibrary();
    const src = path.join(lib.root, "in.pdf");
    const bytes = minimalPdf("do not write annots");
    fs.writeFileSync(src, bytes);
    const host = lib.attachPdf(src, { id: "pdf01" });
    const before = Buffer.from(lib.readPdfBytes("pdf01"));

    const hung = hangPdfSide(
      lib,
      "pdf01",
      [{ page: 1, rect: { x: 72, y: 680, width: 180, height: 20 } }],
      { quote: "intro PDF host" },
    );
    assert.equal(hung.host.medium, "pdf");
    assert.equal(hung.side.medium, "text");
    assert.match(hung.side.path, /\.intro\.md$/);
    assert.equal(hung.side.body, "");
    const overlay = hung.host.medium === "pdf" ? hung.host.overlay : null;
    assert.equal(overlay?.rivets.length, 1);
    assert.equal(overlay?.rivets[0].id, hung.rivetId);
    assert.equal(overlay?.rivets[0].to, hung.side.id);
    assert.equal(overlay?.rivets[0].anchors[0].page, 1);
    assert.equal("start" in (overlay?.rivets[0] ?? {}), false);

    assert.deepEqual(Buffer.from(lib.readPdfBytes("pdf01")), before);
    assert.ok(isPdfMagic(lib.readPdfBytes("pdf01")));
    assert.equal(fs.readFileSync(host.pdfPath).equals(bytes), true);
    assert.doesNotMatch(fs.readFileSync(host.path, "utf8"), /<<r /);
    assert.match(host.path, new RegExp(`${HOST_EXT.replace(".", "\\.")}$`));

    persistClean(lib, hung.side.id, "side note on the region");
    const nested = hangSide(lib, hung.side.id, { start: 0, end: 4 });
    assert.match(lib.load(hung.side.id).body, /<<r id="/);
    assert.equal(nested.side.medium, "text");

    const view = pieceView(lib.load("pdf01"));
    assert.equal(view.medium, "pdf");
    assert.equal(view.clean, "");
    assert.deepEqual(view.rivets, []);
    assert.equal(view.overlayRivets[0].to, hung.side.id);

    let nodes = openRoot("pdf01");
    nodes = openSide(nodes, ROOT_ID, hung.side.id, hung.rivetId);
    nodes = openSide(nodes, hung.rivetId, nested.side.id, nested.rivetId);
    assert.equal(nodesAtDepth(nodes, 1).length, 1);
    assert.equal(nodesAtDepth(nodes, 2)[0]?.pieceId, nested.side.id);
  });

  it("refuses text-offset hang/persist on a PDF host", () => {
    const lib = tmpLibrary();
    const src = path.join(lib.root, "in.pdf");
    fs.writeFileSync(src, minimalPdf());
    lib.attachPdf(src, { id: "pdf01" });
    assert.throws(() => persistClean(lib, "pdf01", "nope"), OverlayError);
    assert.throws(() => hangSide(lib, "pdf01", { start: 0, end: 1 }), OverlayError);
    assert.throws(
      () => hangPdfSide(lib, "pdf01", [{ page: 1, rect: { x: 0, y: 0, width: 1, height: 1 } }], {
        sideId: "pdf01",
      }),
      OverlayError,
    );
  });
});
