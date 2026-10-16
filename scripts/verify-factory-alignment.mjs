import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

// Read-only browser verification: previews run entirely in the client.
const base = process.env.AGENT_BAY_URL || 'http://127.0.0.1:4319';
const artifacts = resolve('artifacts');
await mkdir(artifacts, { recursive: true });
const executablePath = process.env.AGENT_BAY_CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find(candidate => existsSync(candidate));
assert.ok(executablePath, 'Install Chrome/Chromium or set AGENT_BAY_CHROME_PATH.');
const browser = await chromium.launch({
  executablePath,
  headless: true,
});
const variants = [
  { format: 'square', width: 1080, height: 1080, presentation: true },
  { format: 'wide', width: 1600, height: 1000, presentation: true },
  { format: 'fit', width: 1600, height: 1000, presentation: true },
  { format: 'work', width: 1600, height: 1000, presentation: false },
];
const reports = [], browserErrors = [], mutations = [];

async function measure(page) {
  return page.evaluate(() => {
    const selectors = ['.window', '.workspace', '.flow-panel', '.flow-panel>.panel-heading', '.flow-scene', '#factory-canvas', '.phase-row', '.factory-progress', '.room-actions', '.detail-grid', '.timeline-panel'];
    const elements = {};
    const bounds = element => {
      const r = element.getBoundingClientRect(), style = getComputedStyle(element);
      return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom,
        display: style.display, overflow: style.overflow, scrollHeight: element.scrollHeight,
        paddingBottom: parseFloat(style.paddingBottom), marginBottom: parseFloat(style.marginBottom) };
    };
    for (const selector of selectors) elements[selector] = bounds(document.querySelector(selector));
    const canvas = document.querySelector('#factory-canvas'), ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height, data = ctx.getImageData(0, 0, w, h).data;
    const background = Array.from(data.slice(0, 3));
    let left = w, right = -1, top = h, bottom = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const delta = Math.abs(data[i] - background[0]) + Math.abs(data[i + 1] - background[1]) + Math.abs(data[i + 2] - background[2]);
      if (delta <= 34) continue;
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    const ratio = elements['#factory-canvas'].width / w;
    const ink = { left: left * ratio, right: (right + 1) * ratio, top: top * ratio, bottom: (bottom + 1) * ratio,
      widthRatio: (right - left + 1) / w, bottomPadding: (h - bottom - 1) * ratio,
      leftPadding: left * ratio, rightPadding: (w - right - 1) * ratio };
    const factory = window.agentBayPreview.factoryState();
    let count = factory?.bounds?.rejected;
    let belt = factory?.bounds?.belt;
    if (!count && window.agentBayPreview.state()?.scene === 'cleanroom') {
      // The reference scene uses its original 684 × 395 coordinate system.
      const cw = elements['#factory-canvas'].width, ch = elements['#factory-canvas'].height;
      const scale = Math.min(cw / 684, ch / 395), offset = (cw - 684 * scale) / 2;
      count = { countText: `${factory.failed} / 3`, countBounds: { x: offset + 624 * scale, y: 119 * scale, width: 42 * scale, height: 14 * scale } };
      belt = { y: 154 * scale, cardTop: 136 * scale };
    }
    const label = count?.countBounds;
    let redPixels = 0, redRows = 0;
    if (label) {
      const pixelRatio = w / elements['#factory-canvas'].width;
      const x0 = Math.max(0, Math.floor(label.x * pixelRatio)), x1 = Math.min(w, Math.ceil((label.x + label.width) * pixelRatio));
      const y0 = Math.max(0, Math.floor(label.y * pixelRatio)), y1 = Math.min(h, Math.ceil((label.y + label.height) * pixelRatio));
      for (let y = y0; y < y1; y++) {
        let hits = 0;
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4;
          if (data[i] > 110 && data[i] > data[i + 1] * 1.6 && data[i] > data[i + 2] * 1.3) hits++;
        }
        redPixels += hits;
        if (hits > 0) redRows++;
      }
    }
    return { viewport: { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth },
      elements, ink, factory, rejectedCount: { countText: count?.countText, label, redPixels, redRows, beltY: belt?.y, cardTop: belt?.cardTop },
      roomChips: Array.from(document.querySelectorAll('.room-chips span')).map(bounds),
      timelineRows: Array.from(document.querySelectorAll('.timeline .log-row')).map(bounds) };
  });
}

