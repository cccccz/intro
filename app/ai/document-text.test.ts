import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractedPages, markdownPages, parsePages, searchPages } from './document-text.ts';

test('page-marked Markdown preserves empty pages and searches with pagination', () => {
  const pages = [{ page: 1, text: '' }, ...Array.from({ length: 24 }, (_, i) => ({ page: i + 2, text: 'Variance 方差 formula' }))];
  assert.deepEqual(parsePages(markdownPages(pages)), pages);
  const first = searchPages(pages, 'VARIANCE');
  assert.equal(first.total, 24); assert.equal(first.hits.length, 20);
  assert.deepEqual(first.emptyPages, [1]); assert.equal(first.nextOffset, 20);
  assert.equal(searchPages(pages, '方差', 20).hits.length, 4);
  assert.equal(searchPages(pages, 'missing').total, 0);
  assert.throws(() => searchPages(pages, ' '));
});

test('cache is external, reused, invalidated by PDF content, and cancelled extraction is not published', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'intro-search-test-'));
  try {
    const file = path.join(root, 'source.pdf'), cache = path.join(root, 'cache');
    fs.writeFileSync(file, 'synthetic source');
    let calls = 0;
    const reader = async (_root: string, _id: string, page: number) => {
      calls++;
      return { id: String(page), label: 'test', text: page === 0 ? '{"pageCount":2}' : page === 1 ? 'definition' : '' };
    };
    const get = (active = () => true) => extractedPages(cache, file, root, 'id', reader, active, () => {});
    assert.equal((await get()).length, 2); assert.equal(calls, 3);
    await get(); assert.equal(calls, 3);
    assert.equal(fs.readFileSync(file, 'utf8'), 'synthetic source');
    assert.equal(fs.readdirSync(cache).filter(n => n.endsWith('.md')).length, 1);
    fs.writeFileSync(file, 'changed PDF');
    await assert.rejects(get(() => false), /取消/);
    assert.equal(fs.readdirSync(cache).length, 1);
    await get(); assert.equal(fs.readdirSync(cache).length, 2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
