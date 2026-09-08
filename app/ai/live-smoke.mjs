// Explicit manual integration check: consumes Codex quota, synthetic library only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Library } from '../library/index.ts';
import { AiService } from './service.ts';
import { pieceView } from '../write/loop.ts';
import { validateAnswer } from './validate-answer.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intro-ai-live-'));
const lib = new Library(path.join(dir, 'library'));
const body = '测试教材。标识 MAPLE-764。增量 dy 取 3、0、-3，概率分别为 0.4、0.5、0.1。\n\n方差 = 二阶矩 - 均值平方。';
const host = lib.createPiece({ id: 'synthetic', body, title: '合成方差教材' });
const service = new AiService(path.join(dir, 'profile'));
console.log(`Integration evidence: ${dir}`);
try {
  let job = service.start(lib, { root: lib.root, hostId: host.id, selection: { kind: 'text', expected: body, start: body.indexOf('方差'), end: body.length }, contexts: [], question: '先调用 read_context(id="source") 核对原文，然后解释选区，写出来源标识，并根据原文给出方差数值。' });
  let last = '';
  while (job.status === 'running') {
    if (job.progress !== last) { console.log(job.progress); last = job.progress; }
    await new Promise(r => setTimeout(r, 500)); job = service.status(job.id);
  }
  assert.equal(job.status, 'ready', job.error);
  assert.match(job.answer.markdown, /3\.69/); assert.match(job.answer.markdown, /MAPLE-764/);
  const rendered = validateAnswer({ ...job.answer, sourceId: 'source' });
  assert.ok(rendered.formulas > 0);
  const journal = JSON.parse(fs.readFileSync(path.join(dir, 'profile', job.id+'.json')));
  assert.ok(journal.readContextIds.includes('source'), 'Actual context tool call required');
  const saved = service.commit(lib, job.id);
  assert.equal(saved.host.clean, body); assert.equal(saved.host.rivets[0].to, saved.side.id);
  assert.equal(pieceView(new Library(lib.root).load(saved.side.id)).clean, job.answer.markdown);
  assert.equal(service.commit(lib, job.id).side.id, saved.side.id);
  fs.writeFileSync(path.join(dir, 'answer.html'), rendered.html);
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ passed: true, jobId: job.id, sideId: saved.side.id, formulas: rendered.formulas, toolCalls: journal.readContextIds }));
  console.log('PASS: actual context tool → answer → math render → side commit → reopen → idempotent retry');
} finally { service.close(); }
