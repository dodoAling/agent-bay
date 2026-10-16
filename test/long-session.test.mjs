import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { EventStore, EVENT_LIMIT } from '../src/events.mjs';
import { createApp } from '../src/server.mjs';

function emitter(store, id) { return event => store.push({ runId: id, ...event }); }
function overflow(push) { for (let i = 0; i <= EVENT_LIMIT; i++) push({ type: 'model.delta', messageId: 'long-output', text: 'x' }); }

test('Tool, check and token totals survive retention after 5001 incremental events', () => {
  const store = new EventStore(), run = store.start({ id: 'long' }), push = emitter(store, run.id);
  push({ type: 'tool.start', callId: 'call-1', name: 'analyze', args: {} });
  push({ type: 'tool.end', callId: 'call-1', name: 'analyze', ok: true });
  push({ type: 'check', name: 'evidence', status: 'passed' });
  push({ type: 'model.end', messageId: 'm1', usage: { total_tokens: 42 } });
  overflow(push);
  assert.equal(store.events.length, EVENT_LIMIT);
  assert.equal(store.events.some(e => e.type === 'tool.start' || e.type === 'tool.end'), false);
  assert.deepEqual(run.summary, { calls: 1, success: 1, errors: 0, pending: 0, checks: 1, checksPassed: 1, tokens: 42, usageReported: true, events: 5006 });
  assert.deepEqual(store.events.at(-1).runSummary, run.summary);
});

test('Late results, duplicate call IDs and completion retries count once; orphan results are counted', () => {
  const store = new EventStore(), run = store.start({ id: 'pending' }), push = emitter(store, run.id);
  push({ type: 'tool.start', callId: 'slow', name: 'decompile' });
  overflow(push);
  assert.equal(run.summary.calls, 1);
  assert.equal(run.summary.pending, 1);
  push({ type: 'tool.start', callId: 'slow', name: 'decompile' });
  assert.equal(store.events.at(-1).duplicate, true);
  push({ type: 'tool.end', callId: 'slow', name: 'decompile', ok: true });
  push({ type: 'tool.end', callId: 'slow', name: 'decompile', ok: false });
  assert.equal(store.events.at(-1).duplicate, true);
  push({ type: 'tool.end', callId: 'orphan', name: 'scan', ok: false });
  push({ type: 'tool.start', callId: 'orphan', name: 'scan' });
  assert.equal(store.events.at(-1).duplicate, true);
  assert.deepEqual([run.summary.calls, run.summary.success, run.summary.errors, run.summary.pending], [2, 1, 1, 0]);
});

test('Snapshots, run.start and individual events retain independent totals; external fields cannot forge them', () => {
  const store = new EventStore(), run = store.start({ id: 'snapshot', summary: { calls: 999 } }), push = emitter(store, run.id);
  const start = store.events[0], before = store.snapshot();
  push({ type: 'tool.start', callId: 'one', name: 'analyze', runSummary: { calls: 999 }, summary: { calls: 999 }, run: { id: 'forged' }, duplicate: true });
  assert.equal(store.events.at(-1).duplicate, undefined);
  assert.equal(store.events.at(-1).summary, undefined);
  assert.equal(store.events.at(-1).run, undefined);
  assert.equal(store.events.at(-1).runSummary.calls, 1);
  assert.equal(start.run.summary.calls, 0);
  assert.equal(start.runSummary.events, 1);
  assert.equal(before.runs[0].summary.calls, 0);
  assert.equal(before.events.length, 1);
  const restored = JSON.parse(JSON.stringify(store.snapshot()));
  assert.deepEqual(restored.runs[0].summary, run.summary);
  assert.equal(restored.retention.eventLimit, EVENT_LIMIT);
  restored.runs[0].summary.calls = 88;
  restored.events.at(-1).runSummary.calls = 99;
  assert.equal(run.summary.calls, 1);
  assert.equal(store.events.at(-1).runSummary.calls, 1);
});

test('Sessions share detail retention but isolate totals; token counts deduplicate message IDs and reject invalid values', () => {
  const store = new EventStore();
  const a = store.start({ id: 'a' }), b = store.start({ id: 'b' });
  const pa = emitter(store, a.id), pb = emitter(store, b.id);
  pa({ type: 'tool.start', callId: 'same-id', name: 'a' });
  pa({ type: 'tool.end', callId: 'same-id', ok: false });
  pb({ type: 'tool.start', callId: 'same-id', name: 'b' });
  pb({ type: 'tool.end', callId: 'same-id', ok: true });
  pa({ type: 'model.end', messageId: 'm1', usage: { input_tokens: 7, output_tokens: 3 } });
  pa({ type: 'model.end', messageId: 'm1', usage: { total_tokens: 1000 } });
  pa({ type: 'model.end', messageId: 'm2', usage: { total_tokens: -5, prompt_tokens: '4', completion_tokens: 2 } });
  pa({ type: 'model.end', messageId: 'm3', usage: { total_tokens: 'invalid' } });
  pb({ type: 'model.end', messageId: 'm1', usage: { total_tokens: 0 } });
  overflow(pb);
  assert.equal(store.events.some(e => e.runId === a.id), false);
  const runs = JSON.parse(JSON.stringify(store.snapshot())).runs;
  assert.deepEqual([runs[0].summary.calls, runs[0].summary.errors, runs[0].summary.success, runs[0].summary.tokens], [1, 1, 0, 16]);
  assert.deepEqual([runs[1].summary.calls, runs[1].summary.errors, runs[1].summary.success, runs[1].summary.tokens, runs[1].summary.usageReported], [1, 0, 1, 0, true]);
});

