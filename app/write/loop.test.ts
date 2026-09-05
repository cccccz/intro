import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { parse, strip } from "../marks/index.ts";
import { Library } from "../library/index.ts";
import { editExcerpt, detachSide, dropSide, hangPdfSide, hangSide, persistClean, pieceView } from "./loop.ts";
import { HOST_EXT, OverlayError, isPdfMagic, minimalPdf } from "../pdf/index.ts";
import {
  ROOT_ID,
  closeNode,
  nodesAtDepth,
  openRoot,
  openSide,
} from "./session.ts";
import { relocateAnchors } from "./anchor-edits.ts";
import { inputChange, batchTo } from "../electron/renderer/input-edits.ts";

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
  it("relocates nested formula anchors across edits and reopen without changing side IDs", () => {
    const lib = tmpLibrary();
    const text = String.raw`before $$x+\frac{b}{c}$$ after`;
    const host = lib.createPiece({title:"Math title",body:text});
    const b = text.indexOf("{b}")+1;
    const outer = hangSide(lib,host.id,{start:text.indexOf("x+"),end:text.indexOf("$$ after")});
    const inner = hangSide(lib,host.id,{start:b,end:b+1});
    const inserted = "prefix "+text;
    persistClean(lib,host.id,inserted);
    let view = pieceView(new Library(lib.root).load(host.id));
    assert.equal(view.title,"Math title");
    assert.equal(view.rivets.find(r=>r.id===inner.rivetId)!.start,b+7);
    const changed=inserted.slice(0,b+7)+"beta"+inserted.slice(b+8);
    persistClean(lib,host.id,changed,{expected:inserted,edits:[{start:b+7,end:b+8,text:"beta"}]});
    view=pieceView(lib.load(host.id));
    const anchor=view.rivets.find(r=>r.id===inner.rivetId)!;
    assert.equal(changed.slice(anchor.start,anchor.end),"beta");
    assert.equal(anchor.to,inner.side.id);
    assert.equal(view.rivets.find(r=>r.id===outer.rivetId)!.to,outer.side.id);
    const body=lib.load(host.id).body;
    assert.throws(()=>persistClean(lib,host.id,"all removed"),/未保存/);
    assert.equal(lib.load(host.id).body,body);
    assert.equal(lib.load(inner.side.id).body,"");
  });
  it("uses actual input history for repeated text and multiple edits", () => {
    const before="aaaa middle z";
    const first=inputChange(before,"aaaaa middle z",0,0,"insertText");
    const second=inputChange(first.after,"aaaaa middle zz",first.after.length,first.after.length,"insertText");
    const batch=batchTo([first,second],before,second.after)!;
    const result=relocateAnchors(before,second.after,[{id:"anchor",start:1,end:3}],batch);
    assert.deepEqual(result,[{id:"anchor",start:2,end:4}]);
    assert.throws(()=>relocateAnchors("external",second.after,result,batch),/已变化/);
    assert.throws(()=>relocateAnchors(before,"different",result,batch),/不一致/);
  });
  it("deleting before an anchor moves it; deleting its source refuses instead of dropping it", () => {
    const specs=[{id:"anchor",start:4,end:8}];
    assert.deepEqual(relocateAnchors("abc term xyz","term xyz",specs),[{id:"anchor",start:0,end:4}]);
    assert.throws(()=>relocateAnchors("abc term xyz","abc  xyz",specs),/未保存/);
    assert.throws(()=>relocateAnchors("abc term xyz","abc rm xyz",[{id:"anchor",start:5,end:8}]),/未保存/);
  });
  it("pin edits update only the excerpt and shift later rivets", () => {
    const lib = tmpLibrary();
    const host = lib.createPiece({ body: "alpha beta gamma" });
    const side = hangSide(lib, host.id, { start: 11, end: 16 });
    const edited = editExcerpt(lib, host.id, "alpha beta gamma", 0, 5, "ALPHABET");
    assert.equal(strip(edited.body), "ALPHABET beta gamma");
    assert.equal(pieceView(edited).rivets[0].start, 14);
    assert.equal(pieceView(edited).rivets[0].to, side.side.id);
    assert.throws(() => editExcerpt(lib, host.id, "alpha beta gamma", 0, 5, "bad"), /已变化/);
    assert.equal(strip(lib.load(host.id).body), "ALPHABET beta gamma");
  });
  it("pin edits refuse ambiguous internal rivet boundaries", () => {
    const lib = tmpLibrary();
    const host = lib.createPiece({ body: "alpha beta gamma" });
    hangSide(lib, host.id, { start: 6, end: 10 });
    const before = lib.load(host.id).body;
    assert.throws(() => editExcerpt(lib, host.id, "alpha beta gamma", 0, 16, "replacement"), /挂接边界/);
    assert.equal(lib.load(host.id).body, before);
  });
  it("detaches one reused link without changing the target, its children, or other links", () => {
    const lib = tmpLibrary();
    const host = lib.createPiece({ body: "first second" });
    const side = lib.createPiece({ body: "child note" });
    hangSide(lib, side.id, { start: 0, end: 5 });
    const first = hangSide(lib, host.id, { start: 0, end: 5 }, { sideId: side.id });
    const second = hangSide(lib, host.id, { start: 6, end: 12 }, { sideId: side.id });
    const before = lib.load(side.id).body;
    const count = lib.list().length;
    const updated = detachSide(lib, host.id, second.rivetId, "first second edited");
    assert.equal(strip(updated.body), "first second edited");
    assert.deepEqual(pieceView(updated).rivets.map(r => r.id), [first.rivetId]);
    assert.equal(lib.load(side.id).body, before);
    assert.equal(lib.list().length, count);
  });

  it("detaches a PDF overlay without deleting notes or modifying PDF bytes", () => {
    const lib = tmpLibrary();
    const src = path.join(lib.root, "source.pdf");
    fs.writeFileSync(src, minimalPdf());
    const host = lib.attachPdf(src, { id: "pdf01" });
    const anchor = { page: 1, rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.1 } };
    const first = hangPdfSide(lib, host.id, [anchor]);
    const second = hangPdfSide(lib, host.id, [anchor], { sideId: first.side.id });
    const pdfPath = pieceView(host).pdfPath!;
    const before = fs.readFileSync(pdfPath);
    const count = lib.list().length;
    const updated = detachSide(lib, host.id, second.rivetId);
    assert.deepEqual(pieceView(updated).overlayRivets.map(r => r.id), [first.rivetId]);
    assert.equal(lib.load(first.side.id).id, first.side.id);
    assert.equal(lib.list().length, count);
    assert.deepEqual(fs.readFileSync(pdfPath), before);
  });
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
    assert.equal(view.title, "host01");
    assert.equal(view.titled, false);
    assert.equal(view.rivets[0].to, first.side.id);
    lib.saveTitle("host01", "Host note");
    assert.equal(pieceView(lib.load("host01")).title, "Host note");
    assert.equal(strip(lib.load("host01").body), "宿主一段可以再挂侧边。");
    const onDisk = fs.readFileSync(path.join(lib.root, "host01.intro.md"), "utf8");
    assert.match(onDisk, /^---\ntitle: Host note\n---\n/);
    assert.match(onDisk, /<<r id="/);
    persistClean(lib, "host01", "宿主一段可以再挂侧边。续");
    const afterPersist = fs.readFileSync(path.join(lib.root, "host01.intro.md"), "utf8");
    assert.match(afterPersist, /^---\ntitle: Host note\n---\n/);
    assert.equal(strip(lib.load("host01").body), "宿主一段可以再挂侧边。续");
    assert.equal(lib.load("host01").id, "host01");
    assert.equal(path.basename(lib.load("host01").path), "host01.intro.md");
    assert.equal(fs.existsSync(path.join(lib.root, "host01.intro.meta.json")), false);

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

    const rivetId = hung.rivetId;
    const sidePath = hung.side.path;
    lib.saveTitle(hung.side.id, "Region note");
    const sideFile = fs.readFileSync(sidePath, "utf8");
    assert.match(sideFile, /^---\ntitle: Region note\n---\n/);
    assert.equal(path.basename(sidePath), `${hung.side.id}.intro.md`);
    const hostAfter = lib.load("pdf01");
    assert.equal(hostAfter.medium, "pdf");
    if (hostAfter.medium === "pdf") {
      assert.equal(hostAfter.overlay.rivets[0].id, rivetId);
      assert.equal(hostAfter.overlay.rivets[0].to, hung.side.id);
    }
    assert.equal(fs.existsSync(path.join(lib.root, `${hung.side.id}.intro.meta.json`)), false);
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

describe("dropSide", () => {
  it("deletes a nested tree and strips the parent rivet", () => {
    const lib = tmpLibrary();
    lib.createPiece({ id: "host01", body: "宿主一段可以再挂侧边。" });
    const first = hangSide(lib, "host01", { start: 0, end: 2 });
    persistClean(lib, first.side.id, "侧边再问一层。");
    const nested = hangSide(lib, first.side.id, { start: 0, end: 2 });
    const result = dropSide(lib, first.side.id);
    assert.equal(result.deleted.includes(first.side.id), true);
    assert.equal(result.deleted.includes(nested.side.id), true);
    assert.equal(lib.resolve(first.side.id), null);
    assert.equal(lib.resolve(nested.side.id), null);
    assert.equal(parse(lib.load("host01").body).rivets.length, 0);
    assert.equal(strip(lib.load("host01").body), "宿主一段可以再挂侧边。");
  });

  it("keeps a reused side when another rivet still points at it", () => {
    const lib = tmpLibrary();
    lib.createPiece({ id: "host01", body: "alpha beta" });
    const parent = hangSide(lib, "host01", { start: 0, end: 5 });
    persistClean(lib, parent.side.id, "from alpha");
    const shared = hangSide(lib, parent.side.id, { start: 0, end: 4 });
    hangSide(lib, "host01", { start: 6, end: 10 }, { sideId: shared.side.id });
    const dropped = dropSide(lib, parent.side.id);
    assert.equal(dropped.deleted.includes(parent.side.id), true);
    assert.equal(dropped.deleted.includes(shared.side.id), false);
    assert.equal(lib.resolve(parent.side.id), null);
    assert.ok(lib.resolve(shared.side.id));
    const leftover = parse(lib.load("host01").body).rivets;
    assert.equal(leftover.length, 1);
    assert.equal(leftover[0].to, shared.side.id);
  });

  it("strips a PDF overlay rivet without deleting the PDF host", () => {
    const lib = tmpLibrary();
    const src = path.join(lib.root, "in.pdf");
    fs.writeFileSync(src, minimalPdf());
    lib.attachPdf(src, { id: "pdf01" });
    const hung = hangPdfSide(lib, "pdf01", [
      { page: 1, rect: { x: 1, y: 1, width: 10, height: 10 } },
    ]);
    persistClean(lib, hung.side.id, "note");
    const nested = hangSide(lib, hung.side.id, { start: 0, end: 4 });
    const result = dropSide(lib, hung.side.id);
    assert.equal(result.deleted.includes(hung.side.id), true);
    assert.equal(result.deleted.includes(nested.side.id), true);
    assert.ok(lib.resolve("pdf01"));
    const host = lib.load("pdf01");
    assert.equal(host.medium, "pdf");
    if (host.medium === "pdf") {
      assert.equal(host.overlay.rivets.length, 0);
    }
    assert.throws(() => dropSide(lib, "pdf01"), OverlayError);
  });
});
