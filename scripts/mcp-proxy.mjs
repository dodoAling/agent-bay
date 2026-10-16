import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { emit } from './emit.mjs';
import { EventOutbox } from '../src/event-outbox.mjs';

const split = process.argv.indexOf('--');
if (split < 0 || !process.argv[split + 1]) { console.error('Usage: node scripts/mcp-proxy.mjs --name REA -- node path/to/rea.mjs mcp'); process.exit(1); }
const nameIndex = process.argv.indexOf('--name');
const source = String(nameIndex > 0 ? process.argv[nameIndex + 1] : 'MCP Agent').slice(0, 100);
const runId = `mcp-${randomUUID()}`, pending = new Map();
const inputDecoder = new StringDecoder('utf8'), outputDecoder = new StringDecoder('utf8');
let shuttingDown = false, finishing = false, inputBuffer = '', outputBuffer = '', untracked = 0;
const requestKey = id => createHash('sha256').update(JSON.stringify(id)).digest('hex');
const outbox = new EventOutbox((event, options) => emit(event, options), {
  // Leave room for a visible telemetry-gap notice and run.end after an outage.
  reservedEvents: 2, reservedBytes: 2048,
  onError: ({ attempt, retryMs }) => {
    if (attempt === 1) console.error(`[Agent Bay] Event connection interrupted; buffered events will retry automatically (starting at ${retryMs} ms). MCP tool communication continues.`);
  },
  onRecovered: () => console.error('[Agent Bay] Event connection restored; replaying buffered events in order.'),
  onDrop: ({ reason, dropped, pending }) => {
    if (reason === 'close_timeout') console.error(`[Agent Bay] Close wait timed out; dropped ${pending} undelivered events; ${dropped} events lost in total.`);
    else if (dropped === 1 || dropped % 100 === 0) console.error(`[Agent Bay] Event buffer is full or an event is oversized; dropped ${dropped} in total; ${pending} buffered.`);
  }
});
function send(event, options) {
  return outbox.enqueue({ runId, source, ...event }, options);
}
send({ type: 'run.start', title: `${source} / MCP agent session` });
send({ type: 'log', message: 'MCP proxy connected. Tool activity is displayed; the agent must report model text separately.' });
const child = spawn(process.argv[split + 1], process.argv.slice(split + 2), { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
child.stdin.on('error', () => {});
function inspect(buffer, chunk, direction) {
  buffer += (direction === 'in' ? inputDecoder : outputDecoder).write(chunk);
  let newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
    try {
      const message = JSON.parse(line);
      if (direction === 'in' && message.method === 'tools/call' && message.id != null) {
        const callId = randomUUID(), name = String(message.params?.name || 'unknown').slice(0, 200);
        if (pending.size >= 4096) {
          pending.delete(pending.keys().next().value); untracked++;
          if (untracked === 1 || untracked % 100 === 0) console.error(`[Agent Bay] Pending-call tracking reached its 4096-call limit; ${untracked} older calls are no longer tracked. MCP bytes are still forwarded unchanged.`);
        }
        pending.set(requestKey(message.id), { callId, name, at: performance.now() });
        send({ type: 'stage', stage: 'execute', message: name });
        send({ type: 'tool.start', callId, name, args: message.params?.arguments || {} });
      }
      if (direction === 'out' && message.id != null) {
        const key = requestKey(message.id), call = pending.get(key);
        if (call) {
          pending.delete(key);
          const raw = message.result ?? message.error;
          const serialized = JSON.stringify(raw);
          const result = serialized?.length > 80000 ? { truncated: true, preview: serialized.slice(0, 80000) } : raw;
          send({ type: 'tool.end', ...call, at: undefined, ok: !message.error && !message.result?.isError, durationMs: Math.round(performance.now() - call.at), result });
        }
      }
    } catch {}
  }
  return buffer.length > 12_000_000 ? '' : buffer;
}
process.stdin.on('data', chunk => { inputBuffer = inspect(inputBuffer, chunk, 'in'); if (!child.stdin.write(chunk)) process.stdin.pause(); });
child.stdin.on('drain', () => process.stdin.resume());
process.stdin.on('end', () => { shuttingDown = true; child.stdin.end(); });
child.stdout.on('data', chunk => { outputBuffer = inspect(outputBuffer, chunk, 'out'); if (!process.stdout.write(chunk)) child.stdout.pause(); });
process.stdout.on('drain', () => child.stdout.resume());
process.stdout.on('error', () => child.kill());
async function finish(code, signal, spawnError) {
  if (finishing) return;
  finishing = true;
  for (const call of pending.values()) send({ type: 'tool.end', callId: call.callId, name: call.name, ok: false, durationMs: Math.round(performance.now() - call.at), result: { error: 'The MCP service exited' } });
  pending.clear();
  if (outbox.stats.dropped || untracked) send({ type: 'log', message: `Event collection has gaps: ${outbox.stats.dropped} delivery events dropped and ${untracked} older calls no longer tracked. Tools continued running; dashboard tool counts and states may be incomplete.` }, { priority: true });
  send({ type: 'run.end', status: code === 0 ? 'completed' : shuttingDown ? 'cancelled' : 'failed', message: String(spawnError || (signal ? `Service received ${signal}` : `MCP service exited (${code})`)).slice(0, 200) }, { priority: true });
  const delivery = await outbox.close({ timeoutMs: 6000 });
  if (delivery.dropped && !delivery.pending) console.error(`[Agent Bay] Lost ${delivery.dropped} events in this session; remaining buffered events were delivered.`);
  process.stdin.destroy();
  process.exitCode = code ?? (signal ? 1 : 0);
}
child.on('error', error => { console.error(error.message); finish(1, null, error.message); });
// close follows stdout EOF; exit can fire before the last MCP response bytes.
child.on('close', (code, signal) => finish(code, signal));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { shuttingDown = true; child.kill(signal); });
