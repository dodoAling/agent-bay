import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { command, PROJECT_ROOT, sha256 } from './desktop-assets.mjs';
import { checkDesktopAssets } from './desktop-check.mjs';

const argument = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
assert.equal(process.platform, 'win32', 'This verifier exercises Windows native save dialogs.');
const exe = resolve(argument('--exe') || join(PROJECT_ROOT, 'src-tauri/target/debug/agent-bay-desktop.exe'));
assert.ok(existsSync(exe), `Build the desktop executable first: ${exe}`);
const assets = await checkDesktopAssets();
let packageIntegrity = null;
const packagedServer = join(dirname(exe), 'resources/server');
if (existsSync(join(packagedServer, 'asset-manifest.json'))) {
  const manifest = JSON.parse(await readFile(join(packagedServer, 'asset-manifest.json'), 'utf8'));
  const runtime = join(dirname(exe), 'agent-bay-node.exe');
  assert.equal(await sha256(runtime), manifest.runtime.sha256, 'the packaged runtime matches its manifest');
  assert.equal(await command(runtime, ['--version']), `v${manifest.runtime.version}`);
  for (const asset of manifest.assets) assert.equal(await sha256(join(packagedServer, asset.path)), asset.sha256, `Packaged asset integrity: ${asset.path}`);
  assert.equal(await sha256(join(packagedServer, 'public/index.html')), await sha256(join(PROJECT_ROOT, 'src-tauri/resources/server/public/index.html')), 'the packaged index matches the current staged source');
  packageIntegrity = { verifiedAssets: manifest.assets.length, runtimeVersion: manifest.runtime.version, runtimeSha256: manifest.runtime.sha256, target: manifest.target, exeSha256: await sha256(exe) };
}
const artifacts = join(PROJECT_ROOT, 'artifacts');
await mkdir(artifacts, { recursive: true });
const destination = join(artifacts, `desktop-video-native-${Date.now()}.mp4`);
const reportPath = join(artifacts, 'desktop-video-native-verification.json');
const ffprobe = argument('--ffprobe') || 'ffprobe';
const socket = createServer();
await new Promise(resolvePort => socket.listen(0, '127.0.0.1', resolvePort));
const cdpPort = socket.address().port;
await new Promise(resolvePort => socket.close(resolvePort));
const child = spawn(exe, [], {
  cwd: PROJECT_ROOT,
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdpPort} --remote-debugging-address=127.0.0.1` },
  stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false,
});
let stdout = '', stderr = '', browser, page, status, ownedPage = false, saveInFlight = false, report, servedAssets, playbackBeforeExport, playbackAfterExport;
child.stdout.on('data', chunk => { stdout += chunk; });
child.stderr.on('data', chunk => { stderr += chunk; });
const closed = new Promise((resolveExit, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolveExit({ code, signal })); });
closed.catch(() => {});
const delay = milliseconds => new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));
async function deadline(promise, message, timeout) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeout); })]); }
  finally { clearTimeout(timer); }
}
async function until(check, label, timeout = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const result = await check();
    if (result) return result;
    await delay(100);
  }
  throw new Error(`Timed out: ${label}`);
}
async function saveDialog(action) {
  const args = ['-NoProfile', '-WindowStyle', 'Hidden', '-File', join(PROJECT_ROOT, 'scripts/desktop-dialog.ps1'), '-DesktopPid', String(status.desktopPid), '-DialogTitle', 'Save demo video', '-Action', action, '-Kind', 'save'];
  if (action === 'choose') args.push('-Path', destination);
  return JSON.parse(await command('powershell.exe', args));
}
const errors = [], posts = [], progress = [], windowStyles = [];
try {
  console.log(`Starting native video verification for owned desktop PID ${child.pid}.`);
  await until(async () => {
    if (child.exitCode !== null) throw new Error(`Desktop exited before CDP: ${stderr}`);
    try { return (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).ok; } catch { return false; }
  }, 'WebView2 debugging endpoint');
  status = await until(() => {
    const line = stdout.match(/^AGENT_BAY_DESKTOP_READY (.+)$/m)?.[1];
    if (!line) return null;
    const ready = JSON.parse(line);
    return ready.phase === 'ready' ? ready : null;
  }, 'the owned desktop readiness line');
  assert.equal(status.desktopPid, child.pid);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  page = await until(() => browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url() === status.backendUrl), 'the owned backend workspace navigation');
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => {
    if (route.request().method() === 'POST') { posts.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  await page.waitForFunction(() => window.__TAURI__?.core?.invoke);
  const nativeStatus = await page.evaluate(() => window.__TAURI__.core.invoke('desktop_status'));
  assert.equal(nativeStatus.desktopPid, child.pid, 'CDP attaches only to the process launched by this verifier');
  ownedPage = true;
  status = nativeStatus;
  assert.equal(status.phase, 'ready');
  assert.equal(status.desktopPid, child.pid);
  assert.equal(new URL(status.backendUrl).origin, new URL(page.url()).origin);
  assert.ok(![4318, 4319].includes(Number(new URL(status.backendUrl).port)), 'the verifier leaves existing development services untouched');
  servedAssets = {};
  for (const filename of ['index.html', 'app.js']) {
    const expected = await sha256(join(PROJECT_ROOT, 'src-tauri/resources/server/public', filename));
    const response = await fetch(new URL(filename === 'index.html' ? '' : filename, status.backendUrl), { headers: { 'cache-control': 'no-cache' } });
    assert.ok(response.ok, `The desktop serves ${filename}.`);
    const actual = createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');
    assert.equal(actual, expected, `The running desktop serves stale ${filename}; refresh its packaged resources.`);
    servedAssets[filename] = actual;
  }
  await page.waitForSelector('#app-settings-btn:visible');
  await page.waitForFunction(() => window.agentBayPreview);
  await page.evaluate(() => {
    window.nativeVideoAudit = [];
    window.nativeVideoAuditPhase = 'ui';
    const add = detail => window.nativeVideoAudit.push({ phase: window.nativeVideoAuditPhase, time: performance.now(), ...detail });
    document.addEventListener('click', event => { const button = event.target.closest('button'); if (button?.id) add({ click: button.id, trusted: event.isTrusted }); }, true);
    addEventListener('resize', () => add({ resize: { width: innerWidth, height: innerHeight } }));
  });
  const snapshot = await (await fetch(`${status.backendUrl}api/state`)).json();
  assert.equal(snapshot.runs.length, 0);
  assert.equal(snapshot.model, null);
  assert.equal(snapshot.connections.length, 0);
  await page.locator('#app-settings-btn').click();
  assert.equal(await page.locator('#settings-page').isVisible(), true);
  for (const style of ['macos', 'windows', 'macos']) {
    await page.locator(`[data-window-style-choice="${style}"]`).click();
    await until(async () => (await page.evaluate(() => window.__TAURI__.core.invoke('desktop_preferences'))).windowStyle === style, 'native window-style preference save');
    assert.equal(await page.locator('body').getAttribute('data-window-style'), style);
    assert.equal(await page.locator(`[data-window-style-choice="${style}"]`).getAttribute('aria-pressed'), 'true');
    const geometry = await page.evaluate(() => {
      const get = id => { const r = document.querySelector(id).getBoundingClientRect(); return { x: r.x, right: r.right }; };
      return { controls: get('#desktop-window-controls'), close: get('#window-close'), minimize: get('#window-minimize'), maximize: get('#window-maximize'), width: innerWidth };
    });
    if (style === 'macos') assert.ok(geometry.controls.x < 20 && geometry.close.x < geometry.minimize.x);
    else assert.ok(geometry.width - geometry.controls.right < 20 && geometry.close.x > geometry.maximize.x);
    windowStyles.push({ style, geometry });
  }
  await page.screenshot({ path: join(artifacts, 'desktop-video-native-settings.png') });
  await page.locator('#close-settings-page').click();
  await page.locator('#demo-btn').click();
  await page.locator('#preview-form .preview-start').click();
  await page.evaluate(() => window.agentBayPreview.renderAt(12000));
  const preview = await page.evaluate(() => {
    const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
    return { ...window.agentBayPreview.state(), format: document.body.dataset.format, viewport: { width: innerWidth, height: innerHeight }, window: rect('.window'), canvas: rect('#factory-canvas'), scroll: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight } };
  });
  assert.equal(preview.scene, 'cleanroom');
  assert.equal(preview.playing, false);
  assert.equal(preview.elapsed, 12000);
  assert.equal(preview.format, 'fit');
  assert.deepEqual(preview.window, { x: 0, y: 0, width: preview.viewport.width, height: preview.viewport.height, right: preview.viewport.width, bottom: preview.viewport.height });
  assert.ok(preview.scroll.width <= preview.viewport.width && preview.scroll.height <= preview.viewport.height, 'native preview has no outer gutters or document overflow');
  assert.equal(preview.factory.layout, 'wide-factory');
  await page.locator('#preview-hide').click();
  assert.equal(await page.locator('#preview-controls').isVisible(), false);
  assert.equal(await page.locator('#preview-show-controls').isVisible(), true);
  await page.screenshot({ path: join(artifacts, 'desktop-video-native-preview.png') });
  await page.locator('#preview-show-controls').click();
  assert.equal(await page.locator('#preview-controls').isVisible(), true);
  await page.screenshot({ path: join(artifacts, 'desktop-video-native-controls.png') });
  await page.locator('#preview-download').click();
  assert.equal(await page.locator('#video-export-dialog').isVisible(), true);
  await page.locator('[data-select-id="video-export-format"] .themed-select-trigger').click();
  await page.getByRole('option', { name: 'Square · 1080 × 1080', exact: true }).click();
  await page.screenshot({ path: join(artifacts, 'desktop-video-native-export-dialog.png') });
  await page.evaluate(() => { window.nativeVideoAuditPhase = 'encoding'; });
  playbackBeforeExport = await page.evaluate(() => window.agentBayPreview.state());
  assert.equal(playbackBeforeExport.playing, false);
  assert.equal(playbackBeforeExport.elapsed, 12000);
  assert.equal(await page.evaluate(() => window.agentBayPreview.state().elapsed), 12000);
  await page.exposeFunction('__nativeVideoProgress', update => {
    progress.push(update);
    if (update.phase !== 'rendering' || update.frame % 15 === 0) console.log(`Video ${update.phase}: ${update.frame}/${update.totalFrames} frames.`);
  });
  console.log('Encoding a real two-second, 60-frame, 1080-square demo in WebView2.');
  const video = await deadline(page.evaluate(async () => {
    const { exportDemoVideo } = await import('/demo-export.js');
    const result = await exportDemoVideo({ scene: 'cleanroom', duration: 24.8, clipDuration: 2, format: 'square', fps: 30, onProgress: update => { void window.__nativeVideoProgress(update); } });
    const digest = await crypto.subtle.digest('SHA-256', await result.blob.arrayBuffer());
    const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const base64 = await new Promise((resolveBlob, reject) => { const reader = new FileReader(); reader.onload = () => resolveBlob(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(result.blob); });
    window.nativeVideoResult = { base64, filename: result.filename };
    return { scene: result.scene, format: result.format, width: result.width, height: result.height, duration: result.duration, fps: result.fps, frameCount: result.frameCount, codec: result.codec, extension: result.extension, filename: result.filename, size: result.blob.size, sha256: hash };
  }), 'Native video encoding exceeded three minutes.', 180000);
  assert.equal(video.extension, 'mp4', 'WebView2 supports the requested H.264 MP4 output');
  assert.equal(video.frameCount, 60);
  playbackAfterExport = await page.evaluate(() => window.agentBayPreview.state());
  assert.equal(await page.evaluate(() => document.querySelectorAll('[data-demo-export-frame]').length), 0, 'the isolated renderer is removed after encoding');
  saveInFlight = true;
  await page.evaluate(() => {
    window.nativeVideoSave = { state: 'pending' };
    void window.__TAURI__.core.invoke('save_video', { base64: window.nativeVideoResult.base64, defaultName: window.nativeVideoResult.filename }).then(path => { window.nativeVideoSave = { state: 'saved', path }; }, error => { window.nativeVideoSave = { state: 'failed', error: String(error) }; });
  });
  const dialog = await saveDialog('choose');
  assert.equal(dialog.passed, true);
  await page.waitForFunction(() => window.nativeVideoSave.state !== 'pending');
  const save = await page.evaluate(() => window.nativeVideoSave);
  assert.equal(save.state, 'saved', save.error);
  assert.equal(resolve(save.path), resolve(destination));
  saveInFlight = false;
  assert.equal((await stat(destination)).size, video.size);
  assert.equal(await sha256(destination), video.sha256, 'the native dialog writes the original encoded video bytes');
  const probe = JSON.parse(await command(ffprobe, ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_name,width,height,r_frame_rate,nb_frames,nb_read_frames:format=duration,size', '-of', 'json', destination]));
  const stream = probe.streams[0];
  assert.equal(stream.codec_name, 'h264');
  assert.equal(stream.width, 1080);
  assert.equal(stream.height, 1080);
  assert.equal(stream.r_frame_rate, '30/1');
  assert.equal(Number(stream.nb_read_frames), 60);
  assert.ok(Math.abs(Number(probe.format.duration) - 2) < 1 / 30);
  assert.equal(playbackAfterExport.elapsed, playbackBeforeExport.elapsed, 'offline export preserves the visible preview position');
  assert.equal(playbackAfterExport.playing, false, 'offline export preserves paused playback');
  await page.locator('#video-export-close').click();
  await page.waitForFunction(() => !document.querySelector('#video-export-dialog').open);
  assert.equal(await page.evaluate(() => window.agentBayPreview.state().elapsed), 12000);
  assert.equal(await page.evaluate(() => window.agentBayPreview.state().playing), false);
  assert.deepEqual(errors, []);
  assert.deepEqual(posts, [], 'native visual verification never invokes a model or an MCP tool');
  const finalPreferences = await page.evaluate(() => window.__TAURI__.core.invoke('desktop_preferences'));
  assert.equal(finalPreferences.windowStyle, 'macos', 'the requested macOS control style remains persisted');
  const playbackTrace = await page.evaluate(() => window.nativeVideoAudit);
  await page.evaluate(() => { void window.__TAURI__.window.getCurrentWindow().close(); });
  const exit = await deadline(closed, 'The owned desktop app did not close normally.', 10000);
  assert.equal(exit.code, 0);
  await until(async () => { try { await fetch(`${status.backendUrl}api/state`, { signal: AbortSignal.timeout(500) }); return false; } catch { return true; } }, 'owned backend port release', 5000);
  await until(() => { try { process.kill(status.backendPid, 0); return false; } catch (error) { if (error.code === 'ESRCH') return true; throw error; } }, 'owned backend process exit', 5000);
  report = { passed: true, checkedAt: new Date().toISOString(), exe, assets, packageIntegrity, servedAssets, status, cdpPort, settings: { actualClicks: true, windowStyles, finalPreferences }, preview, floatingControls: { hiddenAndRestored: true }, video: { ...video, destination, probe, dialog, progress, playbackBeforeExport, playbackAfterExport, playbackTrace }, browserErrors: errors, apiPosts: posts, gracefulExit: exit, backendPortReleased: true, backendProcessExited: true };
  console.log(`Native video passed: ${destination}. The owned app and backend are closed.`);
} catch (error) {
  report = { passed: false, checkedAt: new Date().toISOString(), exe, assets, packageIntegrity, servedAssets, status, cdpPort, error: error.stack || error.message, stdout, stderr, progress, playbackBeforeExport, playbackAfterExport, playbackTrace: ownedPage ? await page.evaluate(() => window.nativeVideoAudit).catch(() => []) : [], browserErrors: errors, apiPosts: posts };
  console.error(JSON.stringify(report, null, 2));
  try { await page?.screenshot({ path: join(artifacts, 'desktop-video-native-failure.png'), timeout: 5000 }); } catch {}
  process.exitCode = 1;
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    if (saveInFlight && status) { try { await saveDialog('cancel'); } catch {} }
    if (ownedPage) { try { await page?.evaluate(() => { void window.__TAURI__.window.getCurrentWindow().close(); }); } catch {} }
    await Promise.race([closed.catch(() => {}), delay(8000)]);
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
  await browser?.close().catch(() => {});
  if (report) await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
}
