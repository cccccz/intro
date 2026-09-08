import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseRuntime, supportedVersion } from './runtime.ts';

test('reject older and prerelease runtimes with incompatible protocol', () => {
  assert.equal(supportedVersion('codex-cli 0.130.0-alpha.5'), null);
  assert.equal(supportedVersion('codex-cli 0.153.3'), null);
  assert.deepEqual(supportedVersion('codex-cli 0.153.4\n'), [0, 153, 4]);
});
test('select newest compatible binary even if PATH shim is older or missing', async () => {
  const outputs: Record<string, string> = { shim: 'codex-cli 0.130.0-alpha.5', cached: 'codex-cli 0.153.4', latest: 'codex-cli 0.154.0' };
  const selected = await chooseRuntime(['missing', 'shim', 'cached', 'latest'], async bin => { if (!(bin in outputs)) throw new Error('ENOENT'); return outputs[bin]!; });
  assert.equal(selected, 'latest');
});
test('report actionable error when no supported installation is found', async () => {
  await assert.rejects(chooseRuntime(['old'], async () => 'codex-cli 0.130.0'), /0.153.4/);
});
