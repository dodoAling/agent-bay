import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { EventOutbox } from '../src/event-outbox.mjs';
import { emit } from '../scripts/emit.mjs';
import { createApp } from '../src/server.mjs';

test('The event outbox preserves FIFO order and stable IDs; lost ACKs do not change snapshots', async () => {
  const attempts = [], accepted = new Map(); let loseAck = true;
  const outbox = new EventOutbox(async event => {
    attempts.push(event);
    accepted.set(event.eventId, event);
    if (loseAck) { loseAck = false; throw new Error('ACK lost after acceptance'); }
  }, { retryBaseMs: 5, retryMaxMs: 10 });
  try {
    const first = { runId: 'fixture', source: 'fixture', type: 'run.start', detail: { label: 'original' } };
    const id = outbox.enqueue(first);
    first.detail.label = 'mutated';
    outbox.enqueue({ runId: 'fixture', source: 'fixture', type: 'run.end', status: 'completed' });
    assert.equal(await outbox.flush({ timeoutMs: 1000 }), true);
    assert.equal(attempts.length, 3);
    assert.equal(attempts[0].eventId, id);
    assert.deepEqual(attempts[0], attempts[1]);
    assert.equal(attempts[0].detail.label, 'original');
    assert.deepEqual([...accepted.values()].map(e => e.type), ['run.start', 'run.end']);
  } finally { await outbox.close({ timeoutMs: 0 }); }
});

test('Event queues bound count, bytes and shutdown waits, and explicitly report loss', async () => {
  const drops = []; let aborted = false;
  const outbox = new EventOutbox((event, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => { aborted = true; reject(new Error('closed')); }, { once: true });
  }), { maxEvents: 2, maxBytes: 700, maxEventBytes: 500, onDrop: value => drops.push(value) });
  outbox.enqueue({ type: 'log', message: 'first' });
  outbox.enqueue({ type: 'log', message: 'second' });
  assert.equal(outbox.enqueue({ type: 'log', message: 'third' }), null);
  assert.equal(outbox.stats.pending, 2);
  assert.ok(outbox.stats.bytes <= 700);
  assert.equal(await outbox.flush({ timeoutMs: 5 }), false);
  const started = performance.now();
  assert.deepEqual(await outbox.close({ timeoutMs: 20 }), { flushed: false, dropped: 3, pending: 2 });
  assert.ok(performance.now() - started < 500);
  assert.equal(aborted, true);
  assert.equal(outbox.stats.bytes, 0);
  assert.equal(outbox.enqueue({ type: 'log' }), null);
  assert.deepEqual(drops.map(d => d.reason), ['queue_full', 'close_timeout']);

  const limited = new EventOutbox(async () => {}, { maxBytes: 80, maxEventBytes: 40, onDrop: value => drops.push(value) });
  assert.equal(limited.enqueue({ type: 'log', message: 'x'.repeat(1000) }), null);
  assert.equal(drops.at(-1).reason, 'event_too_large');
  await limited.close({ timeoutMs: 0 });

  const byteLimited = new EventOutbox(() => new Promise(() => {}), { maxEvents: 10, maxBytes: 300 });
  byteLimited.enqueue({ type: 'log', message: 'x'.repeat(100) });
  assert.equal(byteLimited.enqueue({ type: 'log', message: 'y'.repeat(100) }), null);
  assert.equal(byteLimited.stats.pending, 1);
  assert.ok(byteLimited.stats.bytes <= 300);
  await byteLimited.close({ timeoutMs: 0 });
});

