import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDemoPlan, SCENARIOS, referenceState, REFERENCE_STATES } from '../public/demo-scenarios.js';
import { DemoPlayer } from '../public/demo-player.js';

test('Demo events close correctly, counts agree, and simulated provenance is explicit', () => {
  for (const scene of Object.keys(SCENARIOS)) for (const duration of [15, 24.8, 30, 60]) {
    const plan = buildDemoPlan({ scene, duration, startedAt: 1000 });
    const events = plan.entries.map(e => e.event);
    assert.equal(plan.run.mode, 'demo');
    assert.equal(events[0].type, 'run.start');
    assert.equal(events.at(-1).type, 'run.end');
    assert.equal(plan.entries.every((e, i) => !i || e.t >= plan.entries[i - 1].t), true);
    const starts = events.filter(e => e.type === 'tool.start'), ends = events.filter(e => e.type === 'tool.end');
    assert.equal(starts.length, SCENARIOS[scene].count);
    assert.equal(ends.length, starts.length);
    assert.equal(ends.every(e => e.result.demo === true), true);
    assert.equal(ends.every(e => starts.some(s => s.callId === e.callId)), true);
    assert.equal(events.filter(e => e.type === 'check').length, 6);
    assert.match(events.filter(e => e.type === 'model.delta').map(e => e.text).join(''), /simulated data/i);
    assert.ok(plan.entries.at(-1).t <= duration * 1000 - 800);
  }
});

test('The factory preset preserves stepped counts, verification rollbacks and the final playback state', () => {
  assert.equal(REFERENCE_STATES.length, 744);
  for (const [ms, read, matched, day] of [[0, 24, 9, 1], [6000, 181, 163, 3], [12000, 415, 386, 6], [18000, 626, 592, 9], [24800, 697, 696, 12]]) {
    const state = referenceState(ms);
    assert.deepEqual([state.read, state.matched, state.open, state.day], [read, matched, 697 - matched, day]);
  }
  assert.equal(referenceState(17933.33334).matched, 592);
  assert.equal(referenceState(17966.66667).matched, 591);
  assert.equal(referenceState(19100).matched, 619);
  assert.equal(referenceState(18000).callout, 'test');
  assert.equal(referenceState(16700).callout, 'bug');
  assert.equal(referenceState(22266.66667).runtime, true);
  assert.equal(referenceState(24800).rejected, 3);
  assert.equal(referenceState(24800).flagged, 0);
  assert.equal(referenceState(0).sourceLines, 287);
  assert.equal(referenceState(6000).sourceLines, 533);
  assert.equal(referenceState(18000).sourceLines, 1025);
  assert.equal(referenceState(24800).sourceLines, 1066);
  assert.equal(referenceState(0).stackTop, 558);
  assert.equal(referenceState(18000).stackTop, 471);
  assert.equal(referenceState(18000 / 24800 * 60000, 60000).matched, 592);
});

test('Pause, speed, seek and replay use virtual time; backward seeks restore counts', () => {
  let now = 0, latest, next = 0;
  const callbacks = new Map();
  const player = new DemoPlayer(frame => latest = frame, { now: () => now, schedule: fn => { callbacks.set(++next, fn); return next; }, cancel: id => callbacks.delete(id) });
  player.start({ scene: 'reverse', duration: 30 });
  const initialCalls = latest.events.filter(e => e.type === 'tool.end').length;
  now = 9000; player.pause();
  assert.equal(latest.elapsed, 9000);
  assert.equal(latest.playing, false);
  const count = latest.events.length;
  now = 15000; player.publish();
  assert.equal(latest.elapsed, 9000);
  player.seek(2000);
  assert.ok(latest.events.length < count);
  player.setSpeed(2); player.resume();
  now += 3000; player.pause();
  assert.equal(latest.elapsed, 8000);
  player.seek(30000);
  assert.equal(latest.run.status, 'completed');
  assert.equal(latest.events.filter(e => e.type === 'tool.end').length, 96);
  player.restart();
  assert.equal(latest.elapsed, 0);
  assert.equal(latest.events.filter(e => e.type === 'tool.end').length, initialCalls);
  player.stop();
  assert.equal(callbacks.size, 0);
});
