import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { command, PROJECT_ROOT, sha256 } from './desktop-assets.mjs';

const value = name => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const exe = resolve(value('--exe') || join(PROJECT_ROOT, 'src-tauri/target/debug/agent-bay-desktop.exe'));
assert.ok(existsSync(exe), `Build the desktop executable first: ${exe}`);
const artifacts = join(PROJECT_ROOT, 'artifacts');
await mkdir(artifacts, { recursive: true });
let packageIntegrity = null;
if (process.argv.includes('--package')) {
  const packageRoot = dirname(exe), server = join(packageRoot, 'resources/server');
  const manifest = JSON.parse(await readFile(join(server, 'asset-manifest.json'), 'utf8'));
  const runtime = join(packageRoot, 'agent-bay-node.exe');
  assert.equal(await sha256(runtime), manifest.runtime.sha256);
  assert.equal(await command(runtime, ['--version']), `v${manifest.runtime.version}`);
  for (const asset of manifest.assets) assert.equal(await sha256(join(server, asset.path)), asset.sha256, `Installer asset integrity: ${asset.path}`);
  packageIntegrity = { checkedAssets: manifest.assets.length, runtimeVersion: manifest.runtime.version, runtimeSha256: manifest.runtime.sha256, target: manifest.target };
}
const socket = createServer();
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const child = spawn(exe, [], {
  cwd: PROJECT_ROOT,
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1` },
  stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false,
});
let stdout = '', stderr = '', browser, page, status;
child.stdout.on('data', chunk => { stdout += chunk; });
child.stderr.on('data', chunk => { stderr += chunk; });
const closed = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', (code, signal) => resolve({ code, signal })); });
closed.catch(() => {});
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function until(check, label, milliseconds = 30_000) {
  const start = Date.now();
  while (Date.now() - start < milliseconds) {
    const result = await check();
    if (result) return result;
    await delay(100);
  }
  throw new Error(`Timed out: ${label}`);
}
const errors = [];
const nativeDialogs = [];
let rea = null;
async function workspaceRequest(path, payload) {
  const response = await fetch(`${status.backendUrl}api/${path}`, payload === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await response.json();
  assert.ok(response.ok, `${path}: ${data.error || response.status}`);
  return data;
}
async function dialog(action, kind, path) {
  const args = ['-NoProfile', '-WindowStyle', 'Hidden', '-File', join(PROJECT_ROOT, 'scripts/desktop-dialog.ps1'), '-DesktopPid', String(status.desktopPid), '-DialogTitle', kind === 'save' ? 'Export session' : 'Select an analysis target', '-Action', action, '-Kind', kind];
  if (path) args.push('-Path', path);
  const result = JSON.parse(await command('powershell.exe', args));
  assert.equal(result.passed, true);
  nativeDialogs.push(result);
}
try {
  await until(async () => {
    if (child.exitCode !== null) throw new Error(`Desktop exited before CDP: ${stderr}`);
    try { return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok; } catch { return false; }
  }, 'WebView2 debugging endpoint');
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page = await until(async () => browser.contexts().flatMap(context => context.pages()).find(candidate => /^http:\/\/127\.0\.0\.1:\d+\/$/.test(candidate.url())), 'local workspace navigation');
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('#browse-file:visible');
  status = await page.evaluate(() => window.__TAURI__.core.invoke('desktop_status'));
  assert.equal(status.phase, 'ready');
  assert.equal(status.desktopPid, child.pid);
  assert.equal(new URL(status.backendUrl).origin, new URL(page.url()).origin);
  assert.ok(status.backendPid > 1);
  assert.ok(![4318, 4319].includes(Number(new URL(status.backendUrl).port)), 'desktop has its own ephemeral port');
  const response = await fetch(`${status.backendUrl}api/state`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).runs.length, 0);
  const ipcError = await page.evaluate(async () => {
    try { await window.__TAURI__.core.invoke('save_export', { data: 'invalid-json', defaultName: 'fixture.json' }); return null; }
    catch (error) { return String(error); }
  });
  assert.match(ipcError, /valid JSON/);
  const initialPreferences = await page.evaluate(() => window.__TAURI__.core.invoke('desktop_preferences'));
  if (value('--expect-style')) assert.equal(initialPreferences.windowStyle, value('--expect-style'), 'native window style survives a desktop restart');
  assert.equal(await page.evaluate(() => document.body.classList.contains('desktop')), true);
  assert.equal(await page.evaluate(() => window.__TAURI__.window.getCurrentWindow().isDecorated()), false);
  const windowStyles = [];
  await page.locator('#app-settings-btn').click();
  for (const style of ['macos', 'windows']) {
    await page.locator(`[data-window-style-choice="${style}"]`).click();
    assert.equal(await page.evaluate(() => document.body.dataset.windowStyle), style);
    const geometry = await page.evaluate(() => {
      const rect = id => { const box = document.querySelector(id).getBoundingClientRect(); return { left: box.left, right: box.right }; };
      return { controls: rect('#desktop-window-controls'), close: rect('#window-close'), minimize: rect('#window-minimize'), maximize: rect('#window-maximize'), width: innerWidth };
    });
    if (style === 'macos') { assert.ok(geometry.controls.left < 20); assert.ok(geometry.close.left < geometry.minimize.left); }
    else { assert.ok(geometry.width - geometry.controls.right < 20); assert.ok(geometry.close.left > geometry.maximize.left); }
    windowStyles.push({ style, geometry });
    await page.screenshot({ path: join(artifacts, `desktop-titlebar-${style}.png`) });
    await until(async () => (await page.evaluate(() => window.__TAURI__.core.invoke('desktop_preferences'))).windowStyle === style, 'native style preference save');
  }
  await page.locator('#close-settings-page').click();
  await page.evaluate(() => document.querySelector('#window-maximize').click());
  await page.waitForFunction(() => document.body.classList.contains('desktop-maximized'));
  assert.equal(await page.evaluate(() => window.__TAURI__.window.getCurrentWindow().isMaximized()), true);
  await page.evaluate(() => document.querySelector('#window-maximize').click());
  await page.waitForFunction(() => !document.body.classList.contains('desktop-maximized'));
  if (process.argv.includes('--rea')) {
    const setup = await workspaceRequest('setup');
    assert.ok(setup.rea.command, 'REA must be installed for this optional acceptance check.');
    const connection = await workspaceRequest('mcp/connect', { name: 'REA', ...setup.rea });
    assert.ok(connection.count > 0);
    const task = await workspaceRequest('mcp/call', { serverId: connection.id, name: 'binary_session', args: {} });
    const snapshot = await until(async () => {
      const data = await workspaceRequest('state');
      return data.runs.find(run => run.id === task.runId)?.status !== 'running' ? data : null;
    }, 'actual REA status query');
    const run = snapshot.runs.find(run => run.id === task.runId);
    assert.equal(run.status, 'completed');
    assert.equal(run.summary.calls, 1);
    assert.equal(run.summary.success, 1);
    await page.waitForFunction(() => Number(document.querySelector('#metric-calls').textContent) === 1);
    await page.waitForFunction(() => document.querySelector('#response-content').textContent.includes('binary_session'));
    await page.screenshot({ path: join(artifacts, 'desktop-native-rea.png') });
    rea = { tools: connection.count, tool: 'binary_session', runId: task.runId, calls: run.summary.calls, success: run.summary.success };
  }
  if (process.argv.includes('--dialogs')) {
    assert.equal(process.platform, 'win32', 'Native dialog automation currently requires Windows.');
    const target = join(artifacts, 'desktop smoke target.txt');
    await writeFile(target, 'Agent Bay native file picker fixture.\n');
    await page.locator('#browse-file').click();
    await dialog('choose', 'file', target);
    await page.waitForFunction(expected => document.querySelector('#target').value === expected, target);
    await page.locator('#browse-file').click();
    await dialog('cancel', 'file');
    await page.waitForFunction(() => !document.querySelector('#browse-file').disabled);
    assert.equal(await page.locator('#target').inputValue(), target);
    await page.locator('#browse-folder').click();
    await dialog('choose', 'folder', artifacts);
    await page.waitForFunction(expected => document.querySelector('#target').value === expected, artifacts);
  }
  await page.evaluate(() => window.agentBayPreview.start({ scene: 'cleanroom', duration: 24.8, format: 'square', autoplay: false }));
  await page.evaluate(() => window.agentBayPreview.renderAt(12000));
  await page.waitForTimeout(150);
  const frame = await page.evaluate(() => window.agentBayPreview.state());
  assert.equal(frame.playing, false);
  assert.equal(frame.elapsed, 12000);
  await page.screenshot({ path: join(artifacts, 'desktop-native-preview.png') });
  if (process.argv.includes('--dialogs')) {
    await page.evaluate(() => {
      window.agentBayPreview.start({ scene: 'cleanroom', duration: 24.8, format: 'wide', presentation: false, autoplay: false });
      window.agentBayPreview.renderAt(12000);
    });
    const destination = join(artifacts, `desktop-native-export-${Date.now()}.json`);
    await page.locator('#export-btn').click();
    await dialog('choose', 'save', destination);
    await page.waitForFunction(() => document.querySelector('#toast').textContent === 'Session exported');
    const exported = JSON.parse(await readFile(destination, 'utf8'));
    assert.equal(exported.run.mode, 'demo');
    assert.ok(exported.events.length > 0);
    assert.equal(exported.retention.retainedEvents, exported.events.length);
  }
  await page.evaluate(() => window.agentBayPreview.exit());
  await page.waitForFunction(() => !document.querySelector('#browse-file').disabled);
  if (rea) assert.equal(Number(await page.locator('#metric-calls').textContent()), 1, 'preview exit restores the actual REA session');
  await page.screenshot({ path: join(artifacts, 'desktop-native-work.png') });
  assert.deepEqual(errors, []);
  await page.evaluate(() => document.querySelector('#window-minimize').click());
  await until(() => page.evaluate(() => window.__TAURI__.window.getCurrentWindow().isMinimized()), 'native window minimization');
  await page.evaluate(() => document.querySelector('#window-close').click());
  const exit = await Promise.race([closed, delay(10_000).then(() => { throw new Error('Desktop failed to close normally.'); })]);
  assert.equal(exit.code, 0);
  await until(async () => { try { await fetch(`${status.backendUrl}api/state`, { signal: AbortSignal.timeout(500) }); return false; } catch { return true; } }, 'backend port release', 5_000);
  let backendAlive = true;
  try { process.kill(status.backendPid, 0); } catch (error) { if (error.code === 'ESRCH') backendAlive = false; else throw error; }
  assert.equal(backendAlive, false, 'desktop shutdown leaves no backend process');
  const report = { checkedAt: new Date().toISOString(), exe, platform: process.platform, packageIntegrity, status, cdpPort: port, rea, preview: { elapsed: frame.elapsed, playing: frame.playing }, nativeIpc: true, nativeDialogs, chrome: { decorated: false, initialPreferences, restartPreferenceChecked: Boolean(value('--expect-style')), windowStyles, maximizedAndRestored: true, minimized: true }, browserErrors: errors, gracefulExit: exit, backendPortReleased: true, backendProcessExited: true };
  await writeFile(join(artifacts, 'desktop-verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(JSON.stringify({ error: error.message, stdout, stderr, status }, null, 2));
  process.exitCode = 1;
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    try { await page?.evaluate(() => { void window.__TAURI__.window.getCurrentWindow().close(); }); } catch {}
    await Promise.race([closed.catch(() => {}), delay(8_000)]);
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
  await browser?.close().catch(() => {});
}
