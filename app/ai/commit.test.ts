import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Library } from '../library/index.ts';
import { pieceView, hangSide } from '../write/loop.ts';
import { minimalPdf } from '../pdf/fixture.ts';
import { revision, prepareCommit, applyCommit, atomicWrite } from './commit.ts';

const answer = { title: '解释', markdown: '均值为 $0.9$。', sources: ['source'] };
function fixture(t: { after: (fn: () => void) => void }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'intro-ai-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return new Library(root);
}
test('AI side preserves old text, title, unknown frontmatter and existing rivets; repeated commit is idempotent', t => {
  const lib = fixture(t);
  lib.createPiece({ id: 'host', body: '---\ntitle: Old title\ncustom: keep-me\n---\nfirst second third' });
  const old = hangSide(lib, 'host', { start: 0, end: 5 });
  const oldSide = fs.readFileSync(old.side.path);
  const rev = revision(lib, 'host');
  const plan = prepareCommit(lib, 'host', rev, { kind: 'text', expected: 'first second third', start: 6, end: 12 }, answer);
  applyCommit(plan); applyCommit(plan);
  const view = pieceView(lib.load('host'));
  assert.equal(view.clean, 'first second third'); assert.equal(view.title, 'Old title');
  assert.equal(view.rivets.length, 2); assert.equal(view.rivets[0]!.to, old.side.id);
  assert.match(fs.readFileSync(view.path, 'utf8'), /custom: keep-me/);
  assert.deepEqual(fs.readFileSync(old.side.path), oldSide);
  assert.equal(pieceView(new Library(lib.root).load(plan.sideId)).clean, answer.markdown);
  assert.equal(lib.list().length, 3);
});
test('source edits before preparation or before commit cannot attach at stale offsets', t => {
  const lib = fixture(t); lib.createPiece({ id: 'host', body: 'alpha beta' });
  const rev = revision(lib, 'host');
  const selection = { kind: 'text' as const, expected: 'alpha beta', start: 6, end: 10 };
  const plan = prepareCommit(lib, 'host', rev, selection, answer);
  lib.save('host', 'changed alpha beta');
  assert.throws(() => prepareCommit(lib, 'host', rev, selection, answer), /来源已变化/);
  assert.throws(() => applyCommit(plan), /来源已变化/);
  assert.equal(lib.list().length, 1);
});
test('recover after side write but before host write, without duplicate files', t => {
  const lib = fixture(t); lib.createPiece({ id: 'host', body: 'alpha beta' });
  const plan = prepareCommit(lib, 'host', revision(lib, 'host'), { kind: 'text', expected: 'alpha beta', start: 0, end: 5 }, answer);
  atomicWrite(plan.sidePath, plan.sideRaw);
  applyCommit(JSON.parse(JSON.stringify(plan))); applyCommit(plan);
  assert.equal(lib.list().length, 2); assert.equal(pieceView(lib.load('host')).rivets[0]!.to, plan.sideId);
  lib.save(plan.sideId, 'user revised answer');
  assert.throws(() => applyCommit(plan), /回答笔记已变化/);
});
test('PDF commit only adds side and overlay; bytes and existing overlay links survive', t => {
  const lib = fixture(t); const file = path.join(lib.root, 'input.pdf'); fs.writeFileSync(file, minimalPdf());
  const host = lib.attachPdf(file, { id: 'pdf' }); const before = fs.readFileSync(host.pdfPath), meta = fs.readFileSync(host.path);
  const selection = { kind: 'pdf' as const, anchors: [{ page: 1, rect: { x: 10, y: 20, width: 50, height: 30 } }] };
  const plan = prepareCommit(lib, host.id, revision(lib, host.id), selection, answer);
  applyCommit(plan); applyCommit(plan);
  assert.deepEqual(fs.readFileSync(host.pdfPath), before); assert.deepEqual(fs.readFileSync(host.path), meta);
  const loaded = pieceView(new Library(lib.root).load(host.id)); assert.equal(loaded.overlayRivets.length, 1);
  assert.deepEqual(loaded.overlayRivets[0]!.anchors, selection.anchors);
});
test('reject invalid source boundaries and generated internal marks before any writes', t => {
  const lib = fixture(t); lib.createPiece({ id: 'host', body: 'alpha beta' });
  const rev = revision(lib, 'host');
  assert.throws(() => prepareCommit(lib, 'host', rev, { kind: 'text', expected: 'alpha beta', start: 99, end: 100 }, answer));
  assert.throws(() => prepareCommit(lib, 'host', rev, { kind: 'text', expected: 'alpha beta', start: 0, end: 5 }, { ...answer, markdown: '<<r id="fake">>bad' }));
  assert.equal(lib.list().length, 1);
});
