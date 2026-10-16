import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { createApp } from '../src/server.mjs';
import { demoVideoPlan } from '../public/demo-export.js';

test('Video export fixes output geometry and exact frame timing', () => {
  assert.deepEqual(demoVideoPlan({ scene: 'cleanroom', duration: 24.8, format: 'square' }), { scene: 'cleanroom', sceneDuration: 24.8, duration: 24.8, format: 'square', width: 1080, height: 1080, fps: 30, frameCount: 744 });
  const landscape = demoVideoPlan({ scene: 'coding', duration: 30, format: 'fit', viewport: { width: 1600, height: 1000 } });
  assert.deepEqual([landscape.format, landscape.width, landscape.height, landscape.frameCount], ['wide', 1920, 1080, 900]);
  const portrait = demoVideoPlan({ scene: 'reverse', duration: 15, format: 'portrait', clipDuration: 2 });
  assert.deepEqual([portrait.width, portrait.height, portrait.duration, portrait.frameCount], [1080, 1920, 2, 60]);
  assert.throws(() => demoVideoPlan({ scene: 'real-agent' }), /scenario/);
  assert.throws(() => demoVideoPlan({ duration: 0 }), /duration/);
  assert.throws(() => demoVideoPlan({ duration: 15, clipDuration: 16 }), /within/);
});

