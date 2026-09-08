import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Library } from '../library/index.ts';
import { hangSide, hangPdfSide, pieceView } from '../write/loop.ts';
import { prepareRevision, applyRevision } from './revise.ts';
import { revision } from './commit.ts';
import { readingContext } from './reading-context.ts';
import { minimalPdf } from '../pdf/fixture.ts';
function fixture(t: { after: (f: () => void) => void }) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'intro-revise-test-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return new Library(root); }
test('rewrite preserves child IDs, title and unknown metadata; exact undo restores original bytes', t => {
  const lib = fixture(t); lib.createPiece({ id: 'note', body: '---\ntitle: Existing\ncustom: keep\n---\n前文。精确来源片段。后文。' });
  const result = hangSide(lib, 'note', { start: 3, end: 9 });
  const original = fs.readFileSync(result.host.path);
  const child = fs.readFileSync(result.side.path);
  const plan = prepareRevision(lib, 'note', revision(lib, 'note'), '更清楚的背景。\n\n精确来源片段\n\n补充解释。');
  assert.deepEqual(fs.readFileSync(result.host.path), original, 'preview does not write');
  applyRevision(plan); applyRevision(plan);
  const view = pieceView(lib.load('note')); assert.equal(view.title, 'Existing'); assert.equal(view.rivets[0]!.to, result.side.id);
  assert.equal(view.clean.slice(view.rivets[0]!.start, view.rivets[0]!.end), '精确来源片段');
  assert.deepEqual(fs.readFileSync(result.side.path), child);
  applyRevision(plan, true); assert.deepEqual(fs.readFileSync(result.host.path), original);
});
test('changed or repeated child anchors and stale revisions cannot overwrite notes', t => {
  const lib = fixture(t); lib.createPiece({ id: 'note', body: 'start unique end' });
  hangSide(lib, 'note', { start: 6, end: 12 }); const rev = revision(lib, 'note');
  assert.throws(() => prepareRevision(lib, 'note', rev, 'all replaced'), /子 side/);
  assert.throws(() => prepareRevision(lib, 'note', rev, 'unique and unique'), /子 side/);
  const plan = prepareRevision(lib, 'note', rev, 'new unique paragraph');
  lib.saveTitle('note', 'User title');
  assert.throws(() => applyRevision(plan), /已被编辑/);
  assert.throws(() => prepareRevision(lib, 'note', rev, 'unique'), /已变化/);
});
test('context includes direct source excerpt, PDF ancestor and child metadata, excludes unrelated note', t => {
  const lib = fixture(t); const file = path.join(lib.root, 'source.pdf'); fs.writeFileSync(file, minimalPdf());
  const pdf = lib.attachPdf(file, { id: 'book' });
  const parent = hangPdfSide(lib, pdf.id, [{ page: 1, rect: { x: 0, y: 0, width: 100, height: 20 } }]);
  lib.save(parent.side.id, '解释一个概念，再作比较');
  const target = hangSide(lib, parent.side.id, { start: 2, end: 6 }); lib.save(target.side.id, '我的笔记');
  const child = hangSide(lib, target.side.id, { start: 0, end: 2 });
  lib.createPiece({ id: 'unrelated', body: 'private unrelated material' });
  const context = readingContext(lib, target.side.id);
  assert.ok(context.excerpts[0]!.text.includes('解释一个概念'));
  assert.ok(context.related.some(s => s.pieceId === 'book' && s.page === 1));
  assert.ok(context.related.some(s => s.pieceId === child.side.id));
  assert.ok(!context.related.some(s => s.pieceId === 'unrelated'));
});
