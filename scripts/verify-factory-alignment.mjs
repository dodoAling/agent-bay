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
    // Observe the actual draw rather than inferring glyphs from a synthetic box.
    const scaleX = elements['#factory-canvas'].width / canvas.width, scaleY = elements['#factory-canvas'].height / canvas.height;
    const transformBounds = (x, y, width, height) => {
      const matrix = ctx.getTransform();
      const corners = [[x, y], [x + width, y], [x, y + height], [x + width, y + height]].map(([xx, yy]) => ({ x: (matrix.a * xx + matrix.c * yy + matrix.e) * scaleX, y: (matrix.b * xx + matrix.d * yy + matrix.f) * scaleY }));
      const left = Math.min(...corners.map(p => p.x)), top = Math.min(...corners.map(p => p.y));
      return { x: left, y: top, width: Math.max(...corners.map(p => p.x)) - left, height: Math.max(...corners.map(p => p.y)) - top };
    };
    const fillText = ctx.fillText, roundRect = ctx.roundRect;
    let drawnCount, drawnBin, lastRectangle;
    const rectangles = [], drawnMachines = [];
    ctx.roundRect = function(x, y, width, height, ...args) {
      lastRectangle = transformBounds(x, y, width, height); rectangles.push(lastRectangle);
      return roundRect.call(this, x, y, width, height, ...args);
    };
    ctx.fillText = function(value, x, y, ...args) {
      if (/^\d+ (?:\/ 3|failed)$/.test(String(value))) {
        const metric = this.measureText(value);
        drawnCount = { text: String(value), font: this.font, ...transformBounds(x - metric.actualBoundingBoxLeft, y - metric.actualBoundingBoxAscent, metric.actualBoundingBoxLeft + metric.actualBoundingBoxRight, metric.actualBoundingBoxAscent + metric.actualBoundingBoxDescent) };
      }
      if (value === 'rejected') drawnBin = lastRectangle;
      if (/^(?:REA|build|idle|bytes [=?≠]+)$/.test(String(value)) && lastRectangle && !drawnMachines.some(rect => rect.x === lastRectangle.x && rect.y === lastRectangle.y)) drawnMachines.push(lastRectangle);
      return fillText.call(this, value, x, y, ...args);
    };
    try { window.agentBayPreview.renderAt(window.agentBayPreview.state().elapsed); }
    finally { ctx.fillText = fillText; ctx.roundRect = roundRect; }
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
      widthRatio: (right - left + 1) / w, topPadding: top * scaleY, bottomPadding: (h - bottom - 1) * scaleY,
      leftPadding: left * ratio, rightPadding: (w - right - 1) * ratio };
    const factory = window.agentBayPreview.factoryState();
    const count = factory?.bounds?.rejected, belt = factory?.bounds?.belt;
    const label = drawnCount;
    let redPixels = 0, redRows = 0;
    if (label) {
      const x0 = Math.max(0, Math.floor(label.x / scaleX)), x1 = Math.min(w, Math.ceil((label.x + label.width) / scaleX));
      const y0 = Math.max(0, Math.floor(label.y / scaleY)), y1 = Math.min(h, Math.ceil((label.y + label.height) / scaleY));
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
    const storedSlots = drawnBin && rectangles.filter(rect => rect.width >= 20 && rect.height <= 8 && rect.x > drawnBin.x && rect.x + rect.width < drawnBin.x + drawnBin.width && rect.y > drawnBin.y && rect.y + rect.height < (label?.y ?? Infinity));
    return { viewport: { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth },
      elements, ink, factory, rejectedCount: { countText: count?.countText, label, reportedLabel: count?.countBounds, bin: drawnBin,
        storedBottom: count?.storedBottom, visibleStoredBottom: storedSlots?.length ? Math.max(...storedSlots.map(rect => rect.y + rect.height)) : null,
        redPixels, redRows, beltY: belt?.y, cardTop: belt?.cardTop }, drawnMachines,
      roomChips: Array.from(document.querySelectorAll('.room-chips span')).map(bounds),
      progressRoomLabels: Array.from(document.querySelectorAll('.factory-progress-row small')).map(bounds),
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
      if (scene === 'cleanroom') {
        check('drawing has top breathing room', measured.ink.topPadding >= 8, measured.ink);
        check('drawing has balanced vertical padding', Math.abs(measured.ink.topPadding - measured.ink.bottomPadding) <= 3, measured.ink);
      }
      check('room progress labels retain 20px right breathing room', measured.progressRoomLabels.length === 2 && measured.progressRoomLabels.every(label => e['.factory-progress'].right - label.right >= 20), measured.progressRoomLabels);
      const rejected = measured.rejectedCount;
      check('rejected count agrees with observed demo failures', Number(rejected.countText?.match(/^\d+/)?.[0]) === measured.factory.failed, rejected);
      check('rejected count has visible red glyphs', rejected.redPixels >= 8 && rejected.redRows >= 4, rejected);
      check('rejected count stays above the belt', rejected.label && rejected.label.y + rejected.label.height <= rejected.beltY - 3, rejected);
      check('rejected count clears travelling cards by at least 8px', rejected.label && rejected.cardTop - rejected.label.y - rejected.label.height >= 7, rejected);
      check('rejected count has at least 8px inside the bin bottom', rejected.label && rejected.bin && rejected.bin.y + rejected.bin.height - rejected.label.y - rejected.label.height >= 7, rejected);
      check('reported glyph bounds match actual Canvas text metrics', rejected.label && rejected.reportedLabel && ['x', 'y', 'width', 'height'].every(key => Math.abs(rejected.label[key] - rejected.reportedLabel[key]) <= 1), rejected);
      if (Number.isFinite(rejected.visibleStoredBottom)) check('stored rejects clear count glyphs by at least 8px', rejected.label.y - rejected.visibleStoredBottom >= 7, rejected);
      if (measured.factory.layout === 'reference-factory') {
        check('reserved reject slots clear count glyphs by at least 8px', Number.isFinite(rejected.storedBottom) && rejected.label.y - rejected.storedBottom >= 7, rejected);
        const machines = measured.drawnMachines.slice(0, 3), gaps = machines.map(rect => rejected.beltY - rect.y - rect.height);
        check('reader, builder and oracle share a bottom alignment', gaps.length === 3 && Math.max(...gaps) - Math.min(...gaps) <= 1, { machines, gaps });
        check('machines clear the belt by at least 8px', gaps.length === 3 && gaps.every(gap => gap >= 7), { machines, gaps });
      }
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
