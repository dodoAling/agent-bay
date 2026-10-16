import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const chrome = [process.env.AGENT_BAY_CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(path => path && existsSync(path));
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><link rel="stylesheet" href="/themed-select.css"><style>body{margin:25px;background:#09131d;color:#dae5f3;font:14px sans-serif}label{display:grid;gap:6px;width:280px;margin:12px 0}button{padding:8px}dialog{background:#101b2a;color:white;border:1px solid #34516f;max-height:300px;overflow:auto}.clipped{overflow:hidden;height:44px;width:280px}</style>
<form id="form"><fieldset id="fields"><label>Provider<select id="provider" name="provider" required><option value="" selected disabled>Choose a provider</option><optgroup label="Available"><option value="alpha">Alpha provider</option><option value="beta" disabled>Beta unavailable</option><option value="gamma">Gamma provider</option></optgroup></select></label></fieldset><button id="submit">Submit</button><button type="reset" id="reset">Reset</button></form>
<label>Session<select id="session"><option value="a">Session A</option><option value="b">Session B</option></select></label><button id="outside" style="position:fixed;right:20px;top:20px">Outside</button>
<div class="clipped"><label>Clipped menu<select id="clipped"><option>One</option><option>Two</option><option>Three</option><option>Four</option></select></label></div>
<dialog id="modal"><button id="dialog-close" type="button">Close dialog</button><label>Transport<select id="transport"><option value="stdio">Local stdio</option><option value="http">Streamable HTTP</option></select></label></dialog>
<script type="module">import{installThemedSelects,refreshThemedSelects}from'/themed-select.js';window.refreshSelects=refreshThemedSelects;window.changes=[];document.querySelector('#provider').addEventListener('change',e=>window.changes.push(e.target.value));document.querySelector('#form').addEventListener('submit',e=>{e.preventDefault();window.submitted=true});document.querySelector('#dialog-close').onclick=()=>document.querySelector('#modal').close();installThemedSelects(document);window.ready=true;</script></html>`;

async function fixture(t) {
  const script = await readFile(new URL('../public/themed-select.js', import.meta.url), 'utf8'), css = await readFile(new URL('../public/themed-select.css', import.meta.url), 'utf8');
  const server = createServer((req, res) => { res.setHeader('content-type', req.url.endsWith('.js') ? 'text/javascript' : req.url.endsWith('.css') ? 'text/css' : 'text/html'); res.end(req.url === '/themed-select.js' ? script : req.url === '/themed-select.css' ? css : html); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const page = await browser.newPage({ viewport: { width: 900, height: 760 } });
  page.setDefaultTimeout(4_000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); assert.deepEqual(errors, []); });
  await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => window.ready);
  return page;
}

test('Themed selects use actual clicks and keyboard input while retaining native form validation and values', { skip: !chrome, timeout: 20_000 }, async t => {
  const page = await fixture(t), provider = page.getByRole('combobox', { name: 'Provider', exact: true });
  await page.locator('#submit').click();
  await page.waitForFunction(() => document.activeElement.classList.contains('themed-select-trigger'));
  assert.equal(await provider.getAttribute('aria-invalid'), 'true');
  assert.equal(await page.evaluate(() => document.querySelector('#provider').checkValidity()), false);
  await provider.click();
  assert.equal(await provider.getAttribute('aria-expanded'), 'true');
  const popup = page.getByRole('listbox', { name: 'Provider', exact: true });
  assert.equal(await popup.evaluate(el => el.matches(':popover-open')), true);
  assert.equal(await popup.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(13, 23, 37)');
  await page.getByRole('option', { name: 'Beta unavailable', exact: true }).click({ force: true });
  assert.equal(await page.locator('#provider').inputValue(), '');
  await page.getByRole('option', { name: 'Alpha provider', exact: true }).click();
  assert.equal(await page.locator('#provider').inputValue(), 'alpha');
  assert.deepEqual(await page.evaluate(() => window.changes), ['alpha']);
  assert.equal(await page.evaluate(() => new FormData(document.querySelector('#form')).get('provider')), 'alpha');
  assert.equal(await provider.getAttribute('aria-invalid'), null);
  await provider.click(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  assert.equal(await page.locator('#provider').inputValue(), 'gamma', 'keyboard movement skips disabled options');
  await provider.click(); await page.keyboard.press('Home'); await page.keyboard.press('Enter');
  assert.equal(await page.locator('#provider').inputValue(), 'alpha');
  await provider.click(); await page.keyboard.press('g'); await page.keyboard.press('Enter');
  assert.equal(await page.locator('#provider').inputValue(), 'gamma', 'typeahead selects an eligible label');
  await provider.click(); await page.keyboard.press('Escape');
  assert.equal(await provider.getAttribute('aria-expanded'), 'false');
  assert.equal(await provider.evaluate(el => el === document.activeElement), true);
  await provider.click(); await page.locator('#outside').click();
  assert.equal(await provider.getAttribute('aria-expanded'), 'false');
  await page.locator('#submit').click(); assert.equal(await page.evaluate(() => window.submitted), true);
});

test('Dynamic options, programmatic values, disabled ancestors and resets stay synchronized without HTML injection', { skip: !chrome, timeout: 20_000 }, async t => {
  const page = await fixture(t), provider = page.getByRole('combobox', { name: 'Provider', exact: true });
  await page.evaluate(() => { document.querySelector('#provider').value = 'gamma'; window.refreshSelects(); });
  assert.match(await provider.textContent(), /Gamma provider/);
  await provider.click();
  await page.evaluate(() => { document.querySelector('#provider').value = 'alpha'; window.refreshSelects(); });
  assert.equal(await page.getByRole('option', { name: 'Alpha provider', exact: true }).getAttribute('aria-selected'), 'true');
  await page.evaluate(() => { const option = new Option('Delta <img src=x onerror=alert(1)>', 'delta'); document.querySelector('#provider').append(option); });
  await page.getByRole('option', { name: 'Delta <img src=x onerror=alert(1)>', exact: true }).click();
  assert.equal(await page.locator('#provider').inputValue(), 'delta'); assert.equal(await page.locator('img').count(), 0);
  await page.evaluate(() => { document.querySelector('#fields').disabled = true; });
  await page.waitForFunction(() => document.querySelector('[data-select-id="provider"] button').disabled);
  await page.evaluate(() => { document.querySelector('#fields').disabled = false; document.querySelector('#provider').hidden = true; });
  await page.waitForFunction(() => document.querySelector('[data-select-id="provider"]').hidden);
  await page.evaluate(() => { document.querySelector('#provider').hidden = false; });
  await page.waitForFunction(() => !document.querySelector('[data-select-id="provider"]').hidden);
  await page.evaluate(() => { document.querySelector('#session').innerHTML = '<option value="c">Session C</option><option value="d">Session D</option>'; document.querySelector('#session').value = 'd'; window.refreshSelects(); });
  assert.match(await page.getByRole('combobox', { name: 'Session', exact: true }).textContent(), /Session D/);
  await page.evaluate(() => { const select = document.createElement('select'); select.setAttribute('aria-label', 'Late selector'); select.innerHTML = '<option>Later option</option>'; document.body.append(select); });
  await page.getByRole('combobox', { name: 'Late selector', exact: true }).waitFor();
  await page.evaluate(() => document.querySelector('select[aria-label="Late selector"]').remove());
  await page.waitForFunction(() => !document.querySelector('[aria-label="Late selector"]'));
  await page.locator('#reset').click(); await page.waitForFunction(() => document.querySelector('#provider').value === '' && document.querySelector('[data-select-id="provider"] .themed-select-value').textContent === 'Choose a provider');
});

test('Dropdown popovers escape clipping and remain interactive inside a modal dialog', { skip: !chrome, timeout: 20_000 }, async t => {
  const page = await fixture(t);
  await page.getByRole('combobox', { name: 'Clipped menu', exact: true }).click();
  await page.getByRole('option', { name: 'Four', exact: true }).click();
  assert.equal(await page.locator('#clipped').inputValue(), 'Four');
  await page.evaluate(() => document.querySelector('#modal').showModal());
  const transport = page.getByRole('combobox', { name: 'Transport', exact: true }); await transport.click();
  const list = page.getByRole('listbox', { name: 'Transport', exact: true });
  assert.equal(await list.evaluate(el => el.parentElement.id), 'modal');
  assert.equal(await list.evaluate(el => el.matches(':popover-open')), true);
  await page.getByRole('option', { name: 'Streamable HTTP', exact: true }).click();
  assert.equal(await page.locator('#transport').inputValue(), 'http');
  await transport.click(); await page.keyboard.press('Escape');
  assert.equal(await page.locator('#modal').evaluate(el => el.open), true, 'Escape closes the menu before the modal');
  await transport.click(); await page.locator('#dialog-close').click();
  assert.equal(await page.locator('#modal').evaluate(el => el.open), false);
  assert.equal(await list.isVisible(), false);
});
