import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../src/server.mjs';

const artifacts = resolve('artifacts');
await mkdir(artifacts, { recursive: true });
const chrome = [process.env.AGENT_BAY_CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(path => path && existsSync(path));
assert.ok(chrome, 'Install Chrome or set AGENT_BAY_CHROME_PATH for this development check.');
const app = createApp();
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = [], posts = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.method() === 'POST') posts.push(request.url()); });
  await page.goto(`http://127.0.0.1:${app.server.address().port}/?preview=1&scene=cleanroom&duration=24.8&format=square&autoplay=0`);
  await page.waitForFunction(() => window.agentBayPreview?.state()?.scene === 'cleanroom');
  await page.evaluate(() => window.agentBayPreview.renderAt(12000));
  const before = await page.evaluate(() => window.agentBayPreview.state());
  await page.locator('#preview-download').click();
  let download, downloadError, lastProgress = '';
  const pending = page.waitForEvent('download', { timeout: 600_000 }).then(result => { download = result; }).catch(error => { downloadError = error; });
  await page.locator('#video-export-start').click();
  while (!download && !downloadError) {
    const status = await page.locator('#video-export-status').textContent();
    if (status.startsWith('Video export failed:')) throw new Error(status);
    if (status !== lastProgress) { console.log(status); lastProgress = status; }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  if (downloadError) throw downloadError;
  await pending;
  const filename = download.suggestedFilename(), path = join(artifacts, filename);
  assert.equal(existsSync(path), false, 'Use a new artifact name rather than overwriting an existing export.');
  await download.saveAs(path);
  await page.waitForFunction(() => !document.querySelector('#video-export-dialog').open);
  const after = await page.evaluate(() => window.agentBayPreview.state());
  assert.equal(before.elapsed, after.elapsed, 'The paused preview keeps its position.');
  assert.equal(after.playing, false);
  assert.deepEqual(errors, []);
  assert.deepEqual(posts, []);
  const probe = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_name,width,height,avg_frame_rate,nb_read_frames:format=duration', '-of', 'json', path], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  assert.equal(probe.status, 0, probe.stderr || probe.error?.message);
  const metadata = JSON.parse(probe.stdout), stream = metadata.streams[0];
  assert.deepEqual([stream.width, stream.height, Number(stream.nb_read_frames), stream.avg_frame_rate], [1080, 1080, 744, '30/1']);
  assert.ok(Math.abs(Number(metadata.format.duration) - 24.8) < .04);
  const cover = path.replace(/\.(mp4|webm)$/, '-cover.png');
  const image = spawnSync('ffmpeg', ['-v', 'error', '-ss', '12', '-i', path, '-frames:v', '1', cover], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  assert.equal(image.status, 0, image.stderr || image.error?.message);
  const report = { checkedAt: new Date().toISOString(), path, cover, metadata, previewPositionPreserved: true, browserErrors: errors, postRequests: posts, viaDownloadButton: true };
  await writeFile(join(artifacts, 'demo-video-full-verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await browser?.close(); await app.close(); }
