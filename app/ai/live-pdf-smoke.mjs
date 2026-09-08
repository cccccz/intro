// Manual paid check using a snapshot produced by pdf-smoke.cjs, never a real library.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Library } from '../library/index.ts';
import { minimalPdf } from '../pdf/fixture.ts';
import { AiService } from './service.ts';
const snapshot = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intro-ai-pdf-live-'));
const lib = new Library(path.join(dir, 'library'));
const file = path.join(dir, 'synthetic.pdf'); fs.writeFileSync(file, minimalPdf('TEST 7319: f(x)=x^2+2x-1'));
const host = lib.attachPdf(file, { id: 'synthetic-pdf' }); const bytes = fs.readFileSync(host.pdfPath);
const service = new AiService(path.join(dir, 'profile'));
console.log(dir);
try {
  let job = service.start(lib, { root: lib.root, hostId: host.id, selection: { kind: 'pdf', anchors: [{page:1,rect:{x:65,y:705,width:460,height:45}}] }, question: '解释选区函数，并求x=4的函数值。写出测试编号。', ...snapshot });
  while(job.status === 'running') { await new Promise(r=>setTimeout(r,750)); job=service.status(job.id); }
  assert.equal(job.status, 'ready', job.error); assert.match(job.answer.markdown, /7319/); assert.match(job.answer.markdown, /23/);
  const saved=service.commit(lib,job.id);
  assert.deepEqual(fs.readFileSync(host.pdfPath),bytes);
  assert.equal(saved.host.overlayRivets[0].to,saved.side.id);
  assert.equal(new Library(lib.root).load(saved.side.id).body,job.answer.markdown);
  fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({passed:true,sideId:saved.side.id,pdfUnchanged:true}));
  console.log('PASS: PDF crop + page → Codex answer → overlay side → reopen; PDF bytes unchanged');
} finally { service.close(); }
