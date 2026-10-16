import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

export const EVENT_TYPES = new Set(['run.start', 'run.end', 'stage', 'log', 'model.start', 'model.delta', 'model.end', 'tool.start', 'tool.end', 'check', 'artifact']);
export const STAGES = ['observe', 'reason', 'execute', 'verify'];
export const EVENT_LIMIT = 5000;

const emptySummary = () => ({ calls: 0, success: 0, errors: 0, pending: 0, checks: 0, checksPassed: 0, tokens: 0, usageReported: false, events: 0 });
const identity = value => (typeof value === 'string' && value.length || typeof value === 'number' && Number.isFinite(value)) ? String(value) : null;
function usageTotal(usage = {}) {
  const count = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
  const total = count(usage?.total_tokens);
  if (total != null) return total;
  const input = count(usage?.input_tokens) ?? count(usage?.prompt_tokens);
  const output = count(usage?.output_tokens) ?? count(usage?.completion_tokens);
  return input != null || output != null ? (input ?? 0) + (output ?? 0) : null;
}

export class EventStore extends EventEmitter {
  constructor() {
    super();
    this.events = [];
    this.runs = new Map();
    // Lifetime identifiers are separate from the bounded detail window. Results
    // and input payloads remain only in events; the index keeps small states.
    this.statistics = new Map();
    this.sequence = 0;
    this.secrets = new Set();
  }
  rememberSecret(value) { if (value?.length >= 4) this.secrets.add(value); }
  scrub(value) {
    if (typeof value === 'string') {
      for (const secret of this.secrets) value = value.split(secret).join('[redacted]');
      return value.slice(0, 80_000);
    }
    if (Array.isArray(value)) return value.map(v => this.scrub(v));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, /api.?key|authorization|password|secret|access.?token/i.test(key) ? '[redacted]' : this.scrub(v)]));
    return value;
  }
  start({ title = 'Untitled task', source = 'external', mode = 'live', model = '', target = '', id = randomUUID() } = {}) {
    if (this.runs.has(id)) throw new Error('Task ID already exists.');
    if (this.runs.size >= 100) {
      const oldest = [...this.runs.values()].find(r => r.status !== 'running');
      if (!oldest) throw new Error('Too many tasks are running concurrently.');
      this.runs.delete(oldest.id);
      this.statistics.delete(oldest.id);
      this.events = this.events.filter(e => e.runId !== oldest.id);
    }
    this.runs.set(id, { ...this.scrub({ id, title, source, mode, model, target, status: 'running', stage: 'observe', startedAt: Date.now(), endedAt: null }), summary: emptySummary() });
    this.statistics.set(id, { calls: new Map(), modelEnds: new Set() });
    this.push({ runId: id, type: 'run.start', source, title });
    return this.runs.get(id);
  }
  push(input) {
    if (!EVENT_TYPES.has(input.type)) throw new Error('Unknown event type.');
    const run = this.runs.get(input.runId);
    if (!run) throw new Error('Task not found. Send run.start first.');
    if (input.type === 'stage' && !STAGES.includes(input.stage)) throw new Error('Stage must be observe, reason, execute, or verify.');
    if (input.type === 'check' && !['passed', 'failed', 'unknown'].includes(input.status)) throw new Error('Check status must be passed, failed, or unknown.');
    if (input.type === 'run.end' && !['completed', 'failed', 'cancelled'].includes(input.status)) throw new Error('Invalid task status.');
    if (run.status !== 'running' && input.type !== 'run.end') throw new Error('This task has ended.');
    // These fields are server-owned. An external emitter cannot forge totals or
    // attach a replacement run, including through a run.start-shaped payload.
    const { runSummary, summary, run: suppliedRun, duplicate, ...payload } = input;
    const event = { ...this.scrub(payload), id: ++this.sequence, at: Date.now(), source: String(input.source || run.source).slice(0, 100) };
    const totals = run.summary, index = this.statistics.get(input.runId);
    totals.events++;
    if (event.type === 'tool.start' || event.type === 'tool.end') {
      const key = identity(event.callId) ?? `event-${event.id}`;
      const previous = index.calls.get(key);
      if (event.type === 'tool.start') {
        if (previous) event.duplicate = true;
        else { index.calls.set(key, { pending: true }); totals.calls++; totals.pending++; }
      } else if (previous && !previous.pending) event.duplicate = true;
      else {
        if (previous) totals.pending--;
        else totals.calls++;
        index.calls.set(key, { pending: false });
        if (event.ok === true) totals.success++;
        if (event.ok === false) totals.errors++;
      }
    }
    if (event.type === 'check') { totals.checks++; if (event.status === 'passed') totals.checksPassed++; }
    if (event.type === 'model.end') {
      const key = identity(event.messageId) ?? `event-${event.id}`;
      if (index.modelEnds.has(key)) event.duplicate = true;
      else {
        index.modelEnds.add(key);
        const count = usageTotal(event.usage);
        if (count != null) { totals.tokens += count; totals.usageReported = true; }
      }
    }
    event.runSummary = { ...totals };
    if (event.type === 'run.start') event.run = structuredClone(run);
    this.events.push(event);
    if (this.events.length > EVENT_LIMIT) this.events.shift();
    if (event.type === 'stage') run.stage = event.stage;
    if (event.type === 'run.end') { run.status = event.status; run.endedAt = event.at; }
    this.emit('event', event);
    return event;
  }
  snapshot() { return structuredClone({ runs: [...this.runs.values()], events: this.events, sequence: this.sequence, retention: { eventLimit: EVENT_LIMIT } }); }
}
