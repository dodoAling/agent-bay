import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { completion } from '../src/providers.mjs';
import { AgentRunner } from '../src/agent.mjs';
import { EventStore } from '../src/events.mjs';

const protocols = ['openai-compatible', 'anthropic'];
const tool = { alias: 't0_read', name: 'read', serverName: 'Fixture MCP', inputSchema: { type: 'object' } };

function reply(protocol, reason, { stream = false, useTool = false, emptyTool = false, terminal = true, partialArguments = false } = {}) {
  const text = '\u5206\u6790\u7ed3\u679c';
  if (protocol === 'openai-compatible') {
    const toolCalls = useTool && !emptyTool ? [{ id: 'call-1', type: 'function', function: { name: tool.alias, arguments: partialArguments ? '{' : '{"path":"fixture.exe"}' } }] : [];
    const choice = { finish_reason: reason, message: { role: 'assistant', content: text, ...(useTool ? { tool_calls: toolCalls } : {}) } };
    return stream ? { stream, events: [{ choices: [{ delta: { content: text } }] }, ...(toolCalls.length ? [{ choices: [{ delta: { tool_calls: toolCalls.map(c => ({ index: 0, ...c })) } }] }] : []), ...(terminal ? [{ choices: [{ delta: {}, finish_reason: reason }], usage: { total_tokens: 12 } }] : [])] } : { data: { choices: [choice], usage: { total_tokens: 12 } } };
  }
  const blocks = useTool && !emptyTool ? [{ type: 'tool_use', id: 'call-1', name: tool.alias, input: { path: 'fixture.exe' } }] : [{ type: 'text', text }];
  return stream ? { stream, events: [
    { type: 'message_start', message: { usage: { input_tokens: 6 } } },
    { type: 'content_block_start', index: 0, content_block: { ...blocks[0], ...(useTool && !emptyTool ? { input: {} } : { text: '' }) } },
    { type: 'content_block_delta', index: 0, delta: useTool && !emptyTool ? { type: 'input_json_delta', partial_json: partialArguments ? '{' : '{"path":"fixture.exe"}' } : { type: 'text_delta', text } },
    { type: 'message_delta', delta: { stop_reason: reason }, usage: { output_tokens: 6 } },
    ...(terminal ? [{ type: 'message_stop' }] : [])
  ] } : { data: { type: 'message', role: 'assistant', content: blocks, stop_reason: reason, usage: { input_tokens: 6, output_tokens: 6 } } };
}

