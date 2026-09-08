import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceId, validateAnswer } from './answer.ts';

const raw = (sources: unknown, markdown: unknown = 'A useful note') => JSON.stringify({ title: 'Note', markdown, sources });
test('same selected PDF page aliases validate and deduplicate in both directions', () => {
  assert.deepEqual(validateAnswer(raw(['page-199', 'document-book-page-199']), new Set(['document-book-page-199']), 'book').sources, ['document-book-page-199']);
  assert.deepEqual(validateAnswer(raw(['document-book-page-199']), new Set(['page-199']), 'book').sources, ['document-book-page-199']);
  assert.equal(sourceId('page-199'), 'page-199');
});
test('unread adjacent pages and different PDF pages cannot pass via aliases', () => {
  assert.throws(() => validateAnswer(raw(['page-201']), new Set(['document-book-page-199']), 'book'), /未知.*201/);
  assert.throws(() => validateAnswer(raw(['document-other-page-199']), new Set(['document-book-page-199']), 'book'), /未知/);
});
test('validation reports distinct format failures and preserves valid older text sources', () => {
  assert.throws(() => validateAnswer('bad JSON', new Set()), /有效 JSON/);
  assert.throws(() => validateAnswer('null', new Set()), /笔记对象/);
  assert.throws(() => validateAnswer(raw([], ''), new Set()), /正文为空/);
  assert.throws(() => validateAnswer(raw([], 'x'.repeat(100001)), new Set()), /十万/);
  assert.throws(() => validateAnswer(raw([], '<<r id="x">>'), new Set()), /挂接标记/);
  assert.throws(() => validateAnswer(raw([12]), new Set()), /来源 ID 列表/);
  assert.deepEqual(validateAnswer(raw(['source']), new Set(['source'])).sources, ['source']);
});


test('terminal formatting is removed without changing TeX', () => {
  const note = validateAnswer(raw([], '$\\mu$ and $\u001b[1m\\mu\u001b[0m$'), new Set());
  assert.equal(note.markdown, '$\\mu$ and $\\mu$');
});


test('old ready drafts can be edited, reopened and reject stale edits without writing library', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { AiService } = await import('./service.ts');
  const { Library } = await import('../library/index.ts');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'intro-draft-test-'));
  try {
    const library = path.join(root, 'library'); fs.mkdirSync(library);
    const jobs = path.join(root, 'jobs'); fs.mkdirSync(jobs);
    const old = { id: 'ABC123', root: library, hostId: 'host', status: 'ready', progress: '', revision: '', request: { contexts: [], selection: { kind: 'pdf' } }, answer: { title: 'old', markdown: 'original', sources: [] } };
    fs.writeFileSync(path.join(jobs, 'ABC123.json'), JSON.stringify(old));
    const service = new AiService(jobs), lib = new Library(library);
    service.editDraft(lib, old.id, 'original', 'changed');
    assert.equal(new AiService(jobs).status(old.id).answer?.markdown, 'changed');
    assert.ok(new AiService(jobs).status(old.id).rawAnswer?.includes('original'));
    assert.throws(() => service.editDraft(lib, old.id, 'original', 'lost update'), /草稿已变化/);
    assert.deepEqual(fs.readdirSync(library), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