const chromePath = [process.env.AGENT_BAY_CHROME, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(path => path && existsSync(path));

test('Browser updates, refresh, reconnect and session switching use totals; demo seeking remains isolated', { skip: !chromePath, timeout: 45_000 }, async () => {
  const app = createApp({ bridgeToken: 'long-session-test' });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  let browser;
  const errors = [];
  try {
    const first = app.store.start({ id: 'ui-first', title: 'First' }), push = emitter(app.store, first.id);
    push({ type: 'tool.start', callId: 'first-call', name: 'analyze', args: { target: 'fixture' } });
    push({ type: 'tool.end', callId: 'first-call', name: 'analyze', ok: true, result: { fixture: true } });
    push({ type: 'check', name: 'test', status: 'passed' });
    push({ type: 'model.end', messageId: 'm1', usage: { total_tokens: 42 } });
    browser = await chromium.launch({ executablePath: chromePath, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector('#metric-calls').textContent === '01');
    overflow(push);
    await page.waitForFunction(() => document.querySelector('#event-count').textContent === '5006 EVENTS · 5000 retained');
    const metrics = () => page.locator('#metric-calls,#metric-success,#metric-pending,#metric-errors,#metric-checks,#metric-tokens').allTextContents();
    assert.deepEqual(await metrics(), ['01', '01', '00', '00', '1/1', '42']);
    assert.match(await page.locator('#tool-feed').textContent(), /1 tool calls? recorded/);
    assert.deepEqual(await page.evaluate(() => { const s = window.agentBayPreview.factoryState(); return [s.completed, s.failed, s.retainedCalls]; }), [1, 0, 0]);
    assert.match(await page.locator('#response-content').textContent(), /Output may be incomplete/);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#event-count').textContent.startsWith('5006 EVENTS'));
    assert.deepEqual(await metrics(), ['01', '01', '00', '00', '1/1', '42']);
    const second = app.store.start({ id: 'ui-second', title: 'Second' }), pushSecond = emitter(app.store, second.id);
    pushSecond({ type: 'tool.start', callId: 'second-call', name: 'scan' });
    await page.waitForFunction(() => document.querySelector('#run-select').value === 'ui-second' && document.querySelector('#metric-pending').textContent === '01');
    assert.deepEqual(await metrics(), ['01', '00', '01', '00', '—', '—']);
    await page.selectOption('#run-select', first.id);
    await page.waitForFunction(() => document.querySelector('#metric-tokens').textContent === '42');
    assert.deepEqual(await metrics(), ['01', '01', '00', '00', '1/1', '42']);
    // End the SSE connection while the page is retained, then verify its new
    // snapshot updates the selected run and preserves all accumulated counters.
    app.server.closeAllConnections();
    pushSecond({ type: 'tool.end', callId: 'second-call', name: 'scan', ok: false });
    await page.waitForFunction(() => document.querySelector('#stream-label').textContent === 'RECONNECTING');
    await page.waitForFunction(() => document.querySelector('#stream-label').textContent === 'LIVE BRIDGE', { timeout: 10_000 });
    assert.deepEqual(await metrics(), ['01', '01', '00', '00', '1/1', '42']);
    await page.selectOption('#run-select', second.id);
    await page.waitForFunction(() => document.querySelector('#metric-errors').textContent === '01');
    assert.deepEqual(await metrics(), ['01', '00', '00', '01', '—', '—']);
    await page.evaluate(() => { window.agentBayPreview.start({ scene: 'reverse', duration: 30, autoplay: false }); window.agentBayPreview.renderAt(30000); });
    assert.equal(await page.locator('#metric-calls').textContent(), '96');
    await page.evaluate(() => window.agentBayPreview.renderAt(0));
    assert.equal(await page.locator('#metric-calls').textContent(), '08');
    await page.evaluate(() => { window.agentBayPreview.start({ scene: 'cleanroom', duration: 24.8, autoplay: false }); window.agentBayPreview.renderAt(6000); });
    assert.equal(await page.locator('#metric-calls').textContent(), '181');
    assert.equal(await page.locator('#metric-success').textContent(), '163');
    await page.evaluate(() => window.agentBayPreview.exit());
    await page.waitForFunction(() => document.querySelector('#metric-errors').textContent === '01');
    assert.deepEqual(await metrics(), ['01', '00', '00', '01', '—', '—']);
    assert.deepEqual(errors, []);
  } finally { if (browser) await browser.close(); await app.close(); }
});