test('An emit cancellation signal aborts a pending HTTP response', async () => {
  let received;
  const requestReady = new Promise(resolve => { received = resolve; });
  const server = createServer((req, res) => { req.resume(); received(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const controller = new AbortController();
  try {
    const pending = emit({ type: 'log' }, { url: `http://127.0.0.1:${server.address().port}`, token: 'fixture-token', signal: controller.signal });
    await requestReady; controller.abort();
    await assert.rejects(pending, /abort/i);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('Full queues reserve gap notices and run.end while bounding memory and preserving order', async () => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const delivered = [];
  const outbox = new EventOutbox(async event => { await blocked; delivered.push(event); }, { maxEvents: 4, maxBytes: 2000, reservedEvents: 2, reservedBytes: 500 });
  try {
    outbox.enqueue({ type: 'run.start' });
    outbox.enqueue({ type: 'tool.start' });
    assert.equal(outbox.enqueue({ type: 'tool.end' }), null);
    assert.ok(outbox.enqueue({ type: 'log', message: 'telemetry gap' }, { priority: true }));
    assert.ok(outbox.enqueue({ type: 'run.end', status: 'completed' }, { priority: true }));
    assert.equal(outbox.stats.pending, 4);
    assert.ok(outbox.stats.bytes <= 2000);
    release();
    assert.equal(await outbox.flush({ timeoutMs: 1000 }), true);
    assert.deepEqual(delivered.map(e => e.type), ['run.start', 'tool.start', 'log', 'run.end']);
    assert.equal(outbox.stats.dropped, 1);
  } finally { release(); await outbox.close({ timeoutMs: 0 }); }
});

test('An actual MCP child replays after reconnect and lost ACKs without reexecuting tools or changing stdout bytes', { timeout: 15000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-bay-proxy-test-'));
  const fixture = join(dir, 'fixture.mjs'), executions = join(dir, 'executions.txt');
  await writeFile(fixture, `import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', line => {
  const request = JSON.parse(line);
  if (request.method !== 'tools/call') return;
  appendFileSync(process.argv[2], 'executed\\n');
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text: '\u771f\u5b9e\u5b50\u8fdb\u7a0b\u7ed3\u679c \u2713' }], isError: false } }) + '\\r\\n');
});
`, 'utf8');
  const accepted = [], attempts = [], seen = new Set(); let lostAck = false;
  const server = createServer(async (req, res) => {
    const parts = []; for await (const part of req) parts.push(part);
    const event = JSON.parse(Buffer.concat(parts).toString('utf8'));
    attempts.push(event);
    const key = `${event.source}\0${event.runId}\0${event.eventId}`;
    if (!seen.has(key)) { seen.add(key); accepted.push(event); }
    if (event.type === 'tool.end' && !lostAck) { lostAck = true; res.destroy(); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}');
  });
  // Reserve and release a port: the proxy's first delivery genuinely fails offline.
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const proxy = spawn(process.execPath, [fileURLToPath(new URL('../scripts/mcp-proxy.mjs', import.meta.url)), '--name', 'Fixture MCP', '--', process.execPath, fixture, executions], {
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    env: { ...process.env, AGENT_BAY_URL: `http://127.0.0.1:${port}`, AGENT_BAY_BRIDGE_TOKEN: 'fixture-token' }
  });
  const stdout = [], stderr = []; let processExited = false;
  proxy.stdout.on('data', chunk => stdout.push(chunk)); proxy.stderr.on('data', chunk => stderr.push(chunk));
  const exited = new Promise((resolve, reject) => { proxy.on('error', reject); proxy.on('close', (code, signal) => { processExited = true; resolve({ code, signal }); }); });
  const request = { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'fixture_analyze', arguments: { target: '\u6837\u4f8b' } } };
  try {
    proxy.stdin.end(JSON.stringify(request) + '\r\n');
    for (let i = 0; i < 100 && !Buffer.concat(stderr).toString('utf8').includes('buffered'); i++) await delay(20);
    assert.match(Buffer.concat(stderr).toString('utf8'), /buffered/);
    await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
    assert.deepEqual(await exited, { code: 0, signal: null });
    assert.equal(await readFile(executions, 'utf8'), 'executed\n');
    const expected = JSON.stringify({ jsonrpc: '2.0', id: 7, result: { content: [{ type: 'text', text: '\u771f\u5b9e\u5b50\u8fdb\u7a0b\u7ed3\u679c \u2713' }], isError: false } }) + '\r\n';
    assert.deepEqual(Buffer.concat(stdout), Buffer.from(expected));
    assert.deepEqual(accepted.filter(e => ['run.start', 'tool.start', 'tool.end', 'run.end'].includes(e.type)).map(e => e.type), ['run.start', 'tool.start', 'tool.end', 'run.end']);
    assert.equal(accepted.at(-1).status, 'completed');
    const retries = attempts.filter(e => e.type === 'tool.end');
    assert.equal(retries.length, 2);
    assert.deepEqual(retries[0], retries[1]);
    assert.equal(accepted.find(e => e.type === 'tool.start').callId, accepted.find(e => e.type === 'tool.end').callId);
    assert.match(Buffer.concat(stderr).toString('utf8'), /connection restored/);
  } finally {
    if (!processExited) { proxy.kill(); await exited; }
    server.closeAllConnections(); if (server.listening) await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

test('The actual /api/events route records one run and tool summary after a proxy loses an ACK', { timeout: 15000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-bay-proxy-route-test-'));
  const fixture = join(dir, 'fixture.mjs'), executions = join(dir, 'executions.txt');
  await writeFile(fixture, `import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', line => {
  const request = JSON.parse(line);
  if (request.method !== 'tools/call') return;
  appendFileSync(process.argv[2], 'executed\\n');
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text: 'Actual event route result' }] } }) + '\\n');
});


`, 'utf8');
  const app = createApp({ bridgeToken: 'fixture-route-token' });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const backend = `http://127.0.0.1:${app.server.address().port}`;
  const attempts = [], responses = [], swallowed = new Set();
  const forward = createServer(async (req, res) => {
    const parts = []; for await (const part of req) parts.push(part);
    const body = Buffer.concat(parts), event = JSON.parse(body.toString('utf8'));
    attempts.push(event);
    const response = await fetch(backend + '/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: req.headers.authorization }, body });
    const text = await response.text();
    responses.push({ type: event.type, status: response.status, ack: JSON.parse(text) });
    if (['run.start', 'tool.end', 'run.end'].includes(event.type) && !swallowed.has(event.type)) {
      swallowed.add(event.type); res.destroy(); return;
    }
    res.writeHead(response.status, { 'Content-Type': 'application/json' }); res.end(text);
  });
  await new Promise(resolve => forward.listen(0, '127.0.0.1', resolve));
  const proxy = spawn(process.execPath, [fileURLToPath(new URL('../scripts/mcp-proxy.mjs', import.meta.url)), '--name', 'Actual Route MCP', '--', process.execPath, fixture, executions], {
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    env: { ...process.env, AGENT_BAY_URL: `http://127.0.0.1:${forward.address().port}`, AGENT_BAY_BRIDGE_TOKEN: 'fixture-route-token' }
  });
  const stdout = [], stderr = []; let processExited = false;
  proxy.stdout.on('data', chunk => stdout.push(chunk)); proxy.stderr.on('data', chunk => stderr.push(chunk));
  const exited = new Promise((resolve, reject) => { proxy.on('error', reject); proxy.on('close', (code, signal) => { processExited = true; resolve({ code, signal }); }); });
  try {
    proxy.stdin.end(JSON.stringify({ jsonrpc: '2.0', id: 'route-1', method: 'tools/call', params: { name: 'actual_analyze', arguments: { target: 'local fixture' } } }) + '\n');
    assert.deepEqual(await exited, { code: 0, signal: null });
    assert.equal(await readFile(executions, 'utf8'), 'executed\n');
    assert.equal(Buffer.concat(stdout).toString('utf8').trim().split('\n').length, 1);
    const state = await (await fetch(backend + '/api/state')).json();
    assert.equal(state.runs.length, 1);
    assert.equal(state.runs[0].status, 'completed');
    assert.equal(state.runs[0].summary.calls, 1);
    assert.equal(state.runs[0].summary.success, 1);
    assert.equal(state.runs[0].summary.errors, 0);
    assert.equal(state.runs[0].summary.pending, 0);
    assert.equal(state.runs[0].summary.events, 6);
    assert.deepEqual(state.events.map(e => e.type), ['run.start', 'log', 'stage', 'tool.start', 'tool.end', 'run.end']);
    for (const type of ['run.start', 'tool.end', 'run.end']) {
      const retried = attempts.filter(e => e.type === type);
      assert.equal(retried.length, 2);
      assert.deepEqual(retried[0], retried[1]);
      assert.equal(responses.filter(r => r.type === type).at(-1).ack.duplicate, true);
    }
    assert.ok(responses.every(r => [200, 201].includes(r.status)));
  } finally {
    if (!processExited) { proxy.kill(); await exited; }
    forward.closeAllConnections(); await new Promise(resolve => forward.close(resolve));
    app.server.closeAllConnections(); await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('An offline proxy with a full buffer still reports gaps and run.end without blocking tools', { timeout: 15000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-bay-proxy-full-test-'));
  const fixture = join(dir, 'fixture.mjs'), executions = join(dir, 'executions.txt');
  await writeFile(fixture, `import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', line => {
  const request = JSON.parse(line);
  appendFileSync(process.argv[2], 'executed\\n');
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text: 'ok' }] } }) + '\\n');
});
`, 'utf8');
  const app = createApp({ bridgeToken: 'fixture-overflow-token' });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const port = app.server.address().port;
  await new Promise(resolve => app.server.close(resolve));
  const proxy = spawn(process.execPath, [fileURLToPath(new URL('../scripts/mcp-proxy.mjs', import.meta.url)), '--name', 'Overflow MCP', '--', process.execPath, fixture, executions], {
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    env: { ...process.env, AGENT_BAY_URL: `http://127.0.0.1:${port}`, AGENT_BAY_BRIDGE_TOKEN: 'fixture-overflow-token' }
  });
  let output = '', stderr = '', processExited = false;
  proxy.stdout.on('data', chunk => { output += chunk.toString('utf8'); }); proxy.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
  const exited = new Promise((resolve, reject) => { proxy.on('error', reject); proxy.on('close', (code, signal) => { processExited = true; resolve({ code, signal }); }); });
  try {
    const requests = Array.from({ length: 180 }, (_, id) => JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'fast_analyze', arguments: {} } }));
    proxy.stdin.end(requests.join('\n') + '\n');
    for (let i = 0; i < 150 && (output.split('\n').length - 1 < 180 || !stderr.includes('dropped')); i++) await delay(20);
    assert.equal(output.trim().split('\n').length, 180);
    assert.match(stderr, /dropped/);
    await new Promise(resolve => app.server.listen(port, '127.0.0.1', resolve));
    assert.deepEqual(await exited, { code: 0, signal: null });
    assert.equal((await readFile(executions, 'utf8')).trim().split('\n').length, 180);
    const state = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json();
    assert.equal(state.runs.length, 1);
    assert.equal(state.runs[0].status, 'completed');
    assert.equal(state.events.length, 512);
    assert.equal(state.events.at(-1).type, 'run.end');
    assert.match(state.events.at(-2).message, /Event collection has gaps/);
    assert.match(state.events.at(-2).message, /32 delivery events dropped/);
    assert.match(stderr, /Lost 32 events in this session/);
  } finally {
    if (!processExited) { proxy.kill(); await exited; }
    if (!app.server.listening) await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    app.server.closeAllConnections(); await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
