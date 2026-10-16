import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { mkdtemp, mkdir, cp, writeFile, readFile, rm, symlink, unlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bootstrap = join(root, 'desktop', 'bootstrap.mjs');
const temporaryPrefix = join(tmpdir(), 'agent-bay-desktop-');

async function within(promise, milliseconds = 10_000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Desktop fixture timed out.')), milliseconds); })]); }
  finally { clearTimeout(timer); }
}

async function temporaryDirectory() { return mkdtemp(temporaryPrefix); }

async function removeFixture(directory) {
  const target = resolve(directory);
  assert.ok(target.startsWith(resolve(temporaryPrefix)), 'temporary cleanup stays within its named fixture prefix');
  const modules = join(target, 'server', 'node_modules');
  const link = await lstat(modules).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (link) { assert.ok(link.isSymbolicLink(), 'fixture dependencies remain a link'); await unlink(modules); }
  await rm(target, { recursive: true, force: true });
}

function startDesktop(t, { entry = bootstrap, cwd = root, env = {} } = {}) {
  const child = spawn(process.execPath, [entry], {
    cwd, env: { ...process.env, PORT: '0', AGENT_BAY_DESKTOP: '1', AGENT_BAY_PARENT_PID: String(process.pid), AGENT_BAY_BRIDGE_TOKEN: 'desktop-fixture-token', ...env },
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '', lineBuffer = '', resolveReady, rejectReady, readySeen = false;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  // Failure-mode tests deliberately never await readiness.
  ready.catch(() => {});
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', text => {
    stdout += text; lineBuffer += text;
    let end;
    while ((end = lineBuffer.indexOf('\n')) !== -1) {
      const line = lineBuffer.slice(0, end).replace(/\r$/, ''); lineBuffer = lineBuffer.slice(end + 1);
      if (line.startsWith('AGENT_BAY_READY ')) {
        try { readySeen = true; resolveReady(JSON.parse(line.slice('AGENT_BAY_READY '.length))); }
        catch (error) { rejectReady(error); }
      }
    }
  });
  child.stderr.on('data', text => { stderr += text; });
  const closed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
  closed.then(result => { if (!readySeen) rejectReady(new Error(`Desktop exited before readiness (${result.code}).`)); }, rejectReady);
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.stdin.end();
    try { await within(closed, 7_000); }
    catch { child.kill(); await within(closed); }
  });
  return { child, ready, closed, output: () => ({ stdout, stderr }) };
}

async function request(base, path, payload) {
  const response = await fetch(base + path, payload === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await response.json();
  assert.ok(response.ok, `fixture request ${path} returned ${response.status}`);
  return data;
}

async function portIsReleased(port) {
  const server = createTcpServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  await new Promise(resolve => server.close(resolve));
}

async function processHasExited(pid) {
  for (let attempt = 0; attempt < 30; attempt++) {
    try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') return true; throw error; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return false;
}

test('Desktop readiness serves the API; shutdown closes SSE, model requests, MCP children and its port', { timeout: 20_000 }, async t => {
  const directory = await temporaryDirectory(), pidFile = join(directory, 'mcp.pid'), fixture = join(directory, 'mcp-fixture.mjs');
  await writeFile(fixture, `import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';
writeFileSync(process.argv[2], String(process.pid));
const input = createInterface({ input: process.stdin, terminal: false });
const timer = setInterval(() => {}, 1000);
input.on('line', line => {
  const request = JSON.parse(line); if (request.id === undefined) return;
  const result = request.method === 'initialize' ? { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'desktop-fixture', version: '1' } }
    : request.method === 'tools/list' ? { tools: [{ name: 'ping', inputSchema: { type: 'object' } }] }
    : { content: [{ type: 'text', text: 'pong' }] };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n');
});
input.once('close', () => { clearInterval(timer); process.exit(0); });
`);
  let providerReceived, providerClosed;
  const requested = new Promise(resolve => { providerReceived = resolve; });
  const aborted = new Promise(resolve => { providerClosed = resolve; });
  const provider = createHttpServer((req, res) => { req.resume(); res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(': pending\n\n'); res.once('close', providerClosed); providerReceived(); });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  t.after(async () => { provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve)); });
  const desktop = startDesktop(t, { env: { PATH: '' } });
  t.after(() => removeFixture(directory));
  const ready = await within(desktop.ready);
  assert.equal(ready.pid, desktop.child.pid);
  assert.ok(Number.isInteger(ready.port) && ready.port > 0);
  assert.equal(ready.url, `http://127.0.0.1:${ready.port}`);
  assert.deepEqual((await request(ready.url, '/api/state')).runs, []);
  const document = await fetch(ready.url);
  assert.match(document.headers.get('content-security-policy'), /connect-src 'self' ipc: http:\/\/ipc\.localhost https:\/\/ipc\.localhost;/, 'the desktop page permits native IPC');
  const response = await fetch(ready.url + '/api/stream'), reader = response.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /event: snapshot/);
  const drained = (async () => { while (!(await reader.read()).done) {} })();
  const connected = await request(ready.url, '/api/mcp/connect', { name: 'Fixture MCP', command: 'node', args: [fixture, pidFile] });
  assert.equal(connected.count, 1);
  const mcpPid = Number(await readFile(pidFile, 'utf8'));
  await request(ready.url, '/api/model', { protocol: 'openai-compatible', baseUrl: `http://127.0.0.1:${provider.address().port}/v1`, model: 'fixture', apiKey: 'fixture-secret' });
  await request(ready.url, '/api/run', { prompt: 'Wait for a model response.' });
  await within(requested);
  desktop.child.stdin.write('AGENT_BAY_SHUTDOWN\n');
  assert.deepEqual(await within(desktop.closed), { code: 0, signal: null });
  await within(Promise.all([drained, aborted]));
  assert.ok(await processHasExited(mcpPid), 'the owned MCP child exited');
  await portIsReleased(ready.port);
  assert.equal(desktop.output().stdout.trim().split('\n').length, 1, 'stdout contains exactly one ready message');
  assert.equal(desktop.output().stderr, '');
  assert.ok(!desktop.output().stdout.includes('fixture-secret'));
});

