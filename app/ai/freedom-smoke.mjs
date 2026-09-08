// Explicit paid integration check. Synthetic sources only; no desktop library.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { AiService } from './service.ts';
import { Library } from '../library/index.ts';
import { hangPdfSide, hangSide } from '../write/loop.ts';
import { minimalPdf } from '../pdf/fixture.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intro-free-note-'));
const lib = new Library(path.join(dir, 'library'));
const pdf = path.join(dir, 'synthetic.pdf'); fs.writeFileSync(pdf, minimalPdf('A closure retains access to its lexical environment.'));
const parent = lib.attachPdf(pdf, { id: 'synthetic-book' });
const side = hangPdfSide(lib, parent.id, [{ page: 1, rect: { x: 0, y: 0, width: 200, height: 40 } }]).side;
const body = '闭包是一个函数。\nLOCAL-KEEP-739\n我还不理解。'; lib.save(side.id, body);
const index = body.indexOf('LOCAL-KEEP-739'); const child = hangSide(lib, side.id, { start: index, end: index + 'LOCAL-KEEP-739'.length }).side;
const before = fs.readFileSync(side.path), originalPdf = fs.readFileSync(parent.pdfPath);
const service = new AiService(path.join(dir, 'profile')); let reads = 0;
service.pdfReader = async (root, id, page) => {
  assert.equal(root, lib.root); assert.equal(id, parent.id); assert.equal(page, 1); reads++;
  return { id: 'page-1', label: 'Synthetic source p1', text: 'A closure retains access to its lexical environment. Evidence marker: ORIGIN-918.' };
};
console.log(`Evidence: ${dir}`);
try {
  const models = await service.models(); console.log(`Account models: ${models.length}`);
  assert.ok(models.length > 1);
  const chosen = models.find(m => m.id.includes('luna')) ?? models[0];
  let job = service.start(lib, { root: lib.root, hostId: side.id, selection: { kind: 'text', expected: body, start: 0, end: body.length }, contexts: [], intent: 'revise', model: chosen.id, effort: chosen.efforts.includes('low') ? 'low' : chosen.defaultEffort, web: true,
    question: '改进这篇关于 JavaScript 闭包的笔记。先调用 read_document 读取关联 PDF synthetic-book 第1页，并在笔记里写出原文 evidence marker。必须联网搜索并打开 MDN 的 Closures 文档，以普通 Markdown 链接注明网页来源。用直观解释，不必数学推导。保留 LOCAL-KEEP-739 原样且只出现一次。控制在约250字。' });
  let last = '';
  while (job.status === 'running') { if (last !== job.progress) console.log(last = job.progress); await new Promise(r => setTimeout(r, 600)); job = service.status(job.id); }
  assert.equal(job.status, 'ready', job.error);
  assert.match(job.answer.markdown, /ORIGIN-918/); assert.match(job.answer.markdown, /https:\/\/developer.mozilla.org/);
  assert.ok(reads > 0); assert.deepEqual(fs.readFileSync(side.path), before);
  assert.throws(() => service.commit(lib, job.id), /修改稿须预览/);
  const updated = service.applyImprovement(lib, job.id); assert.equal(updated.rivets[0].to, child.id);
  service.applyImprovement(lib, job.id, true); assert.deepEqual(fs.readFileSync(side.path), before); assert.deepEqual(fs.readFileSync(parent.pdfPath), originalPdf);
  const journal = JSON.parse(fs.readFileSync(path.join(dir, 'profile', job.id + '.json')));
  assert.ok(journal.webSearches > 0, 'Actual web tool event required');
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ passed: true, model: chosen.id, modelCount: models.length, sourceReads: reads, webSearches: journal.webSearches, previewApplyUndo: true }));
  console.log('PASS: models + free concept explanation + real web + parent source read + preview/apply/undo');
} finally { service.close(); }
