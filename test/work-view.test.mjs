import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { createApp } from '../src/server.mjs';

const chromePath = [process.env.AGENT_BAY_CHROME, process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(path => path && existsSync(path));

async function withWorkPage(run) {
  const app = createApp({ bridgeToken: 'work-view-fixture' });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: chromePath, headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${app.server.address().port}`);
    await waitState(page, 'idle');
    await run({ app, context, page });
    assert.deepEqual(errors, [], 'The work page must not throw browser errors');
  } finally {
    if (browser) await browser.close();
    await app.close();
  }
}

async function waitState(page, expected) {
  await page.waitForFunction(state => document.querySelector('#work-state')?.dataset.state === state && window.agentBayPreview?.factoryState()?.visualState === state, expected, { timeout: 10_000 });
  assert.equal(await page.locator('.window').getAttribute('data-work-state'), expected);
}

function start(app, id) {
  const run = app.store.start({ id, title: `Work view fixture ${id}`, source: 'test', mode: 'external' });
  return event => app.store.push({ runId: run.id, ...event });
}

async function pixelsAfterDelay(page) {
  return page.evaluate(async () => {
    const canvas = document.querySelector('#factory-canvas');
    const before = canvas.toDataURL();
    await new Promise(resolve => setTimeout(resolve, 180));
    return { before, after: canvas.toDataURL(), stats: window.agentBayPreview.factoryState() };
  });
}

async function assertStill(page, state) {
  const pixels = await pixelsAfterDelay(page);
  assert.equal(pixels.after, pixels.before, `${state} must not imply further tool execution`);
  assert.equal(pixels.stats.activeMotions, 0, `${state} must stop all pipeline motion`);
}

test('SSE drives waiting, execution and completion; reduced motion stops animations', { skip: !chromePath, timeout: 30_000 }, async () => {
  await withWorkPage(async ({ app, page }) => {
    await assertStill(page, 'idle');
    const push = start(app, 'work-lifecycle');
    push({ type: 'model.start', messageId: 'fixture-model' });
    await waitState(page, 'waiting');
    assert.equal((await page.evaluate(() => window.agentBayPreview.factoryState())).activeMotions, 1);
    assert.equal(await page.locator('#metric-calls').textContent(), '00', 'Model waiting must not invent a tool call');

    push({ type: 'tool.start', callId: 'fixture-tool', name: 'fixture_analyze', args: { target: 'test fixture' } });
    await waitState(page, 'working');
    const executing = await pixelsAfterDelay(page);
    assert.notEqual(executing.after, executing.before, 'A tool in flight should animate');
    assert.equal(executing.stats.activeMotions, 2);
    assert.equal(executing.stats.pending, 1);
    assert.equal(executing.stats.completed, 0, 'Animation must not increment successful results');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => window.agentBayPreview.factoryState().activeMotions === 0);
    await assertStill(page, 'reduced motion');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForFunction(() => window.agentBayPreview.factoryState().activeMotions === 2);

    push({ type: 'tool.end', callId: 'fixture-tool', name: 'fixture_analyze', ok: true, result: { fixture: true, value: 4 } });
    await waitState(page, 'waiting');
    const waiting = await page.evaluate(() => window.agentBayPreview.factoryState());
    assert.deepEqual([waiting.completed, waiting.failed, waiting.pending], [1, 0, 0]);
    assert.deepEqual(waiting.motionTypes, ['heartbeat'], 'Waiting must not keep a conveyor or scanner running');
    push({ type: 'model.end', messageId: 'fixture-model' });
    push({ type: 'run.end', status: 'completed' });
    await waitState(page, 'completed');
    await assertStill(page, 'completed');
    assert.equal(await page.locator('#metric-success').textContent(), '01');
  });
});

test('Failure and cancellation remain terminal; animations never complete pending calls', { skip: !chromePath, timeout: 30_000 }, async () => {
  await withWorkPage(async ({ app, page }) => {
    const failed = start(app, 'work-failure');
    failed({ type: 'tool.start', callId: 'failed-call', name: 'fixture_failure' });
    await waitState(page, 'working');
    failed({ type: 'tool.end', callId: 'failed-call', name: 'fixture_failure', ok: false, result: { error: 'Fixture error' } });
    failed({ type: 'run.end', status: 'failed', message: 'Fixture task failed' });
    await waitState(page, 'failed');
    await assertStill(page, 'failed');
    assert.equal((await page.evaluate(() => window.agentBayPreview.factoryState())).failed, 1);

    const cancelled = start(app, 'work-cancellation');
    cancelled({ type: 'tool.start', callId: 'unfinished-call', name: 'fixture_unfinished' });
    await waitState(page, 'working');
    cancelled({ type: 'run.end', status: 'cancelled' });
    await waitState(page, 'cancelled');
    await assertStill(page, 'cancelled');
    const stats = await page.evaluate(() => window.agentBayPreview.factoryState());
    assert.deepEqual([stats.completed, stats.pending], [0, 1], 'Stopping a session must preserve the missing tool result');
  });
});

test('SSE disconnection stops motion; a fresh snapshot restores actual tool results', { skip: !chromePath, timeout: 30_000 }, async () => {
  await withWorkPage(async ({ app, context, page }) => {
    const push = start(app, 'work-reconnect');
    push({ type: 'tool.start', callId: 'offline-call', name: 'fixture_reconnect' });
    await waitState(page, 'working');
    await context.setOffline(true);
    app.server.closeAllConnections();
    await waitState(page, 'disconnected');
    await assertStill(page, 'disconnected');
    assert.equal((await page.evaluate(() => window.agentBayPreview.factoryState())).pending, 1);

    // The actual result arrives while the browser cannot receive events.
    push({ type: 'tool.end', callId: 'offline-call', name: 'fixture_reconnect', ok: true, result: { fixture: 'received while offline' } });
    await context.setOffline(false);
    await waitState(page, 'waiting');
    const recovered = await page.evaluate(() => window.agentBayPreview.factoryState());
    assert.deepEqual([recovered.completed, recovered.pending, recovered.retainedCalls], [1, 0, 1]);
    assert.equal(await page.locator('#stream-label').textContent(), 'LIVE BRIDGE');
    push({ type: 'run.end', status: 'completed' });
    await waitState(page, 'completed');
    await assertStill(page, 'completed after reconnect');
  });
});
