import { randomUUID } from 'node:crypto';

// This queue only owns telemetry. MCP input/output never passes through it.
export class EventOutbox {
  constructor(send, { maxEvents = 512, maxBytes = 4 * 1024 * 1024, maxEventBytes = 240 * 1024, reservedEvents = 0, reservedBytes = 0, retryBaseMs = 200, retryMaxMs = 5000, onError = () => {}, onRecovered = () => {}, onDrop = () => {} } = {}) {
    if (typeof send !== 'function') throw new TypeError('Event sender is required');
    for (const [name, value] of Object.entries({ maxEvents, maxBytes, maxEventBytes, retryBaseMs, retryMaxMs })) {
      if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be positive`);
    }
    if (!Number.isInteger(reservedEvents) || reservedEvents < 0 || reservedEvents >= maxEvents || !Number.isFinite(reservedBytes) || reservedBytes < 0 || reservedBytes >= maxBytes) throw new RangeError('Reserved capacity must fit within queue limits');
    Object.assign(this, { send, maxEvents, maxBytes, maxEventBytes, reservedEvents, reservedBytes, retryBaseMs, retryMaxMs, onError, onRecovered, onDrop });
    this.queue = []; this.bytes = 0; this.dropped = 0; this.retryCount = 0;
    this.busy = false; this.accepting = true; this.closed = false;
    this.retryTimer = null; this.controller = null; this.waiters = new Set();
  }

  enqueue(event, { priority = false } = {}) {
    if (!this.accepting) return null;
    // Snapshot once. Every delivery attempt reuses the same ID and contents.
    const eventId = event.eventId || randomUUID();
    const payload = JSON.stringify({ ...event, eventId, capturedAt: event.capturedAt || Date.now() });
    const bytes = Buffer.byteLength(payload);
    const capacity = priority ? this.maxEvents : this.maxEvents - this.reservedEvents;
    const byteCapacity = priority ? this.maxBytes : this.maxBytes - this.reservedBytes;
    if (bytes > this.maxEventBytes || bytes > byteCapacity || this.queue.length >= capacity || this.bytes + bytes > byteCapacity) {
      this.dropped++;
      this.notify(this.onDrop, { reason: bytes > this.maxEventBytes ? 'event_too_large' : 'queue_full', dropped: this.dropped, pending: this.queue.length });
      return null;
    }
    this.queue.push({ payload, bytes }); this.bytes += bytes;
    this.kick();
    return eventId;
  }

  notify(callback, value) { try { callback(value); } catch {} }

  kick() {
    if (this.closed || this.busy || this.retryTimer || !this.queue.length) return;
    this.busy = true;
    const head = this.queue[0], controller = new AbortController();
    this.controller = controller;
    Promise.resolve().then(() => this.send(JSON.parse(head.payload), { signal: controller.signal })).then(() => {
      if (this.closed) return;
      this.queue.shift(); this.bytes -= head.bytes;
      if (this.retryCount) this.notify(this.onRecovered, { retries: this.retryCount, pending: this.queue.length });
      this.retryCount = 0;
      if (!this.queue.length) this.settleWaiters(true);
    }, error => {
      if (this.closed) return;
      this.retryCount++;
      const retryMs = Math.min(this.retryMaxMs, this.retryBaseMs * 2 ** Math.min(this.retryCount - 1, 20));
      this.notify(this.onError, { error, attempt: this.retryCount, retryMs, pending: this.queue.length });
      this.retryTimer = setTimeout(() => { this.retryTimer = null; this.kick(); }, retryMs);
      this.retryTimer.unref?.();
    }).finally(() => {
      this.busy = false; this.controller = null;
      this.kick();
    });
  }

  settleWaiters(ok) {
    for (const waiter of this.waiters) { clearTimeout(waiter.timer); waiter.resolve(ok); }
    this.waiters.clear();
  }

  flush({ timeoutMs = 6000 } = {}) {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) return Promise.reject(new RangeError('timeoutMs must be non-negative'));
    if (!this.queue.length) return Promise.resolve(true);
    if (this.closed || timeoutMs === 0) return Promise.resolve(false);
    return new Promise(resolve => {
      const waiter = { resolve, timer: null };
      waiter.timer = setTimeout(() => { this.waiters.delete(waiter); resolve(false); }, timeoutMs);
      this.waiters.add(waiter); this.kick();
    });
  }

  async close({ timeoutMs = 6000 } = {}) {
    this.accepting = false;
    const flushed = await this.flush({ timeoutMs });
    this.closed = true;
    clearTimeout(this.retryTimer); this.retryTimer = null;
    this.controller?.abort();
    const pending = this.queue.length;
    if (pending) {
      this.dropped += pending;
      this.notify(this.onDrop, { reason: 'close_timeout', dropped: this.dropped, pending });
    }
    this.queue.length = 0; this.bytes = 0;
    this.settleWaiters(flushed);
    return { flushed, dropped: this.dropped, pending };
  }

  get stats() { return { pending: this.queue.length, bytes: this.bytes, dropped: this.dropped, retryCount: this.retryCount, closed: this.closed }; }
}
