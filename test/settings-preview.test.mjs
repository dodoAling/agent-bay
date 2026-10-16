import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createApp } from '../src/server.mjs';

const chrome = [process.env.AGENT_BAY_CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(path => path && existsSync(path));
const options = { skip: !chrome, timeout: 30000 };
const fakeVideo = new Uint8Array([0, 1, 2, 255]);
const encoderModule = `
export async function exportDemoVideo({ scene, duration, format, fps, signal, onProgress }) {
  window.videoExportCalls ||= [];
  window.videoExportCalls.push({ scene, duration, format, fps });
  onProgress({ phase: 'rendering', frame: 1, totalFrames: 30, progress: .25 });
  await new Promise((resolve, reject) => {
    window.finishVideoExport = resolve;
    signal.addEventListener('abort', () => reject(new DOMException('Cancelled by the UI.', 'AbortError')), { once: true });
  });
  onProgress({ phase: 'finalizing', progress: 1 });
  return { blob: new Blob([new Uint8Array([0, 1, 2, 255])], { type: 'video/mp4' }), filename: 'fixture-demo-' + format + '.mp4' };
}
`;

async function nativeMock(page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgentData', { configurable: true, value: { platform: 'Windows' } });
    window.nativeCalls = []; window.nativeSaveResult = 'D:\\exports\\fixture-video.mp4';
    const nativeWindow = { minimize: async () => {}, close: async () => {}, startDragging: async () => {}, toggleMaximize: async () => {}, isMaximized: async () => false, onResized: async () => () => {} };
    window.__TAURI__ = { window: { getCurrentWindow: () => nativeWindow }, core: { invoke: async (command, args) => {
      window.nativeCalls.push({ command, args });
      if (command === 'desktop_preferences') return { windowStyle: 'windows' };
      if (command === 'set_window_style') return;
      if (command === 'save_video') return window.nativeSaveResult;
      throw new Error(`Unexpected native command: ${command}`);
    } } };
  });
}

async function withPage({ native = false, query = '' } = {}, run) {
  const app = createApp();
  const fixture = app.store.start({ id: 'settings-live-fixture', title: 'Live session before preview', source: 'manual' });
  app.store.push({ runId: fixture.id, type: 'log', message: 'The live session remains available after demo playback.' });
  app.store.push({ runId: fixture.id, type: 'run.end', status: 'completed' });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: chrome, headless: true });
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    const errors = [], posts = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => {
      if (route.request().method() === 'POST') { posts.push(route.request().url()); return route.abort(); }
      return route.continue();
    });
    await page.route('**/demo-export.js', route => route.fulfill({ contentType: 'text/javascript', body: encoderModule }));
    if (native) await nativeMock(page);
    await page.goto(`http://127.0.0.1:${app.server.address().port}/${query}`);
    await page.waitForFunction(() => window.agentBayPreview && document.querySelector('[data-select-id="video-export-format"] .themed-select-trigger'));
    await run(page, fixture.id);
    assert.deepEqual(posts, [], 'settings, preview and video export never start a task or invoke an MCP tool');
    assert.deepEqual(errors, [], 'the settings and preview workflows produce no browser errors');
  } finally { await browser?.close(); await app.close(); }
}

async function preview(page, { playing = false, controls = true, format = 'portrait' } = {}) {
  await page.evaluate(({ playing, controls, format }) => {
    window.agentBayPreview.start({ scene: 'cleanroom', duration: 24.8, format, presentation: true, autoplay: false, controls });
    window.agentBayPreview.renderAt(8000);
    if (playing) window.agentBayPreview.resume();
  }, { playing, controls, format });
  await page.waitForFunction(() => document.body.classList.contains('preview-active'));
}

async function screenshot(page, name) {
  if (process.env.AGENT_BAY_SCREENSHOTS !== '1') return;
  const dir = new URL('../artifacts/', import.meta.url);
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL(name, dir)) });
}

