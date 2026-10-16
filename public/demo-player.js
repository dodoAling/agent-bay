import { buildDemoPlan } from './demo-scenarios.js';
export { SCENARIOS } from './demo-scenarios.js';

export class DemoPlayer {
  constructor(onFrame, { now = () => performance.now(), schedule = fn => requestAnimationFrame(fn), cancel = id => cancelAnimationFrame(id) } = {}) {
    this.onFrame = onFrame; this.now = now; this.schedule = schedule; this.cancel = cancel;
    this.active = false; this.playing = false; this.speed = 1; this.loop = false; this.position = 0; this.handle = null;
  }
  start(options = {}) {
    this.stop();
    this.options = options;
    this.plan = buildDemoPlan({ ...options, id: `preview-${Date.now()}`, startedAt: Date.now() });
    if (![.5, 1, 2].includes(Number(options.speed || 1))) throw new Error('Invalid playback speed');
    this.active = true; this.playing = true; this.loop = !!options.loop; this.speed = Number(options.speed || 1); this.position = 0; this.anchor = this.now();
    this.publish(); this.tick();
  }
  elapsed() { return Math.min(this.plan?.totalMs || 0, this.position + (this.playing ? (this.now() - this.anchor) * this.speed : 0)); }
  publish() {
    if (!this.active) return;
    const elapsed = this.elapsed(), { plan } = this;
    const events = plan.entries.filter(e => e.t <= elapsed).map(e => e.event);
    const end = elapsed >= plan.totalMs, ending = events.findLast(e => e.type === 'run.end');
    const run = { ...plan.run, stage: events.findLast(e => e.type === 'stage')?.stage || 'observe', status: ending ? 'completed' : 'running', endedAt: ending?.at || null };
    this.onFrame({ run, events, elapsed, duration: plan.totalMs, playing: this.playing && !end, loop: this.loop, speed: this.speed, scene: plan.scene });
  }
  tick() {
    if (!this.active || !this.playing) return;
    const elapsed = this.elapsed();
    if (elapsed >= this.plan.totalMs) {
      this.position = this.plan.totalMs; this.playing = false; this.publish();
      if (this.loop) this.handle = this.schedule(() => this.restart());
      return;
    }
    this.publish(); this.handle = this.schedule(() => this.tick());
  }
  pause() { if (!this.active || !this.playing) return; this.position = this.elapsed(); this.playing = false; this.cancel(this.handle); this.publish(); }
  resume() { if (!this.active || this.playing) return; if (this.position >= this.plan.totalMs) this.position = 0; this.anchor = this.now(); this.playing = true; this.tick(); }
  seek(ms) { if (!this.active) return; this.position = Math.max(0, Math.min(this.plan.totalMs, Number(ms) || 0)); this.anchor = this.now(); this.publish(); }
  setSpeed(value) { if (![.5, 1, 2].includes(Number(value))) throw new Error('Invalid playback speed'); this.position = this.elapsed(); this.anchor = this.now(); this.speed = Number(value); this.publish(); }
  restart() { if (!this.active) return; this.cancel(this.handle); this.position = 0; this.anchor = this.now(); this.playing = true; this.publish(); this.tick(); }
  stop() { if (this.handle != null) this.cancel(this.handle); this.active = false; this.playing = false; }
}
