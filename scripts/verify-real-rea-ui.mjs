import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const base = process.env.AGENT_BAY_URL || 'http://127.0.0.1:4319';
const fixture = resolve('artifacts/managed-acceptance-fixture/bin/Release/net10.0/AgentBay.ManagedAcceptance.dll');
const api = async (path, data) => {
  let res;
  for (let attempt = 0; ; attempt++) {
    try { res = await fetch(base + '/api' + path, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); break; }
    catch (error) { if (data !== undefined || attempt >= 2) throw error; await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
};
const before = await api('/state');
assert.equal(before.activeRun, null, 'leave an active user task untouched');
let connection = before.connections.find(s => s.status === 'connected' && s.name === 'REA');
if (!connection) {
  const setup = await api('/setup');
  assert.ok(setup.rea.command, 'REA is installed');
  connection = await api('/mcp/connect', { name: 'REA', ...setup.rea });
}
const runId = process.argv[2] || (await api('/mcp/call', { serverId: connection.id, name: 'inspect_managed_members', args: { path: fixture, detail: 'complete', type_names: ['AgentBay.Acceptance.ManagedFixture'] } })).runId;
let state, run;
for (let i = 0; i < 150; i++) {
  state = await api('/state'); run = state.runs.find(r => r.id === runId);
  if (run?.status !== 'running') break;
  await new Promise(resolve => setTimeout(resolve, 200));
}
assert.equal(run.status, 'completed');
assert.deepEqual([run.summary.calls, run.summary.success, run.summary.pending, run.summary.errors], [1, 1, 0, 0]);
const result = state.events.find(e => e.runId === runId && e.type === 'tool.end');
assert.equal(result.ok, true);
const actual = JSON.stringify(result.result);
for (const fact of ['ComputeScore', 'Classify', 'REA_ACCEPT_HIGH', 'REA_ACCEPT_LOW']) assert.ok(actual.includes(fact), `actual REA result contains ${fact}`);
const chrome = [process.env.AGENT_BAY_CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(path => path && existsSync(path));
if (!chrome) throw new Error('Set AGENT_BAY_CHROME_PATH to the Chrome/Chromium executable.');
const browser = await chromium.launch({ executablePath: chrome, headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, acceptDownloads: true });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(id => [...document.querySelector('#run-select').options].some(o => o.value === id), runId);
  await page.selectOption('#run-select', runId);
  await page.waitForFunction(() => document.querySelector('#metric-calls').textContent === '01' && document.querySelector('#metric-success').textContent === '01');
  await page.waitForFunction(() => document.querySelector('#tool-feed [data-call] b')?.textContent === 'inspect_managed_members');
  await page.locator('#tool-feed [data-call]').first().click();
  await page.waitForFunction(() => document.querySelector('#detail-heading').textContent.includes('TOOL DETAILS'));
  await page.waitForFunction(() => document.querySelector('#response-content').textContent.includes('REA_ACCEPT_HIGH'));
  assert.deepEqual(await page.locator('#metric-calls,#metric-success,#metric-pending,#metric-errors').allTextContents(), ['01', '01', '00', '00']);
  assert.equal(await page.evaluate(() => window.agentBayPreview.factoryState().completed), 1);
  await page.screenshot({ path: 'artifacts/reliability-real-rea-ui.png', fullPage: true });
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export-btn').click()]);
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.equal(exported.run.id, runId); assert.equal(exported.run.summary.success, 1);
  assert.ok(JSON.stringify(exported.events).includes('REA_ACCEPT_HIGH'));
  assert.equal(exported.retention.eventLimit, 5000);
  await page.evaluate(() => { window.agentBayPreview.start({ scene: 'cleanroom', duration: 24.8, autoplay: false }); window.agentBayPreview.renderAt(6000); });
  assert.equal(await page.locator('#metric-calls').textContent(), '181');
  await page.evaluate(() => window.agentBayPreview.exit());
  await page.waitForFunction(() => document.querySelector('#metric-calls').textContent === '01' && !document.querySelector('#settings-btn').disabled);
  assert.deepEqual(errors, []);
  const report = { passed: true, url: base, target: fixture, data: 'actual REA managed inspection of a controlled compiled fixture', runId, tool: 'inspect_managed_members', summary: run.summary, toolCount: state.connections.find(s => s.id === connection.id).tools.length, browserErrors: errors, exportVerified: true, previewIsolationVerified: true, realModelValidated: false, targetExecuted: false };
  await writeFile('artifacts/reliability-real-rea-ui.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await browser.close(); }