test('Desktop stdin EOF gracefully stops its backend and releases the port', { timeout: 12_000 }, async t => {
  const desktop = startDesktop(t), ready = await within(desktop.ready);
  desktop.child.stdin.end();
  assert.equal((await within(desktop.closed)).code, 0);
  await portIsReleased(ready.port);
});

test('Packaged bootstrap locates sibling src and public independently of the working directory', { timeout: 15_000 }, async t => {
  const directory = await temporaryDirectory(), resources = join(directory, 'server');
  await mkdir(join(resources, 'public'), { recursive: true });
  await cp(join(root, 'src'), join(resources, 'src'), { recursive: true });
  await cp(bootstrap, join(resources, 'bootstrap.mjs'));
  await writeFile(join(resources, 'public', 'index.html'), '<!doctype html><title>Staged desktop fixture</title>');
  const modules = join(resources, 'node_modules');
  await symlink(join(root, 'node_modules'), modules, process.platform === 'win32' ? 'junction' : 'dir');
  const desktop = startDesktop(t, { entry: join(resources, 'bootstrap.mjs'), cwd: directory });
  t.after(() => removeFixture(directory));
  const ready = await within(desktop.ready);
  assert.match(await (await fetch(ready.url)).text(), /Staged desktop fixture/);
  assert.deepEqual((await request(ready.url, '/api/state')).runs, []);
  desktop.child.stdin.write('AGENT_BAY_SHUTDOWN\n');
  assert.equal((await within(desktop.closed)).code, 0);
  await portIsReleased(ready.port);
});

test('Desktop parent disappearance shuts down the backend even while stdin remains open', { timeout: 12_000 }, async t => {
  const parent = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true, stdio: 'ignore' });
  const parentClosed = new Promise(resolve => parent.once('close', resolve));
  t.after(async () => { if (parent.exitCode === null && parent.signalCode === null) parent.kill(); await parentClosed; });
  const desktop = startDesktop(t, { env: { AGENT_BAY_PARENT_PID: String(parent.pid) } }), ready = await within(desktop.ready);
  parent.kill(); await parentClosed;
  assert.equal((await within(desktop.closed)).code, 0);
  await portIsReleased(ready.port);
});

test('Invalid desktop parent configuration fails without echoing environment values', { timeout: 10_000 }, async t => {
  const desktop = startDesktop(t, { env: { AGENT_BAY_PARENT_PID: 'invalid-private-value' } });
  assert.equal((await within(desktop.closed)).code, 1);
  assert.equal(desktop.output().stdout, '');
  assert.match(desktop.output().stderr, /Invalid desktop parent process ID/);
  assert.ok(!desktop.output().stderr.includes('invalid-private-value'));
});