test('Native Settings pauses the demo, changes window style and resumes at the same position', options, async () => {
  await withPage({ native: true }, async page => {
    await preview(page, { playing: true });
    assert.equal(await page.locator('body').getAttribute('data-format'), 'fit', 'native playback fills the window while preserving the video preset separately');
    await page.locator('#app-settings-btn').click();
    assert.equal(await page.locator('#settings-page').isVisible(), true);
    assert.equal(await page.locator('.masthead').isVisible(), false, 'Settings replaces the workspace inside the native frame');
    const paused = await page.evaluate(() => window.agentBayPreview.state());
    assert.equal(paused.playing, false);
    assert.ok(paused.elapsed >= 8000 && paused.elapsed < paused.duration, 'opening Settings preserves an in-progress playback position');
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => window.agentBayPreview.state().elapsed), paused.elapsed, 'playback does not advance behind Settings');
    await page.locator('[data-window-style-choice="macos"]').click();
    await page.waitForFunction(() => document.body.dataset.windowStyle === 'macos' && window.nativeCalls.some(call => call.command === 'set_window_style' && call.args.style === 'macos'));
    assert.equal(await page.locator('[data-window-style-choice="macos"]').getAttribute('aria-pressed'), 'true');
    await screenshot(page, 'settings-native-appearance.png');
    await page.locator('[data-preferences-tab="connections"]').click();
    for (const button of await page.locator('[data-preferences-connect]').all()) assert.equal(await button.isDisabled(), true, 'connection changes are unavailable during demo playback');
    await page.locator('#close-settings-page').click();
    await page.waitForFunction(position => window.agentBayPreview.state().playing && window.agentBayPreview.state().elapsed > position, paused.elapsed);
    assert.equal(await page.locator('body').evaluate(body => body.classList.contains('presentation')), true);
    assert.equal(await page.locator('#settings-page').isVisible(), false);
  });
});

test('Browser Settings routes each connection category without starting a connection', options, async () => {
  await withPage({}, async page => {
    await page.locator('#preferences-btn').click();
    assert.equal(await page.locator('#settings-page').isVisible(), true);
    assert.equal(await page.locator('[data-window-style-choice="macos"]').isDisabled(), true);
    assert.match(await page.locator('#window-style-note').textContent(), /desktop app/);
    await page.locator('[data-preferences-tab="connections"]').click();
    assert.equal(await page.locator('[data-preferences-panel="appearance"]').isVisible(), false);
    await screenshot(page, 'settings-browser-connections.png');
    for (const category of ['model', 'tools', 'external']) {
      await page.locator(`[data-preferences-connect="${category}"]`).click();
      assert.equal(await page.locator('#connect-dialog').isVisible(), true);
      assert.equal(await page.locator(`[data-tab="${category}"]`).getAttribute('aria-selected'), 'true');
      assert.equal(await page.locator(`#tab-${category}`).isVisible(), true);
      await page.locator('#close-dialog').click();
    }
    await page.locator('#close-settings-page').click();
    assert.equal(await page.locator('.toolbar').isVisible(), true);
  });
});

test('Floating demo controls can be hidden and restored while recording controls stay suppressed', options, async () => {
  await withPage({ native: true }, async page => {
    await preview(page);
    assert.equal(await page.locator('#preview-controls').isVisible(), true);
    await page.locator('#preview-hide').click();
    assert.equal(await page.locator('#preview-controls').isVisible(), false);
    assert.equal(await page.locator('#preview-show-controls').isVisible(), true);
    await page.locator('#preview-show-controls').click();
    assert.equal(await page.locator('#preview-controls').isVisible(), true);
    assert.equal(await page.locator('#preview-show-controls').isVisible(), false);
    assert.equal(await page.evaluate(() => window.agentBayPreview.state().elapsed), 8000, 'showing the controls does not seek or resume paused playback');
    await screenshot(page, 'settings-preview-floating-controls.png');
    await preview(page, { controls: false });
    assert.equal(await page.locator('#preview-controls').isVisible(), false);
    assert.equal(await page.locator('#preview-show-controls').isVisible(), false);
  });
  await withPage({ native: true, query: '?export=1&preview=1&scene=cleanroom&duration=24.8&format=square&autoplay=0&controls=0' }, async page => {
    assert.equal(await page.locator('body').evaluate(body => body.classList.contains('desktop')), false, 'an export frame keeps its requested browser composition');
    assert.equal(await page.locator('body').getAttribute('data-format'), 'square');
    assert.equal(await page.locator('#preview-controls').isVisible(), false);
    assert.equal(await page.locator('#preview-show-controls').isVisible(), false);
    await page.keyboard.press('h');
    assert.equal(await page.locator('#preview-controls').isVisible(), false, 'recording output never reveals playback controls');
    assert.equal(await page.locator('#preview-show-controls').isVisible(), false);
    assert.deepEqual(await page.evaluate(() => window.nativeCalls), [], 'export frames never access native preferences or save dialogs');
  });
});

