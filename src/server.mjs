import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { EventStore, EVENT_TYPES } from './events.mjs';
import { ToolHub, detectRea } from './mcp.mjs';
import { AgentRunner } from './agent.mjs';
import { playDemo } from './demo.mjs';

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const STATIC = new Map([['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']], ['/styles.css', ['styles.css', 'text/css']], ['/factory-theme.css', ['factory-theme.css', 'text/css']], ['/factory-view.js', ['factory-view.js', 'text/javascript']], ['/demo-player.js', ['demo-player.js', 'text/javascript']], ['/demo-scenarios.js', ['demo-scenarios.js', 'text/javascript']]]);
for (const [file, mime] of [['settings.css', 'text/css'], ['themed-select.css', 'text/css'], ['themed-select.js', 'text/javascript'], ['demo-export.js', 'text/javascript'], ['vendor/demo-export-vendor.js', 'text/javascript']]) STATIC.set(`/${file}`, [file, mime]);

export function createApp({ bridgeToken = process.env.AGENT_BAY_BRIDGE_TOKEN || randomBytes(24).toString('hex') } = {}) {
  const store = new EventStore();
  store.rememberSecret(bridgeToken);
  const hub = new ToolHub(store), agent = new AgentRunner(store, hub);
  const streams = new Set();
  let demoRunning = false;
  const deliveries = new Map();
  function acknowledge(input, event) {
    if (!input.eventId) return;
    let ledger = deliveries.get(input.runId);
    if (!ledger) deliveries.set(input.runId, ledger = new Map());
    const key = `${String(input.source || 'external').slice(0, 100)}\0${input.eventId}`;
    ledger.set(key, { digest: createHash('sha256').update(JSON.stringify(input)).digest('hex'), ack: { runId: input.runId, eventId: input.eventId, id: event.id, at: event.at, acknowledged: true } });
    if (ledger.size > 4096) ledger.delete(ledger.keys().next().value);
  }
  const snapshot = () => ({ ...store.snapshot(), connections: hub.summary(), model: agent.summary(), activeRun: agent.active?.runId || null });
  const broadcast = (event, data) => {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of streams) {
      if (res.writableLength > 2_000_000) { res.destroy(); streams.delete(res); }
      else res.write(frame);
    }
  };
  store.on('event', event => broadcast('update', event));
  store.on('connections', () => broadcast('connections', { connections: hub.summary(), model: agent.summary(), activeRun: agent.active?.runId || null }));
  const heartbeat = setInterval(() => { for (const res of streams) res.write(': heartbeat\n\n'); }, 15000).unref();

  const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  async function body(req) {
    if (!(req.headers['content-type'] || '').startsWith('application/json')) throw new Error('Use application/json.');
    let bytes = 0, chunks = [];
    for await (const chunk of req) { bytes += chunk.length; if (bytes > 256_000) throw new Error('Request body is too large.'); chunks.push(chunk); }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Request body must be a JSON object.');
    return value;
  }
  function authenticated(req) {
    const supplied = Buffer.from(String(req.headers.authorization || '').replace(/^Bearer /, ''));
    const actual = Buffer.from(bridgeToken);
    return supplied.length === actual.length && timingSafeEqual(supplied, actual);
  }
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const connections = process.env.AGENT_BAY_DESKTOP === '1' ? "'self' ipc: http://ipc.localhost https://ipc.localhost" : "'self'";
    res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src ${connections}; frame-src 'self'; frame-ancestors 'self'`);
    const host = req.headers.host || '';
    if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)) return json(res, 403, { error: 'Only local access is allowed.' });
    if (req.headers.origin && ![`http://${host}`, `https://${host}`].includes(req.headers.origin)) return json(res, 403, { error: 'Cross-site requests are not allowed.' });
    if (req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { error: 'Cross-site requests are not allowed.' });
    try {
      const url = new URL(req.url, `http://${host}`);
      if (req.method === 'GET' && STATIC.has(url.pathname)) {
        const [file, mime] = STATIC.get(url.pathname);
        res.writeHead(200, { 'Content-Type': mime + '; charset=utf-8', 'Cache-Control': 'no-cache' });
        return res.end(await readFile(join(publicDir, file)));
      }
      if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, snapshot());
      if (req.method === 'GET' && url.pathname === '/api/setup') return json(res, 200, { rea: detectRea(), bridgeToken });
      if (req.method === 'GET' && url.pathname === '/api/stream') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
        streams.add(res);
        res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`);
        req.on('close', () => streams.delete(res));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/model') {
        const result = agent.configure(await body(req));
        store.emit('connections');
        return json(res, 200, result);
      }
      if (req.method === 'POST' && url.pathname === '/api/model/clear') {
        if (agent.active) throw new Error('Stop the current task first.');
        agent.config = null; store.emit('connections');
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/mcp/connect') return json(res, 200, await hub.connect(await body(req)));
      if (req.method === 'POST' && url.pathname === '/api/mcp/select') { const input = await body(req); hub.select(input.serverId, input.names); return json(res, 200, { ok: true }); }
      if (req.method === 'POST' && url.pathname === '/api/mcp/disconnect') { await hub.disconnect((await body(req)).serverId); return json(res, 200, { ok: true }); }
      if (req.method === 'POST' && url.pathname === '/api/mcp/call') {
        if (hub.busy) throw new Error('A tool task is already running.');
        const input = await body(req);
        const serverInfo = hub.servers.get(input.serverId);
        if (!serverInfo || !serverInfo.tools.some(t => t.name === input.name)) throw new Error('Tool not found.');
        if (!input.args || Array.isArray(input.args) || typeof input.args !== 'object') throw new Error('Tool arguments must be a JSON object.');
        const run = store.start({ title: `${serverInfo.name} / ${input.name}`, source: 'manual', target: input.name });
        hub.busy = true;
        json(res, 202, { runId: run.id });
        (async () => {
          try {
            store.push({ runId: run.id, type: 'stage', stage: 'execute' });
            const result = await hub.call(run.id, { serverId: input.serverId, name: input.name }, input.args);
            store.push({ runId: run.id, type: 'run.end', status: result.isError ? 'failed' : 'completed' });
          } catch (error) { store.push({ runId: run.id, type: 'run.end', status: 'failed', message: error.message }); }
          finally { hub.busy = false; store.emit('connections'); }
        })();
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/run') return json(res, 202, { runId: agent.start(await body(req)).id });
      if (req.method === 'POST' && url.pathname === '/api/stop') { agent.stop(); return json(res, 200, { ok: true }); }
      if (req.method === 'POST' && url.pathname === '/api/demo') {
        if (demoRunning || hub.busy) throw new Error('Wait for the current task to finish.');
        demoRunning = true;
        playDemo(store).catch(error => console.error(store.scrub(error.message))).finally(() => { demoRunning = false; });
        return json(res, 202, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/events') {
        if (!authenticated(req)) return json(res, 401, { error: 'Provide a valid event access token.' });
        const input = await body(req);
        if (!EVENT_TYPES.has(input.type)) throw new Error('Invalid event type.');
        if (input.type === 'run.start') input.runId = String(input.runId || '').trim();
        if (input.eventId !== undefined && (typeof input.eventId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.eventId))) throw new Error('eventId must use letters, digits, underscores, or hyphens, up to 128 characters.');
        for (const runId of deliveries.keys()) if (!store.runs.has(runId)) deliveries.delete(runId);
        if (input.eventId) {
          const key = `${String(input.source || 'external').slice(0, 100)}\0${input.eventId}`;
          const prior = deliveries.get(input.runId)?.get(key);
          if (prior) {
            if (prior.digest !== createHash('sha256').update(JSON.stringify(input)).digest('hex')) return json(res, 409, { error: 'The same eventId cannot be reused for different event content.' });
            return json(res, 200, { ...prior.ack, duplicate: true });
          }
        }
        if (input.type === 'run.start') {
          const id = String(input.runId || '').trim();
          if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error('runId must use letters, digits, underscores, or hyphens, up to 100 characters.');
          const source = String(input.source || 'external').slice(0, 100);
          const run = store.start({ id, title: String(input.title || 'External agent task').slice(0, 200), source, mode: 'external', model: String(input.model || '').slice(0, 150), target: String(input.target || '').slice(0, 1000) });
          acknowledge(input, store.events.at(-1));
          return json(res, 201, { runId: run.id });
        }
        const run = store.runs.get(input.runId);
        if (!run || run.mode !== 'external') throw new Error('Events can only be written to externally connected tasks.');
        const event = store.push(input);
        acknowledge(input, event);
        return json(res, 200, event);
      }
      return json(res, 404, { error: 'Route not found.' });
    } catch (error) { if (!res.headersSent) return json(res, 400, { error: store.scrub(error.message) }); res.end(); }
  });
  let closing;
  function close() {
    if (!closing) closing = (async () => {
      clearInterval(heartbeat); agent.stop();
      for (const res of streams) res.end();
      streams.clear();
      // Stop accepting HTTP immediately while MCP children finish their own
      // bounded transport shutdown. Repeated lifecycle signals share this work.
      const httpClosed = new Promise(resolve => server.close(resolve));
      server.closeIdleConnections();
      await Promise.all([hub.close(), httpClosed]);
    })();
    return closing;
  }
  return { server, store, hub, agent, close };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const app = createApp();
  const port = Number(process.env.PORT || 4318);
  app.server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}`;
    console.log(`Agent Bay · ${url}`);
    if (process.argv.includes('--open')) {
      const opener = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      const child = spawn(opener, [url], { detached: true, windowsHide: true, stdio: 'ignore' });
      child.on('error', () => console.log(`Open ${url} in your browser.`));
      child.unref();
    }
  });
  app.server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} is in use. Set PORT to use a different port.` : error.message); process.exitCode = 1; });
  process.on('SIGINT', () => app.close().then(() => process.exit(0)));
  process.on('SIGTERM', () => app.close().then(() => process.exit(0)));
}
