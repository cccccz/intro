import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { instrumentKatex } from './katex-source-map.mjs';
const require = createRequire(import.meta.url);
const file = require.resolve('katex');
const original = fs.readFileSync(file, 'utf8');
const module = { exports: {} };
vm.runInNewContext(instrumentKatex(original, require('katex').version), { module, exports: module.exports, console });
const katex = module.exports;

test('version guard prevents silently losing formula source mapping', () => {
  assert.throws(() => instrumentKatex(original, 'future'), /Review/);
});

test('source maps cover fractions, radicals, powers, operators and repeated symbols', () => {
  for (const tex of [String.raw`a+\frac{b}{c}+x^2`,String.raw`\sqrt{x}+x_2`,String.raw`\operatorname{Var}(x)`, 'x+x+x']) {
    const html = katex.renderToString(tex, { throwOnError: true });
    const spans = [...html.matchAll(/data-tex-start="(\d+)" data-tex-end="(\d+)"/g)];
    assert.ok(spans.length > 0, tex);
    for (const span of spans) assert.ok(+span[1] >= 0 && +span[2] <= tex.length && +span[2] > +span[1]);
    if (tex === 'x+x+x') for (const start of [0,2,4]) assert.ok(spans.some(s => +s[1] === start && +s[2] === start+1));
    if (tex.includes('operatorname')) assert.ok(spans.some(s => tex.slice(+s[1],+s[2]).includes('Var')));
  }
});

test('annotation and untrusted HTML commands keep original behavior', () => {
  const tex=String.raw`\mathbb E[(\Delta y)^2]`;
  const html=katex.renderToString(tex);
  const baseline=require('katex').renderToString(tex);
  assert.equal(html.match(/<math[\s\S]*?<\/math>/)[0],baseline.match(/<math[\s\S]*?<\/math>/)[0]);
  const unsafe=katex.renderToString(String.raw`\href{javascript:alert(1)}{x}`, {throwOnError:false});
  assert.doesNotMatch(unsafe, /href="javascript:/);
});
