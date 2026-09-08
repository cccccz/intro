// Read-only setup check: no model turn, browser login, or library access.
import { resolveCodexRuntime } from '../dist/ai/runtime.js';
import { CodexTransport } from '../dist/ai/transport.js';
import os from 'node:os';
let client;
try {
  const bin = await resolveCodexRuntime();
  console.log(`PASS compatible CLI: ${bin}`);
  client = new CodexTransport(bin, [], os.tmpdir());
  await client.initialize();
  console.log('PASS App Server handshake');
  const account = await client.request('account/read', { refreshToken: false });
  if (account.account?.type !== 'chatgpt') throw new Error('ChatGPT login required: open intro and use Connect Codex, then rerun this check.');
  console.log('PASS ChatGPT login (credentials are not printed)');
  const result = await client.request('model/list', { limit: 100 });
  if (!result.data?.length) throw new Error('No models returned for this account');
  console.log(`PASS model catalog: ${result.data.map(m => m.model).join(', ')}`);
  console.log('Setup checks passed. No generation was requested; generation quota/network still need an optional manual test.');
} catch (error) {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally { client?.close(); }
