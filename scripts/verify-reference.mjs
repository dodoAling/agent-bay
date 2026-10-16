import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseUrl = process.env.AGENT_BAY_URL || 'http://127.0.0.1:4318';
const artifactDir = path.join(root, 'artifacts');
const reportPath = path.join(artifactDir, 'factory-v3-verification.json');
const reference = JSON.parse(await fs.readFile(path.join(artifactDir, 'reference-frame-analysis.json'), 'utf8'));
const sha = value => createHash('sha256').update(value).digest('hex');
const report = { startedAt: new Date().toISOString(), source: reference.source, checks: [], frames: [], screenshots: [], errors: [], postRequests: [], mediaRequests: [] };
await fs.mkdir(artifactDir, { recursive: true });
const chrome = [process.env.AGENT_BAY_CHROME_PATH, process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(path => path && existsSync(path));
if (!chrome) throw new Error('Set AGENT_BAY_CHROME_PATH to the Chrome/Chromium executable.');
const browser = await chromium.launch({ executablePath: chrome, headless: true });
const watch = page => {
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('request', request => {
    if (request.method() === 'POST') report.postRequests.push(request.url());
    if (/\.(mp4|webm|mov|m3u8)(?:\?|$)/i.test(request.url()) || ['media'].includes(request.resourceType())) report.mediaRequests.push(request.url());
  });
};
const snapshot = () => {
  const value = selector => document.querySelector(selector)?.textContent.trim();
  const s = window.agentBayPreview?.state();
  return { elapsed: s?.elapsed, scene: s?.scene, playing: s?.playing, factory: s?.factory,
    read: Number(value('#metric-calls')), matched: Number(value('#metric-success')), open: Number(value('#metric-pending')), copied: Number(value('#metric-errors')),
    day: Number(value('#factory-step')?.match(/\d+/)?.[0]), rejected: Number(value('#metric-checks')?.match(/\d+/)?.[0]), runtime: value('#signal-runtime'), referenceClass: document.body.classList.contains('reference-scene') };
};
const assertFrame = (actual, expected, context) => {
  for (const key of ['read', 'matched', 'open', 'day', 'rejected']) assert.equal(actual[key], expected[key], `${context}: ${key}`);
  assert.equal(actual.copied, 0, `${context}: code copied`);
  assert.equal(actual.runtime, expected.runtime ? 'playable' : 'waiting', `${context}: runtime`);
  assert.equal(actual.factory.cells, expected.matched, `${context}: matrix filled cells`);
  assert.equal(actual.factory.failed, expected.rejected, `${context}: factory rejected count`);
  assert.equal(actual.factory.phase, expected.day, `${context}: factory day`);
  assert.equal(actual.scene, 'cleanroom', `${context}: correct scene`);
  assert.equal(actual.playing, false, `${context}: paused virtual clock`);
};
try {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1080 }, deviceScaleFactor: 1 });
  watch(page);
  await page.goto(`${baseUrl}/?preview=1&scene=cleanroom&duration=24.8&format=square&autoplay=0&controls=0`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.agentBayPreview?.state()?.scene === 'cleanroom' && !window.agentBayPreview.state().playing);
  await page.evaluate(() => document.fonts.ready);

  // Compare browser DOM and factory state with independently measured frame records.
  for (let start = 0; start < 744; start += 124) {
    const end = Math.min(744, start + 124);
    const actual = await page.evaluate(({ start, end, snapshotSource }) => {
      const capture = (0, eval)(`(${snapshotSource})`), rows = [];
      for (let index = start; index < end; index++) { window.agentBayPreview.renderAt(index * 1000 / 30); rows.push({ frame: index + 1, ...capture() }); }
      return rows;
    }, { start, end, snapshotSource: snapshot.toString() });
    for (const row of actual) assertFrame(row, reference.frames[row.frame - 1], `frame ${row.frame}`);
    report.frames.push(...actual);
    console.log(`DOM frame comparison: ${end}/744`);
  }
  report.checks.push('All 744 canonical frame timestamps match independently measured read/matched/open/day/rejected/runtime values in DOM and Canvas state.');

  // Hard-coded nodes make accidental edits to the measured-data fixture visible.
  const known = [[0, 24, 9], [180, 181, 163], [360, 415, 386], [540, 626, 592], [743, 697, 696]];
  for (const [index, read, matched] of known) { assert.equal(report.frames[index].read, read, `known frame ${index + 1} read`); assert.equal(report.frames[index].matched, matched, `known frame ${index + 1} matched`); }
  for (const [previous, index, before, after] of [[538, 539, 592, 591], [572, 573, 620, 619]]) {
    assert.equal(report.frames[previous].matched, before); assert.equal(report.frames[index].matched, after);
  }
  report.checks.push('Known 0/6/12/18/final-second values and observed 592→591 / 620→619 dips match.');

  // Counters can be numerically correct while later drawings cover their ink.
  // The rejected label belongs above the conveyor, in its own visible strip.
  report.rejectedCountInk = [];
  for (const ms of [0, 8000, 12000, 24700]) {
    await page.evaluate(ms => window.agentBayPreview.renderAt(ms), ms);
    const redPixels = await page.evaluate(() => {
      const pixels = document.querySelector('#factory-canvas').getContext('2d').getImageData(612, 118, 66, 16).data;
      let visible = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 150 && pixels[i] - pixels[i + 1] > 80 && pixels[i] - pixels[i + 2] > 60) visible++;
      return visible;
    });
    assert.ok(redPixels > 20, `rejected counter remains visibly red above the conveyor at ${ms}ms`);
    report.rejectedCountInk.push({ ms, redPixels });
  }
  report.checks.push('Rejected 0/3 through 3/3 counters have visible pixel ink above the conveyor at start, failure, mid-run and ending.');

  // Exercise frame boundaries with 0.001 ms on either side, including backward seeks.
  const boundaryIndices = [1, 61, 122, 243, 247, 363, 496, 511, 539, 552, 573, 593, 625, 668, 743];
  report.boundaries = [];
  for (const index of boundaryIndices) {
    const ms = index * 1000 / 30;
    for (const [delta, expectedIndex] of [[0.001, index], [-0.001, index - 1], [0, index]]) {
      await page.evaluate(ms => window.agentBayPreview.renderAt(ms), ms + delta);
      const actual = await page.evaluate(snapshot);
      assertFrame(actual, reference.frames[expectedIndex], `boundary frame ${index + 1}, delta ${delta}`);
      report.boundaries.push({ frame: index + 1, deltaMs: delta, actual });
    }
  }
  report.checks.push('Canonical and ±0.001 ms frame boundaries remain correct after forward/backward seek.');

  const canvasData = () => document.querySelector('#factory-canvas').toDataURL('image/png');
  await page.evaluate(() => window.agentBayPreview.renderAt(12000));
  const first = await page.evaluate(canvasData);
  await page.evaluate(() => window.agentBayPreview.renderAt(20000));
  assert.notEqual(await page.evaluate(canvasData), first, 'different time changes Canvas pixels');
  await page.evaluate(() => window.agentBayPreview.renderAt(12000));
  assert.equal(await page.evaluate(canvasData), first, 'backward seek restores identical Canvas bytes');
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(canvasData), first, 'pending render does not replace seek result');
  const paused1 = await page.screenshot();
  await page.waitForTimeout(350);
  const paused2 = await page.screenshot();
  assert.equal(sha(paused1), sha(paused2), 'paused full page remains visually identical');
  report.determinism = { canvasAt12s: sha(first), pausedPageHash: sha(paused1), backwardSeekRestoresPixels: true, queuedRenderStable: true, differentTimeChangesPixels: true };
  report.checks.push('Pause freezes the whole page; repeated and backward-seek Canvas bytes are deterministic, including after pending renders.');

  for (const seconds of [0, 6, 8, 12, 16.7, 17.5, 18.4, 24.7]) {
    await page.evaluate(ms => window.agentBayPreview.renderAt(ms), seconds * 1000);
    const filename = `factory-v3-${String(seconds).replace('.', '-')}s.png`;
    await page.screenshot({ path: path.join(artifactDir, filename), fullPage: true });
    report.screenshots.push(filename);
  }
  report.layout = await page.evaluate(() => Object.fromEntries(['.window', '.titlebar', '.masthead', '.rail', '.flow-panel', '.flow-scene', '#factory-canvas', '.factory-progress', '.room-actions', '.detail-grid'].map(selector => { const el = document.querySelector(selector), r = el.getBoundingClientRect(); return [selector, { x: r.x, y: r.y, width: r.width, height: r.height }]; })));
  assert.equal(report.layout['.window'].x, 36); assert.equal(report.layout['.window'].y, 36); assert.equal(report.layout['.window'].width, 1008); assert.equal(report.layout['.window'].height, 1008);
  assert.equal(report.layout['.rail'].width, 300); assert.equal(report.layout['.flow-panel'].height, 442);
  assert.equal(report.layout['#factory-canvas'].y, 266);
  assert.equal(report.layout['.factory-progress'].y, 661);
  assert.equal(report.layout['.room-actions'].y, 801);
  assert.equal(report.layout['#factory-canvas'].width, 684); assert.equal(report.layout['#factory-canvas'].height, 395);
  assert.equal(await page.evaluate(() => document.querySelectorAll('video').length), 0, 'native scene has no video element');
  report.checks.push('1080-square native geometry: 1008-square window at (36,36), sidebar 300, factory canvas 684×395; no embedded video element.');

  // Ending state must survive exact-duration rendering and a return to the start.
  await page.evaluate(() => window.agentBayPreview.renderAt(24800));
  assertFrame(await page.evaluate(snapshot), reference.frames[743], 'exact duration');
  await page.evaluate(() => window.agentBayPreview.renderAt(0));
  assertFrame(await page.evaluate(snapshot), reference.frames[0], 'seek from end to start');
  report.checks.push('Exact-duration ending stays at 697 read / 696 matched / 1 open; seeking to zero fully restores first frame.');

  const livePage = await browser.newPage({ viewport: { width: 1080, height: 1080 } }); watch(livePage);
  await livePage.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await livePage.waitForFunction(() => window.agentBayPreview && document.querySelector('#stream-label')?.textContent === 'LIVE BRIDGE');
  const serverState = await (await livePage.request.get(`${baseUrl}/api/state`)).json();
  const latestRunId = serverState.runs.at(-1)?.id;
  const latestCalls = serverState.events.filter(event => event.runId === latestRunId && event.type === 'tool.start').length;
  await livePage.waitForFunction(expected => Number(document.querySelector('#metric-calls').textContent) === expected, latestCalls);
  const liveMetrics = await livePage.evaluate(() => ['#metric-calls', '#metric-success', '#metric-pending', '#metric-errors'].map(selector => document.querySelector(selector).textContent));
  await page.evaluate(() => window.agentBayPreview.exit());
  await page.waitForFunction(() => !document.body.classList.contains('reference-scene') && !document.querySelector('#settings-btn').disabled);
  assert.equal(await page.evaluate(() => window.agentBayPreview.state()), null);
  const restored = await page.evaluate(() => ['#metric-calls', '#metric-success', '#metric-pending', '#metric-errors'].map(selector => document.querySelector(selector).textContent));
  assert.deepEqual(restored, liveMetrics, 'exit restores current live metrics');
  report.liveRestore = { expected: liveMetrics, actual: restored };
  await livePage.close();
  for (const [scene, total] of [['reverse', 96], ['coding', 64]]) {
    await page.evaluate(scene => { window.agentBayPreview.start({ scene, duration: 30, format: 'square', controls: false, autoplay: false }); window.agentBayPreview.renderAt(30000); }, scene);
    await page.waitForFunction(total => Number(document.querySelector('#metric-calls').textContent) === total && !document.body.classList.contains('reference-scene'), total);
    assert.equal(await page.evaluate(() => window.agentBayPreview.state().scene), scene);
    assert.equal(await page.evaluate(() => Number(document.querySelector('#metric-calls').textContent)), total);
  }
  await page.evaluate(() => window.agentBayPreview.exit());
  await page.waitForFunction(() => !document.body.classList.contains('preview-active'));
  report.checks.push('Exiting restores current live metrics; original reverse and coding scenes still complete at 96 and 64 calls.');
  assert.deepEqual(report.errors, [], 'no browser errors');
  assert.deepEqual(report.postRequests, [], 'simulation never mutates backend or calls models/tools');
  assert.deepEqual(report.mediaRequests, [], 'simulation never loads reference video');
  report.checks.push('No browser page errors, POST requests, or video/media downloads during preview, seek, exit, and old-scene checks.');
  report.passed = true;
} catch (error) {
  report.passed = false; report.failure = error.stack || String(error); process.exitCode = 1;
  console.error(report.failure);
} finally {
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  await browser.close();
  console.log(JSON.stringify({ passed: report.passed, frames: report.frames.length, checks: report.checks, report: reportPath }));
}
