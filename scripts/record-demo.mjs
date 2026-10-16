import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { SCENARIOS } from '../public/demo-scenarios.js';

function option(name, fallback) { const index = process.argv.indexOf(`--${name}`); return index < 0 ? fallback : process.argv[index + 1]; }
const scene = option('scene', 'reverse'), duration = Number(option('duration', '30')), format = option('format', 'square'), fps = Number(option('fps', '24'));
if (!SCENARIOS[scene] || ![15, 24.8, 30, 60].includes(duration) || !['wide', 'square', 'portrait'].includes(format) || ![12, 15, 24, 30].includes(fps)) throw new Error('Use --scene cleanroom|reverse|coding|research --duration 15|24.8|30|60 --format square|wide|portrait --fps 12|15|24|30');
const out = resolve(option('out', `artifacts/promo-${scene}-${format}-${duration}s.mp4`));
const cover = out.replace(/\.mp4$/i, '') + '-cover.png';
if (!out.toLowerCase().endsWith('.mp4')) throw new Error('--out must end in .mp4');
if (existsSync(out) || existsSync(cover)) throw new Error('Output already exists. Choose a different --out path.');
const executablePath = process.env.AGENT_BAY_CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].find(existsSync);
if (!executablePath) throw new Error('Set AGENT_BAY_CHROME_PATH to a Chromium browser executable.');
const viewport = format === 'wide' ? { width: 1920, height: 1080 } : format === 'portrait' ? { width: 1080, height: 1920 } : { width: 1080, height: 1080 };
const url = new URL(option('url', 'http://127.0.0.1:4318'));
url.search = new URLSearchParams({ preview: '1', scene, duration, format, autoplay: '0', controls: '0' }).toString();
await mkdir(dirname(out), { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
let ffmpeg, complete, encodingError, encodingLog = '';
try {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  page.on('pageerror', error => { encodingError = error; });
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForFunction(() => !!window.agentBayPreview?.state(), null, { timeout: 15000 });
  ffmpeg = spawn(process.env.AGENT_BAY_FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-n', '-f', 'image2pipe', '-framerate', String(fps), '-vcodec', 'mjpeg', '-i', 'pipe:0', '-an', '-vf', 'scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart', out], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
  ffmpeg.stderr.on('data', chunk => { encodingLog = (encodingLog + chunk.toString()).slice(-4000); });
  ffmpeg.stdin.on('error', error => { encodingError = error; });
  complete = new Promise((resolve, reject) => { ffmpeg.on('error', reject); ffmpeg.on('close', code => code === 0 ? resolve() : reject(new Error(`FFmpeg exited ${code}: ${encodingLog}`))); });
  complete.catch(error => { encodingError = error; });
  const count = Math.round(duration * fps);
  console.log(`Rendering ${scene} / ${format} / ${duration}s / ${fps}fps. No model or MCP calls.`);
  for (let frame = 0; frame < count; frame++) {
    if (encodingError) throw encodingError;
    const milliseconds = frame / fps * 1000;
    await page.evaluate(ms => window.agentBayPreview.renderAt(ms), milliseconds);
    const jpeg = await page.screenshot({ type: 'jpeg', quality: 90, animations: 'allow' });
    if (!ffmpeg.stdin.write(jpeg)) await once(ffmpeg.stdin, 'drain');
    if (frame % Math.max(1, Math.floor(count / 5)) === 0) console.log(`${Math.round(frame / count * 100)}%`);
  }
  ffmpeg.stdin.end();
  await complete;
  await page.evaluate(ms => window.agentBayPreview.renderAt(ms), duration * 940);
  await page.screenshot({ path: cover, type: 'png' });
  console.log(JSON.stringify({ video: out, cover, ...viewport, fps, duration, data: 'simulated', audio: false }));
} finally {
  if (ffmpeg && ffmpeg.exitCode == null) ffmpeg.kill();
  await browser.close();
}
