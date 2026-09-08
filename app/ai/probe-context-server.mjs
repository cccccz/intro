import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';

// A synthetic document only. This server cannot read a user's library.
const tool = {
  name: 'read_context', description: 'Read the synthetic textbook page for the selected variance expression.',
  inputSchema: { type: 'object', properties: { page: { type: 'integer', enum: [192] } }, required: ['page'], additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
};
const lines = createInterface({ input: process.stdin });
lines.on('line', line => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.id === undefined) return;
  let result;
  if (msg.method === 'initialize') result = { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'intro-synthetic-context', version: '0.1.0' } };
  else if (msg.method === 'ping') result = {};
  else if (msg.method === 'tools/list') result = { tools: [tool] };
  else if (msg.method === 'tools/call' && msg.params.name === tool.name && msg.params.arguments?.page === 192) {
    appendFileSync(process.argv[2], JSON.stringify({ tool: tool.name, page: 192 }) + '\n');
    result = { content: [{ type: 'text', text: JSON.stringify({ sourceId: 'synthetic:p192', page: 192, text: 'Context marker: LANTERN-582. Delta y takes +h, 0, -h with probabilities pPlus, 1-pPlus-pMinus, pMinus. Var(Delta y)=E[(Delta y)^2]-(E[Delta y])^2. In this example h=3, pPlus=0.4, pMinus=0.1.' }) }] };
  } else {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: 'Unknown method or page outside synthetic document' } }) + '\n');
    return;
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\n');
});
