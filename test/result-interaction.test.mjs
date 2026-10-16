import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { createApp } from '../src/server.mjs';

const chrome = [process.env.AGENT_BAY_CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(path => path && existsSync(path));
test('Result summaries, folding and copying work; updates preserve reading position and never execute tool or model HTML', { skip: !chrome, timeout: 30000 }, async () => {
  const app = createApp({ bridgeToken: 'result-reader-fixture' });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const run = app.store.start({ id: 'result-reader-ui', title: 'Result reader interaction fixture', source: 'manual' });
  const push = event => app.store.push({ runId: run.id, ...event });
  const attack = '<img src=x onerror="window.resultXss=1">';
  push({ type: 'tool.start', callId: 'read-1', name: 'inspect_managed_members_with_a_long_tool_name', args: { path: `D:/fixture/${'a'.repeat(160)}/sample.dll` } });
  push({ type: 'tool.end', callId: 'read-1', name: 'inspect_managed_members_with_a_long_tool_name', ok: true, durationMs: 153, result: { structuredContent: {
    evidence_id: 'ev_fixture', confidence: 'observed', operation: 'inspect_managed_members', provider: { id: 'fixture-static' },
    subject: { name: 'sample.dll', digest: { sha256: 'a'.repeat(64) } },
    normalized_result: { coverage: { state: 'complete' }, metadata: { table_row_counts: { MethodDef: 2 } }, methods: [{ name: 'ComputeScore' }, { name: 'Classify' }], payload: attack, rows: Array.from({ length: 60 }, (_, i) => ({ index: i, note: 'long raw fixture '.repeat(12) })) },
    limitations: ['Static fixture evidence; target was not executed.']
  } } });
  let browser;
  try {
    browser = await chromium.launch({ executablePath: chrome, headless: true });
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector('.result-title')?.textContent.includes('inspect_managed_members'));
    assert.match(await page.locator('#detail-heading').textContent(), /LATEST TOOL RESULT/);
    assert.match(await page.locator('.result-meta').textContent(), /sample\.dll/);
    assert.equal(await page.locator('#response-content img,#response-content script').count(), 0);
    await page.locator('#tool-feed [data-call]').first().click();
    await page.waitForFunction(() => document.querySelector('#detail-heading').textContent.includes('TOOL DETAILS'));
    const raw = page.locator('details[data-result-section=raw]');
    assert.equal(await page.locator('details[data-result-section=normalized]').evaluate(el => el.open), false);
    assert.equal(await raw.evaluate(el => el.open), false);
    await raw.locator('summary').click();
    const input = page.locator('details[data-result-section=input]');
    await input.locator('summary').click();
    await page.evaluate(() => {
      window.savedRawNode = document.querySelector('details[data-result-section=raw]');
      document.querySelector('#response-content').scrollTop = 150;
    });
    push({ type: 'model.start', messageId: 'answer', model: 'UI fixture' });
    const code = `const marker = '${attack}';`;
    push({ type: 'model.delta', messageId: 'answer', text: '# Analysis answer\n\n- Static evidence was inspected\n\n```js\n' + code + '\n```\n\n[Invalid link](javascript:alert(1))' });
    push({ type: 'log', message: 'A model delta arrived while the tool details were being read.' });
    await page.waitForFunction(() => document.querySelector('#event-count').textContent.startsWith('6 EVENTS'));
    assert.equal(await page.evaluate(() => window.savedRawNode === document.querySelector('details[data-result-section=raw]')), true);
    assert.equal(await raw.evaluate(el => el.open), true);
    assert.equal(await input.evaluate(el => el.open), true);
    assert.equal(await page.locator('#response-content').evaluate(el => el.scrollTop), 150);
    await raw.locator('[data-copy-result=raw]').click();
    await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('Copied current content'));
    const normalizeNewlines = text => text.replace(/\r\n/g, '\n');
    assert.equal(normalizeNewlines(await page.evaluate(() => navigator.clipboard.readText())), normalizeNewlines(await raw.locator('pre').textContent()));
    await page.locator('#show-output').click();
    await page.waitForFunction(() => document.querySelector('.agent-markdown h2')?.textContent === 'Analysis answer');
    assert.equal(await page.locator('#response-content img,#response-content script,#response-content a[href^="javascript:"]').count(), 0);
    assert.equal(await page.evaluate(() => window.resultXss), undefined);
    assert.equal(await page.locator('.tok-keyword').first().textContent(), 'const');
    await page.locator('[data-copy-result=code]').click();
    await page.waitForTimeout(80);
    assert.equal(normalizeNewlines(await page.evaluate(() => navigator.clipboard.readText())), code);
    push({ type: 'model.end', messageId: 'answer', usage: {} });
    push({ type: 'run.end', status: 'completed' });
    for (const [width, height] of [[1920, 1080], [1366, 768], [390, 844]]) {
      await page.setViewportSize({ width, height });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      if (width === 1366) {
        const layout = await page.evaluate(() => {
          const workspace = document.querySelector('.workspace'), details = document.querySelector('.detail-grid');
          return { visible: workspace.clientHeight, content: workspace.scrollHeight, resultHeight: details.getBoundingClientRect().height };
        });
        assert.ok(layout.content <= layout.visible + 2, 'laptop workspace fits without an outer scrollbar');
        assert.ok(layout.resultHeight >= 250, 'laptop retains a readable result panel');
      }
    }
    assert.deepEqual(errors, []);
  } finally { if (browser) await browser.close(); await app.close(); }
});