const chromePath = [process.env.AGENT_BAY_CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(value => value && existsSync(value));
const ffprobe = [process.env.FFPROBE_PATH, join(process.env.LOCALAPPDATA || '', 'Microsoft/WinGet/Links/ffprobe.exe'), '/usr/bin/ffprobe'].find(value => value && existsSync(value));

test('Browser exports the complete demo, preserves the current preview, and cancels cleanly', { skip: !chromePath, timeout: 180_000 }, async () => {
  const app = createApp();
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  const errors = [], posts = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.method() === 'POST') posts.push(request.url()); });
    await page.goto(`http://127.0.0.1:${app.server.address().port}/?preview=1&scene=coding&duration=30&format=square&autoplay=0&controls=0`);
    await page.waitForFunction(() => window.agentBayPreview?.state()?.scene === 'coding');
    const result = await page.evaluate(async () => {
      const { exportDemoVideo } = await import('/demo-export.js');
      agentBayPreview.renderAt(8000);
      const before = JSON.stringify(agentBayPreview.state()), progress = [];
      const video = await exportDemoVideo({ scene: 'cleanroom', duration: 24.8, format: 'square', clipDuration: 2, onProgress: value => progress.push(value) });
      window.exportedDemo = video;
      const bytes = new Uint8Array(await video.blob.arrayBuffer());
      let binary = ''; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
      return { before, after: JSON.stringify(agentBayPreview.state()), progress, ...Object.fromEntries(['width', 'height', 'fps', 'frameCount', 'duration', 'codec', 'extension'].map(key => [key, video[key]])), base64: btoa(binary), remainingFrames: document.querySelectorAll('[data-demo-export-frame]').length };
    });
    assert.equal(result.before, result.after, 'Offline rendering must leave the current virtual player untouched');
    assert.equal(result.remainingFrames, 0);
    assert.deepEqual([result.width, result.height, result.fps, result.frameCount, result.duration], [1080, 1080, 30, 60, 2]);
    assert.deepEqual(result.progress.filter(value => value.phase === 'rendering').map(value => value.frame), Array.from({ length: 60 }, (_, index) => index + 1));
    const artifacts = new URL('../artifacts/', import.meta.url);
    await mkdir(artifacts, { recursive: true });
    const videoPath = new URL(`browser-demo-export-2s.${result.extension}`, artifacts);
    await writeFile(videoPath, Buffer.from(result.base64, 'base64'));
    if (ffprobe) {
      const probe = spawnSync(ffprobe, ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_name,width,height,avg_frame_rate,nb_read_frames:format=duration', '-of', 'json', videoPath.pathname.replace(/^\/([A-Za-z]:)/, '$1')], { encoding: 'utf8', windowsHide: true });
      assert.equal(probe.status, 0, probe.stderr);
      const metadata = JSON.parse(probe.stdout), stream = metadata.streams[0];
      assert.deepEqual([stream.width, stream.height, Number(stream.nb_read_frames)], [1080, 1080, 60]);
      assert.ok(Math.abs(Number(metadata.format.duration) - 2) < .04, 'Encoded duration must match virtual time');
    }
    const cover = await page.evaluate(async () => {
      const video = document.createElement('video'); video.muted = true; video.src = URL.createObjectURL(exportedDemo.blob);
      await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = reject; });
      const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1080;
      canvas.getContext('2d').drawImage(video, 0, 0);
      URL.revokeObjectURL(video.src); return canvas.toDataURL('image/png').split(',')[1];
    });
    await writeFile(new URL('browser-demo-export-2s-cover.png', artifacts), Buffer.from(cover, 'base64'));
    const cancellation = await page.evaluate(async () => {
      const { exportDemoVideo } = await import('/demo-export.js');
      const before = JSON.stringify(agentBayPreview.state()), controller = new AbortController();
      let name;
      try { await exportDemoVideo({ scene: 'reverse', duration: 15, format: 'wide', clipDuration: 2, signal: controller.signal, onProgress: value => { if (value.frame === 2) controller.abort(); } }); }
      catch (error) { name = error.name; }
      return { name, before, after: JSON.stringify(agentBayPreview.state()), remainingFrames: document.querySelectorAll('[data-demo-export-frame]').length };
    });
    assert.equal(cancellation.name, 'AbortError');
    assert.equal(cancellation.before, cancellation.after);
    assert.equal(cancellation.remainingFrames, 0);

    const fallback = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
    fallback.on('pageerror', error => errors.push(error.message));
    fallback.on('request', request => { if (request.method() === 'POST') posts.push(request.url()); });
    await fallback.addInitScript(() => {
      const supports = VideoEncoder.isConfigSupported.bind(VideoEncoder);
      VideoEncoder.isConfigSupported = config => config.codec.startsWith('avc') ? Promise.resolve({ supported: false, config }) : supports(config);
    });
    await fallback.goto(`http://127.0.0.1:${app.server.address().port}/?preview=1&export=1&scene=research&duration=15&format=portrait&autoplay=0&controls=0`);
    await fallback.waitForFunction(() => window.agentBayPreview?.state()?.scene === 'research');
    const webm = await fallback.evaluate(async () => {
      const { exportDemoVideo } = await import('/demo-export.js');
      const video = await exportDemoVideo({ scene: 'research', duration: 15, format: 'portrait', clipDuration: .1 });
      const bytes = new Uint8Array(await video.blob.arrayBuffer());
      let binary = ''; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
      return { codec: video.codec, extension: video.extension, width: video.width, height: video.height, frameCount: video.frameCount, base64: btoa(binary) };
    });
    assert.ok(['vp9', 'vp8'].includes(webm.codec));
    assert.deepEqual([webm.extension, webm.width, webm.height, webm.frameCount], ['webm', 1080, 1920, 3]);
    const webmPath = new URL('browser-demo-export-portrait.webm', artifacts);
    await writeFile(webmPath, Buffer.from(webm.base64, 'base64'));
    if (ffprobe) {
      const probe = spawnSync(ffprobe, ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_name,width,height,nb_read_frames', '-of', 'json', webmPath.pathname.replace(/^\/([A-Za-z]:)/, '$1')], { encoding: 'utf8', windowsHide: true });
      assert.equal(probe.status, 0, probe.stderr);
      const stream = JSON.parse(probe.stdout).streams[0];
      assert.deepEqual([stream.width, stream.height, Number(stream.nb_read_frames)], [1080, 1920, 3]);
    }
    await fallback.close();
    assert.deepEqual(posts, [], 'Demo video export must not run tools or mutate the backend');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await app.close(); }
});