try {
  for (const scene of ['reverse', 'cleanroom']) for (const variant of variants) {
    const page = await browser.newPage({ viewport: { width: variant.width, height: variant.height }, deviceScaleFactor: 1 });
    page.on('pageerror', error => browserErrors.push(error.message));
    page.on('request', request => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) mutations.push({ method: request.method(), url: request.url() }); });
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.agentBayPreview);
    const duration = scene === 'cleanroom' ? 24.8 : 30;
    await page.evaluate(options => window.agentBayPreview.start(options), {
      scene, duration, format: variant.format === 'work' ? 'fit' : variant.format,
      presentation: variant.presentation, autoplay: false, controls: false,
    });
    for (const seconds of [12, duration]) {
      const key = `${scene}-${variant.format}-${String(seconds).replace('.', '_')}s`;
      await page.evaluate(ms => window.agentBayPreview.renderAt(ms), seconds * 1000);
      await page.waitForTimeout(120);
      const measured = await measure(page);
      await page.screenshot({ path: resolve(artifacts, `alignment-v4-${key}.png`), fullPage: true });
      await page.locator('.flow-panel').screenshot({ path: resolve(artifacts, `alignment-v4-${key}-factory.png`) });
      const e = measured.elements, checks = [];
      const check = (name, passed, detail) => { checks.push({ name, passed: !!passed, detail }); };
      check('no horizontal document overflow', measured.viewport.documentWidth <= variant.width, measured.viewport);
      check('drawing occupies the canvas width', measured.ink.widthRatio >= .78, measured.ink);
      check('drawing has bottom breathing room', measured.ink.bottomPadding >= 8, measured.ink);
      const rejected = measured.rejectedCount;
      check('rejected count agrees with observed demo failures', Number(rejected.countText?.match(/^\d+/)?.[0]) === measured.factory.failed, rejected);
      check('rejected count has visible red glyphs', rejected.redPixels >= 8 && rejected.redRows >= 4, rejected);
      check('rejected count stays above the belt', rejected.label && rejected.label.y + rejected.label.height <= rejected.beltY - 3, rejected);
      check('rejected count stays above travelling cards', rejected.label && rejected.label.y + rejected.label.height <= rejected.cardTop, rejected);
      check('canvas stays within its scene', e['#factory-canvas'].bottom <= e['.flow-scene'].bottom + 1 && e['#factory-canvas'].right <= e['.flow-scene'].right + 1, e['#factory-canvas']);
      if (variant.presentation) {
        for (const selector of ['.flow-panel', '.factory-progress', '.room-actions', '.detail-grid', '.timeline-panel']) {
          check(`${selector} fits within the window`, e[selector].bottom <= e['.window'].bottom + 1, e[selector]);
        }
        check('ticker can show two rows', e['.timeline-panel'].height >= 58, e['.timeline-panel']);
        check('room chips stay inside action panel', measured.roomChips.every(chip => chip.bottom <= e['.room-actions'].bottom - 3), measured.roomChips);
      }
      reports.push({ key, scene, format: variant.format, seconds, ...measured, checks });
    }
    await page.close();
  }
  const failedChecks = reports.flatMap(report => report.checks.filter(check => !check.passed).map(check => ({ key: report.key, ...check })));
  const report = { passed: failedChecks.length === 0 && browserErrors.length === 0 && mutations.length === 0,
    url: base, scenarios: reports, failedChecks, browserErrors, mutations, targetExecuted: false };
  await writeFile(resolve(artifacts, 'alignment-v4-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, scenarios: reports.length,
    failedChecks: failedChecks.map(({ key, name }) => ({ key, name })), browserErrors, mutations }, null, 2));
  assert.deepEqual(mutations, [], 'preview verification must not call backend mutations');
  assert.deepEqual(browserErrors, [], 'no browser errors');
  assert.equal(failedChecks.length, 0, 'factory alignment checks failed; see artifacts/alignment-v4-report.json');
} finally {
  await browser.close();
}
