import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { createApp } from '../src/server.mjs';

const chrome = [process.env.AGENT_BAY_CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(path => path && existsSync(path));

async function chooseWindowStyle(page, style) {
  if (await page.locator('#settings-page').isHidden()) await page.locator('#app-settings-btn').click();
  await page.locator(`[data-window-style-choice="${style}"]`).click();
}

async function mockDesktop(page, platform = 'Windows', { nativeStyle = null, localStyle = null, deferPreferences = false } = {}) {
  let savedStyle = nativeStyle, releasePreferences;
  const preferenceGate = deferPreferences ? new Promise(resolve => { releasePreferences = resolve; }) : Promise.resolve();
  await page.exposeFunction('__mockDesktopPreferences', async () => { const snapshot = savedStyle; await preferenceGate; return { windowStyle: snapshot }; });
  await page.exposeFunction('__mockSetWindowStyle', style => { savedStyle = style; });
  await page.addInitScript(({ platform, localStyle }) => {
    Object.defineProperty(navigator, 'userAgentData', { configurable: true, value: { platform } });
    if (localStyle) localStorage.setItem('agent-bay.window-style', localStyle);
    window.nativeCalls = []; window.nativeWindowCalls = [];
    window.pickResults = ['D:\\fixtures\\sample.dll', null, 'D:\\fixtures'];
    let maximized = false;
    const resizeListeners = new Set();
    window.setNativeMaximized = value => { maximized = value; for (const listener of resizeListeners) listener({ payload: { width: 1600, height: 1000 } }); };
    const nativeWindow = {
      minimize: async () => { window.nativeWindowCalls.push('minimize'); },
      close: async () => { window.nativeWindowCalls.push('close'); },
      startDragging: async () => { window.nativeWindowCalls.push('startDragging'); },
      toggleMaximize: async () => { window.nativeWindowCalls.push('toggleMaximize'); window.setNativeMaximized(!maximized); },
      isMaximized: async () => maximized,
      onResized: async listener => { resizeListeners.add(listener); return () => resizeListeners.delete(listener); },
    };
    window.__TAURI__ = {
      window: { getCurrentWindow: () => nativeWindow },
      core: { invoke: async (command, args) => {
        window.nativeCalls.push({ command, args });
        if (command === 'pick_target_path') return window.pickResults.shift();
        if (command === 'save_export') return 'D:\\exports\\session.json';
        if (command === 'desktop_preferences') { const value = await window.__mockDesktopPreferences(); window.nativePreferenceReadCompleted = true; return value; }
        if (command === 'set_window_style') { await window.__mockSetWindowStyle(args.style); return; }
        throw new Error(`Unexpected command: ${command}`);
      } },
    };
  }, { platform, localStyle });
  return { releasePreferences: () => releasePreferences?.() };
}

test('Desktop target selection, cancellation and native export work while browser downloads stay available', { skip: !chrome, timeout: 30000 }, async () => {
  const app = createApp();
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const run = app.store.start({ id: 'desktop-export-fixture', title: 'Native export fixture', source: 'manual' });
  app.store.push({ runId: run.id, type: 'log', message: 'Fixture output', args: { apiKey: 'fixture-private-key' } });
  app.store.push({ runId: run.id, type: 'run.end', status: 'completed' });
  let browser;
  try {
    browser = await chromium.launch({ executablePath: chrome, headless: true });
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await mockDesktop(page);
    await page.goto(url);
    await page.waitForFunction(() => !document.querySelector('#export-btn').disabled);
    assert.equal(await page.locator('#browse-file').isVisible(), true);
    await page.locator('#browse-file').click();
    await page.waitForFunction(() => document.querySelector('#target').value.endsWith('sample.dll'));
    await page.locator('#browse-file').click();
    await page.waitForFunction(() => window.nativeCalls.filter(call => call.command === 'pick_target_path').length === 2 && !document.querySelector('#browse-file').disabled);
    assert.equal(await page.locator('#target').inputValue(), 'D:\\fixtures\\sample.dll', 'cancelling preserves the target');
    await page.locator('#browse-folder').click();
    await page.waitForFunction(() => document.querySelector('#target').value === 'D:\\fixtures');
    await page.locator('#export-btn').click();
    await page.waitForFunction(() => document.querySelector('#toast').textContent === 'Session exported');
    const calls = await page.evaluate(() => window.nativeCalls);
    assert.deepEqual(calls.filter(call => call.command === 'pick_target_path').map(call => call.args), [{ directory: false }, { directory: false }, { directory: true }]);
    const exported = calls.find(call => call.command === 'save_export');
    assert.equal(exported.args.defaultName, 'agent-bay-desktop-export-fixture.json');
    const payload = JSON.parse(exported.args.data);
    assert.equal(payload.run.id, run.id);
    assert.equal(payload.events.find(event => event.type === 'log').args.apiKey, '[redacted]');
    assert.equal(exported.args.data.includes('fixture-private-key'), false);
    await page.evaluate(() => window.agentBayPreview.start({ scene: 'reverse', duration: 30, format: 'wide', presentation: false }));
    await page.waitForFunction(() => document.querySelector('#browse-file').disabled);
    await page.evaluate(() => window.agentBayPreview.exit());
    await page.waitForFunction(() => !document.querySelector('#browse-file').disabled);
    const webPage = await browser.newPage();
    await webPage.goto(url);
    await webPage.waitForFunction(() => !document.querySelector('#export-btn').disabled);
    assert.equal(await webPage.locator('#browse-file').isVisible(), false);
    assert.equal(await webPage.locator('#browse-folder').isVisible(), false);
    assert.equal(await webPage.locator('#desktop-window-controls').isVisible(), false);
    assert.equal(await webPage.locator('#window-style').isVisible(), false);
    assert.equal(await webPage.locator('body').evaluate(body => body.classList.contains('desktop')), false);
    const download = webPage.waitForEvent('download');
    await webPage.locator('#export-btn').click();
    assert.equal((await download).suggestedFilename(), 'agent-bay-desktop-export-fixture.json');
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await app.close(); }
});

test('Desktop titlebar switches platform styles, persists preferences, and routes native window controls', { skip: !chrome, timeout: 30000 }, async () => {
  const app = createApp();
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ executablePath: chrome, headless: true });
    for (const platform of ['Windows', 'macOS']) {
      const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await mockDesktop(page, platform);
      await page.goto(url);
      await page.waitForFunction(() => document.body.classList.contains('desktop') && !document.querySelector('#desktop-window-controls').hidden);
      assert.equal(await page.locator('body').getAttribute('data-window-style'), platform === 'macOS' ? 'macos' : 'windows', 'a fresh preference follows the host platform');
      for (const style of ['windows', 'macos']) {
        await chooseWindowStyle(page, style);
        await page.waitForFunction(expected => document.body.dataset.windowStyle === expected, style);
        const layout = await page.evaluate(() => {
          const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, right: r.right, width: r.width }; };
          return { titlebar: rect('.titlebar'), controls: rect('#desktop-window-controls'), minimize: rect('#window-minimize'), maximize: rect('#window-maximize'), close: rect('#window-close') };
        });
        const edge = layout.titlebar.x + layout.titlebar.width * (style === 'macos' ? .35 : .65);
        assert.ok(style === 'macos' ? layout.controls.right < edge : layout.controls.x > edge, `${style} controls use the correct titlebar side`);
        const order = style === 'macos' ? ['close', 'minimize', 'maximize'] : ['minimize', 'maximize', 'close'];
        assert.ok(layout[order[0]].x < layout[order[1]].x && layout[order[1]].x < layout[order[2]].x, `${style} button order matches the platform convention`);
        assert.equal(await page.evaluate(() => localStorage.getItem('agent-bay.window-style')), style);
        await page.waitForFunction(expected => window.nativeCalls.some(call => call.command === 'set_window_style' && call.args.style === expected), style);
      }
      const persisted = platform === 'macOS' ? 'windows' : 'macos';
      await chooseWindowStyle(page, persisted);
      await page.reload();
      await page.waitForFunction(expected => document.body.dataset.windowStyle === expected, persisted);
      assert.equal(await page.locator('[data-window-style-choice][aria-pressed=true]').getAttribute('data-window-style-choice'), persisted, 'the selection survives reload and overrides the OS default');
      await page.locator('#window-minimize').click();
      assert.deepEqual(await page.evaluate(() => window.nativeWindowCalls), ['minimize'], 'button events do not initiate window dragging');
      await page.locator('#window-maximize').click();
      await page.waitForFunction(() => document.body.classList.contains('desktop-maximized'));
      assert.equal(await page.locator('#window-maximize').getAttribute('aria-label'), 'Restore window');
      assert.equal(await page.locator('#window-maximize').getAttribute('title'), 'Restore window');
      await page.locator('#window-maximize').click();
      await page.waitForFunction(() => !document.body.classList.contains('desktop-maximized'));
      assert.equal(await page.locator('#window-maximize').getAttribute('aria-label'), 'Maximize window');
      await page.evaluate(() => window.setNativeMaximized(true));
      await page.waitForFunction(() => document.body.classList.contains('desktop-maximized'));
      assert.equal(await page.locator('#window-maximize').getAttribute('aria-label'), 'Restore window', 'native resize notifications refresh maximize state');
      await page.evaluate(() => { window.nativeWindowCalls = []; });
      await chooseWindowStyle(page, persisted);
      await page.locator('[data-window-style-choice=windows]').dispatchEvent('mousedown', { button: 0, detail: 1 });
      assert.deepEqual(await page.evaluate(() => window.nativeWindowCalls), [], 'the style picker is excluded from the drag surface');
      await page.locator('.titlebar').dispatchEvent('mousedown', { button: 0, detail: 1 });
      assert.deepEqual(await page.evaluate(() => window.nativeWindowCalls), ['startDragging']);
      await page.evaluate(() => { window.nativeWindowCalls = []; });
      const bar = await page.locator('.titlebar').boundingBox();
      await page.locator('.titlebar').dblclick({ position: { x: Math.floor(bar.width / 2), y: Math.floor(bar.height / 2) } });
      await page.waitForFunction(() => window.nativeWindowCalls.includes('toggleMaximize'));
      assert.deepEqual(await page.evaluate(() => window.nativeWindowCalls), ['startDragging', 'toggleMaximize'], 'double-click routes exactly one maximize action');
      await page.waitForFunction(() => !document.body.classList.contains('desktop-maximized'));
      await page.locator('#window-close').click();
      assert.equal(await page.evaluate(() => window.nativeWindowCalls.at(-1)), 'close');
      assert.deepEqual(errors, []);
      await context.close();
    }
    const preferenceContext = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const preferencePage = await preferenceContext.newPage();
    await mockDesktop(preferencePage, 'Windows', { nativeStyle: 'macos', localStyle: 'windows' });
    await preferencePage.goto(url);
    await preferencePage.waitForFunction(() => document.body.dataset.windowStyle === 'macos');
    assert.equal(await preferencePage.locator('[data-window-style-choice][aria-pressed=true]').getAttribute('data-window-style-choice'), 'macos', 'the native preference overrides the OS and stale localStorage');
    await chooseWindowStyle(preferencePage, 'windows');
    await preferencePage.waitForFunction(() => window.nativeCalls.some(call => call.command === 'set_window_style' && call.args.style === 'windows'));
    await preferencePage.reload();
    await preferencePage.waitForFunction(() => document.body.dataset.windowStyle === 'windows');
    assert.equal(await preferencePage.locator('[data-window-style-choice][aria-pressed=true]').getAttribute('data-window-style-choice'), 'windows', 'the native setter changes the next preference read');
    await preferenceContext.close();
    const lateContext = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const latePage = await lateContext.newPage();
    const delayed = await mockDesktop(latePage, 'Windows', { nativeStyle: 'windows', deferPreferences: true });
    await latePage.goto(url);
    await latePage.waitForFunction(() => window.nativeCalls.some(call => call.command === 'desktop_preferences'));
    await chooseWindowStyle(latePage, 'macos');
    delayed.releasePreferences();
    await latePage.waitForFunction(() => window.nativeCalls.some(call => call.command === 'set_window_style'));
    await latePage.waitForFunction(() => window.nativePreferenceReadCompleted);
    assert.equal(await latePage.locator('body').getAttribute('data-window-style'), 'macos', 'a late native preference read cannot overwrite a new user selection');
    await lateContext.close();
  } finally { await browser?.close(); await app.close(); }
});