async function withProvider(protocol, replies, exercise) {
  const requests = [];
  const server = createServer(async (req, res) => {
    const bytes = [];
    for await (const part of req) bytes.push(part);
    requests.push(JSON.parse(Buffer.concat(bytes).toString()));
    const current = replies[requests.length - 1];
    if (!current) { res.writeHead(500); res.end('Unexpected extra model request'); return; }
    res.writeHead(200, { 'Content-Type': current.stream ? 'text/event-stream' : 'application/json' });
    res.end(current.stream ? current.events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') + (protocol === 'openai-compatible' ? 'data: [DONE]\n\n' : '') : JSON.stringify(current.data));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const config = { protocol, baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'fixture' };
  try { await exercise(config, requests); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

function runEnded(store) {
  let timer;
  let handler;
  const ended = new Promise((resolve, reject) => {
    handler = event => { if (event.type === 'run.end') { clearTimeout(timer); store.off('event', handler); resolve(event); } };
    store.on('event', handler);
    timer = setTimeout(() => { store.off('event', handler); reject(new Error('The task did not end in time')); }, 3000);
  });
  return ended;
}

test('Both protocols reject truncated JSON and SSE, errors and missing completion reasons', async t => {
  for (const protocol of protocols) {
    const cases = protocol === 'anthropic' ? [['max_tokens', /output limit/], ['model_context_window_exceeded', /did not finish normally/], ['refusal', /did not finish normally/], ['pause_turn', /did not finish normally/], [null, /finish reason/]] : [['length', /output limit/], ['content_filter', /did not finish normally/], ['error', /did not finish normally/], [null, /finish reason|stream ended without a finish marker/]];
    for (const stream of [false, true]) for (const [reason, pattern] of cases) {
      await t.test(`${protocol} ${stream ? 'SSE' : 'JSON'} ${reason}`, async () => {
        await withProvider(protocol, [reply(protocol, reason, { stream })], async config => {
          const deltas = [];
          await assert.rejects(completion(config, [{ role: 'user', content: 'test' }], [], new AbortController().signal, text => deltas.push(text)), pattern);
          if (!stream) assert.deepEqual(deltas, [], 'A truncated non-streaming reply must not be published as a normal answer');
        });
      });
    }
  }
});

test('SSE requires a complete terminal marker; a closed connection does not imply completion', async () => {
  for (const protocol of protocols) await withProvider(protocol, [reply(protocol, protocol === 'anthropic' ? 'end_turn' : 'stop', { stream: true, terminal: false })], async config => {
    await assert.rejects(completion(config, [{ role: 'user', content: 'test' }], [], new AbortController().signal, () => {}), /stream ended without a finish marker/);
  });
});

test('Both protocols preserve normal JSON and SSE completion, stop sequences and tool calls', async t => {
  for (const protocol of protocols) for (const stream of [false, true]) {
    const reasons = protocol === 'anthropic' ? ['end_turn', 'stop_sequence', 'tool_use'] : ['stop', 'tool_calls'];
    for (const reason of reasons) await t.test(`${protocol} ${stream ? 'SSE' : 'JSON'} ${reason}`, async () => {
      const useTool = ['tool_calls', 'tool_use'].includes(reason);
      await withProvider(protocol, [reply(protocol, reason, { stream, useTool })], async config => {
        const output = await completion(config, [{ role: 'system', content: 'test' }, { role: 'user', content: 'test' }], [tool], new AbortController().signal, () => {});
        assert.equal(output.calls.length, useTool ? 1 : 0);
        if (useTool) { assert.equal(output.calls[0].name, tool.alias); assert.deepEqual(JSON.parse(output.calls[0].arguments), { path: 'fixture.exe' }); }
        else assert.equal(output.content, '\u5206\u6790\u7ed3\u679c');
        assert.ok(Object.keys(output.usage).length);
      });
    });
  }
});

test('Tool completion reasons require tool calls; truncated arguments must not reach execution', async () => {
  for (const protocol of protocols) for (const stream of [false, true]) {
    await withProvider(protocol, [reply(protocol, protocol === 'anthropic' ? 'tool_use' : 'tool_calls', { stream, useTool: true, emptyTool: true })], async config => {
      await assert.rejects(completion(config, [{ role: 'user', content: 'test' }], [tool], new AbortController().signal, () => {}), /without returning tool calls/);
    });
    await withProvider(protocol, [reply(protocol, protocol === 'anthropic' ? 'max_tokens' : 'length', { stream, useTool: true, partialArguments: true })], async config => {
      await assert.rejects(completion(config, [{ role: 'user', content: 'test' }], [tool], new AbortController().signal, () => {}), /output limit/);
    });
  }
});

test('JSON error responses cannot be treated as successful answers', async () => {
  for (const protocol of protocols) await withProvider(protocol, [{ data: { ...reply(protocol, protocol === 'anthropic' ? 'end_turn' : 'stop').data, error: { message: 'fixture provider error' } } }], async config => {
    await assert.rejects(completion(config, [{ role: 'user', content: 'test' }], [], new AbortController().signal, () => {}), /fixture provider error/);
  });
});

test('AgentRunner fails on truncated JSON or SSE in either protocol without executing tools or recording completion', async () => {
  for (const protocol of protocols) for (const stream of [false, true]) await withProvider(protocol, [reply(protocol, protocol === 'anthropic' ? 'max_tokens' : 'length', { stream, useTool: true, partialArguments: true })], async config => {
    const store = new EventStore();
    let calls = 0;
    const agent = new AgentRunner(store, { busy: false, selected: () => [tool], call: async () => { calls++; return {}; } });
    agent.configure(config);
    const ended = runEnded(store);
    const run = agent.start({ prompt: 'Analyze fixture.exe' });
    assert.equal((await ended).status, 'failed');
    assert.equal(store.runs.get(run.id).status, 'failed');
    assert.equal(calls, 0);
    assert.equal(store.events.some(e => e.type === 'model.end'), false);
    assert.equal(store.events.some(e => e.type === 'run.end' && e.status === 'completed'), false);
    assert.match(store.events.find(e => e.type === 'log' && e.level === 'error').message, /output limit/);
  });
});

test('AgentRunner completes non-streaming tool loops and returns results in both protocols', async () => {
  for (const protocol of protocols) await withProvider(protocol, [reply(protocol, protocol === 'anthropic' ? 'tool_use' : 'tool_calls', { useTool: true }), reply(protocol, protocol === 'anthropic' ? 'end_turn' : 'stop')], async (config, requests) => {
    const store = new EventStore();
    const calls = [];
    const agent = new AgentRunner(store, { busy: false, selected: () => [tool], call: async (runId, selected, args, signal, id) => { calls.push({ args, id }); return { content: [{ type: 'text', text: 'fixture function' }] }; } });
    agent.configure(config);
    const ended = runEnded(store);
    agent.start({ prompt: 'Analyze fixture.exe' });
    assert.equal((await ended).status, 'completed');
    assert.deepEqual(calls, [{ args: { path: 'fixture.exe' }, id: 'call-1' }]);
    assert.equal(requests.length, 2);
    assert.equal(store.events.filter(e => e.type === 'model.end').length, 2);
    const result = requests[1].messages.at(-1);
    assert.equal(protocol === 'anthropic' ? result.content[0].tool_use_id : result.tool_call_id, 'call-1');
    assert.match(protocol === 'anthropic' ? result.content[0].content : result.content, /fixture function/);
  });
});
