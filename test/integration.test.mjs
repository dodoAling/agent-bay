import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from '../src/server.mjs';
import { EventStore } from '../src/events.mjs';
import { AgentRunner } from '../src/agent.mjs';
import { readSSE } from '../src/providers.mjs';

async function listen(server) { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return `http://127.0.0.1:${server.address().port}`; }
async function finished(store, id) { for (let i = 0; i < 150; i++) { if (store.runs.get(id)?.status !== 'running') return store.runs.get(id); await delay(20); } throw new Error('The task did not finish in time'); }
async function jsonBody(req) { const chunks = []; for await (const c of req) chunks.push(c); return JSON.parse(Buffer.concat(chunks).toString()); }
function mockHub(store) { return { busy: false, selected: () => [{ alias: 't0_calculate', name: 'calculate', serverId: 'test', serverName: 'Fixture MCP', description: 'calculate', inputSchema: { type: 'object', properties: {} } }], call: async (runId, tool, args) => { store.push({ runId, type: 'tool.start', callId: 'fixture-call', name: tool.name, args }); const result = { content: [{ type: 'text', text: '4' }] }; store.push({ runId, type: 'tool.end', callId: 'fixture-call', name: tool.name, ok: true, result }); return result; } }; }

test('External events enforce authentication, cross-origin restrictions, terminal states and secret redaction', async () => {
  const app = createApp({ bridgeToken: 'test-bridge-token' });
  const url = await listen(app.server);
  try {
    const post = (path, value, headers = {}) => fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value) });
    assert.equal((await post('/api/events', { type: 'run.start', runId: 'test' })).status, 401);
    assert.equal((await post('/api/model', {}, { Origin: 'https://attacker.example' })).status, 403);
    const auth = { Authorization: 'Bearer test-bridge-token' };
    assert.equal((await post('/api/events', { type: 'run.start', runId: 'test', title: 'Test' }, auth)).status, 201);
    assert.equal((await post('/api/events', { type: 'stage', runId: 'test', stage: 'fake-phase' }, auth)).status, 400);
    await post('/api/model', { protocol: 'openai-compatible', baseUrl: 'http://127.0.0.1:11434/v1', model: 'fixture', apiKey: 'private-fixture-key' });
    await post('/api/events', { type: 'log', runId: 'test', message: 'private-fixture-key', args: { apiKey: 'hidden' } }, auth);
    await post('/api/events', { type: 'run.end', runId: 'test', status: 'completed' }, auth);
    assert.equal((await post('/api/events', { type: 'log', runId: 'test', message: 'late' }, auth)).status, 400);
    const state = await (await fetch(url + '/api/state')).json();
    assert.equal(state.runs[0].status, 'completed');
    assert.equal(state.model.hasKey, true);
    assert.equal(JSON.stringify(state).includes('private-fixture-key'), false);
    assert.equal(state.events.find(e => e.type === 'log').args.apiKey, '[redacted]');
    await post('/api/model/clear', {});
    assert.equal((await (await fetch(url + '/api/state')).json()).model, null);
  } finally { await app.close(); }
});

test('SSE handles split multibyte Unicode, fragmented CRLF and multiline data', async () => {
  const bytes = new TextEncoder().encode('data: {"text":"\u4f60\u597d"}\r\n\r\ndata: {"text":\r\ndata: "\u4e16\u754c"}\r\n\r\ndata: [DONE]\r\n\r\n');
  async function* stream() { for (let i = 0; i < bytes.length; i++) yield bytes.slice(i, i + 1); }
  const output = [];
  for await (const e of readSSE(stream())) output.push(e);
  assert.deepEqual(output, [{ text: '\u4f60\u597d' }, { text: '\u4e16\u754c' }]);
});

test('Chat Completions streams tool calls, receives MCP results and returns a second model answer', async () => {
  const requests = [];
  const provider = createServer(async (req, res) => {
    const body = await jsonBody(req); requests.push(body);
    assert.equal(req.url, '/v1/chat/completions');
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const chunks = requests.length === 1 ? [
      { choices: [{ delta: { content: 'Preparing to call a tool.' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 't0_calculate', arguments: '{"x":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '2}' } }] }, finish_reason: 'tool_calls' }] }
    ] : [{ choices: [{ delta: { content: 'The result is 4.' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { total_tokens: 42 } }];
    for (const chunk of chunks) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  const url = await listen(provider), store = new EventStore(), hub = mockHub(store), agent = new AgentRunner(store, hub);
  try {
    agent.configure({ protocol: 'openai-compatible', baseUrl: url + '/v1', model: 'fixture' });
    const run = agent.start({ prompt: 'Calculate 2 + 2' });
    assert.equal((await finished(store, run.id)).status, 'completed');
    assert.equal(requests.length, 2);
    assert.equal(requests[1].messages.at(-1).role, 'tool');
    assert.equal(requests[1].messages.at(-1).tool_call_id, 'call-1');
    assert.equal(store.events.filter(e => e.type === 'tool.end').length, 1);
    assert.equal(store.events.find(e => e.type === 'model.delta' && e.text === 'The result is 4.')?.text, 'The result is 4.');
    assert.equal(store.events.at(-2).stage, 'verify');
  } finally { await new Promise(resolve => provider.close(resolve)); }
});

test('Anthropic Messages preserves tool_use and tool_result protocol ordering', async () => {
  const requests = [];
  const provider = createServer(async (req, res) => {
    const body = await jsonBody(req); requests.push(body);
    assert.equal(req.url, '/v1/messages');
    assert.equal(req.headers['x-api-key'], 'fixture-key');
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const first = requests.length === 1;
    const events = [
      { type: 'message_start', message: { usage: { input_tokens: 10 } } },
      { type: 'content_block_start', index: 0, content_block: first ? { type: 'tool_use', id: 'use-1', name: 't0_calculate', input: {} } : { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: first ? { type: 'input_json_delta', partial_json: '{"x":2}' } : { type: 'text_delta', text: 'The result is 4.' } },
      { type: 'message_delta', delta: { stop_reason: first ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 7 } },
      { type: 'message_stop' }
    ];
    for (const e of events) res.write(`data: ${JSON.stringify(e)}\n\n`);
    res.end();
  });
  const url = await listen(provider), store = new EventStore(), agent = new AgentRunner(store, mockHub(store));
  try {
    agent.configure({ protocol: 'anthropic', baseUrl: url + '/v1', model: 'fixture', apiKey: 'fixture-key' });
    const run = agent.start({ prompt: 'Calculate 2 + 2' });
    assert.equal((await finished(store, run.id)).status, 'completed');
    assert.equal(requests[1].messages[1].content[0].type, 'tool_use');
    assert.equal(requests[1].messages[2].content[0].tool_use_id, 'use-1');
    assert.equal(requests[1].messages[2].content[0].type, 'tool_result');
    assert.equal(requests[1].system.includes('Never fabricate'), true);
  } finally { await new Promise(resolve => provider.close(resolve)); }
});

test('Stopping a task aborts its model request and records cancelled', async () => {
  let ready;
  const received = new Promise(resolve => { ready = resolve; });
  const provider = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': waiting\n\n'); ready(); });
  const url = await listen(provider), store = new EventStore(), agent = new AgentRunner(store, mockHub(store));
  try {
    agent.configure({ protocol: 'openai-compatible', baseUrl: url + '/v1', model: 'fixture' });
    const run = agent.start({ prompt: 'Wait' });
    await received; agent.stop();
    assert.equal((await finished(store, run.id)).status, 'cancelled');
    assert.equal(store.events.some(e => e.type === 'run.end' && e.status === 'completed'), false);
  } finally { provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve)); }
});