test('Video export uses the themed preset picker and resumes playback after native save or save cancellation', options, async () => {
  await withPage({ native: true }, async page => {
    for (const [index, savePath] of ['D:\\exports\\fixture-video.mp4', null].entries()) {
      await page.evaluate(path => { window.nativeSaveResult = path; }, savePath);
      await preview(page, { playing: true });
      await page.locator('#preview-download').click();
      assert.equal(await page.evaluate(() => window.agentBayPreview.state().playing), false);
      const position = await page.evaluate(() => window.agentBayPreview.state().elapsed);
      assert.equal(await page.locator('#video-export-format').inputValue(), 'portrait', 'native fit playback retains the selected export aspect ratio');
      await page.locator('[data-select-id="video-export-format"] .themed-select-trigger').click();
      await screenshot(page, 'settings-video-export-preset.png');
      await page.getByRole('option', { name: 'Landscape · 1920 × 1080', exact: true }).click();
      assert.equal(await page.locator('#video-export-format').inputValue(), 'wide');
      await page.locator('#video-export-start').click();
      await page.waitForFunction(() => window.finishVideoExport && document.querySelector('#video-export-progress').value === .25);
      assert.match(await page.locator('#video-export-status').textContent(), /Rendering 1 \/ 30 frames/);
      assert.equal(await page.evaluate(() => window.agentBayPreview.state().elapsed), position, 'playback stays paused while frames are exported');
      await page.evaluate(() => window.finishVideoExport());
      await page.waitForFunction(() => !document.querySelector('#video-export-dialog').open && window.agentBayPreview.state().playing);
      const calls = await page.evaluate(() => ({ exports: window.videoExportCalls, saves: window.nativeCalls.filter(call => call.command === 'save_video') }));
      assert.equal(calls.exports.length, index + 1);
      assert.equal(calls.saves.length, index + 1, 'both accepting and cancelling the native save dialog complete the export workflow');
      assert.deepEqual(calls.exports.at(-1), { scene: 'cleanroom', duration: 24.8, format: 'wide', fps: 30 });
      assert.equal(calls.saves.at(-1).args.defaultName, 'fixture-demo-wide.mp4');
      assert.deepEqual(new Uint8Array(Buffer.from(calls.saves.at(-1).args.base64, 'base64')), fakeVideo, 'the native save receives the generated video bytes');
      assert.ok(await page.evaluate(() => window.agentBayPreview.state().elapsed) >= position, 'closing a native save dialog preserves playback position');
    }
  });
});

test('Cancelling an active video export stops encoding and resumes only when its dialog closes', options, async () => {
  await withPage({ native: true }, async page => {
    await preview(page, { playing: true });
    await page.locator('#preview-download').click();
    const position = await page.evaluate(() => window.agentBayPreview.state().elapsed);
    await page.locator('#video-export-start').click();
    await page.waitForFunction(() => window.finishVideoExport);
    await page.locator('#video-export-cancel').click();
    await page.waitForFunction(() => document.querySelector('#video-export-status').textContent === 'Video export cancelled.' && !document.querySelector('#video-export-form').hidden);
    assert.equal(await page.locator('#video-export-dialog').isVisible(), true, 'the user can inspect cancellation before returning');
    assert.equal(await page.evaluate(() => window.agentBayPreview.state().elapsed), position);
    assert.equal(await page.evaluate(() => window.agentBayPreview.state().playing), false);
    assert.equal(await page.evaluate(() => window.nativeCalls.filter(call => call.command === 'save_video').length), 0, 'cancelled encoding never opens a save dialog');
    await page.locator('#video-export-cancel').click();
    await page.waitForFunction(() => window.agentBayPreview.state().playing);
    await page.evaluate(() => window.agentBayPreview.pause());
    const paused = await page.evaluate(() => window.agentBayPreview.state().elapsed);
    await page.locator('#preview-download').click();
    await page.locator('#video-export-close').click();
    assert.equal(await page.evaluate(() => window.agentBayPreview.state().playing), false, 'a previously paused preview remains paused');
    assert.equal(await page.evaluate(() => window.agentBayPreview.state().elapsed), paused);
  });
});

test('Browser video export downloads generated bytes and exiting the demo restores the live session', options, async () => {
  await withPage({}, async (page, fixtureId) => {
    await page.waitForFunction(id => document.querySelector('#run-select').value === id, fixtureId);
    await preview(page, { format: 'wide' });
    await page.locator('#preview-download').click();
    await page.locator('#video-export-start').click();
    await page.waitForFunction(() => window.finishVideoExport);
    const downloadEvent = page.waitForEvent('download');
    await page.evaluate(() => window.finishVideoExport());
    const download = await downloadEvent;
    assert.equal(download.suggestedFilename(), 'fixture-demo-wide.mp4');
    assert.deepEqual(new Uint8Array(await readFile(await download.path())), fakeVideo);
    await page.waitForFunction(() => !document.querySelector('#video-export-dialog').open);
    assert.equal(await page.evaluate(() => window.agentBayPreview.state().playing), false);
    assert.equal(await page.evaluate(() => window.agentBayPreview.state().elapsed), 8000);
    await page.locator('#preview-exit').click();
    await page.waitForFunction(id => document.querySelector('#run-select').value === id && !document.body.classList.contains('preview-active'), fixtureId);
    assert.equal(await page.locator('#preview-controls').isVisible(), false);
    assert.equal(await page.locator('#preview-show-controls').isVisible(), false);
  });
});
