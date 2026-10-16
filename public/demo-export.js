// Offline export uses a separate preview document. The current workspace and
// its virtual player keep their state, including active real agent sessions.
import { t } from './i18n.js';

let exporting = false;

const SCENES = new Set(['cleanroom', 'reverse', 'coding', 'research']);
const DIMENSIONS = { square: [1080, 1080], wide: [1920, 1080], portrait: [1080, 1920] };

export function demoVideoPlan(options = {}) {
  const scene = options.scene || 'cleanroom';
  if (!SCENES.has(scene)) throw new Error(t('Choose a valid demo scenario.'));
  const duration = Number(options.duration ?? (scene === 'cleanroom' ? 24.8 : 30));
  if (![15, 24.8, 30, 60].includes(duration)) throw new Error(t('Demo duration must be 15, 24.8, 30, or 60 seconds.'));
  const fps = Number(options.fps ?? 30);
  if (![15, 24, 30].includes(fps)) throw new Error(t('Video frame rate must be 15, 24, or 30 fps.'));
  const requestedFormat = options.format || 'square';
  const viewport = options.viewport || { width: globalThis.innerWidth || 1080, height: globalThis.innerHeight || 1080 };
  const ratio = viewport.width / Math.max(1, viewport.height);
  const format = requestedFormat === 'fit' ? ratio > 1.25 ? 'wide' : ratio < .8 ? 'portrait' : 'square' : requestedFormat;
  if (!DIMENSIONS[format]) throw new Error(t('Choose a square, landscape, or portrait video.'));
  const clip = Number(options.clipDuration ?? duration);
  if (!Number.isFinite(clip) || clip <= 0 || clip > duration) throw new Error(t('The video clip must fit within the demo duration.'));
  const frameCount = Math.round(clip * fps);
  if (frameCount < 1) throw new Error(t('The video must contain at least one frame.'));
  const [width, height] = DIMENSIONS[format];
  return { scene, sceneDuration: duration, duration: frameCount / fps, format, width, height, fps, frameCount };
}

function checkAbort(signal) {
  if (signal?.aborted) throw new DOMException('Video export cancelled.', 'AbortError');
}

async function waitForPreview(iframe, scene, signal) {
  const deadline = performance.now() + 20_000;
  while (performance.now() < deadline) {
    checkAbort(signal);
    const preview = iframe.contentWindow?.agentBayPreview;
    if (preview?.state()?.scene === scene) return preview;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error(t('The isolated demo preview did not load. Reload the workspace and retry.'));
}

async function chooseCodec(vendor, plan, signal) {
  for (const candidate of [{ codec: 'avc', extension: 'mp4', mimeType: 'video/mp4' }, { codec: 'vp9', extension: 'webm', mimeType: 'video/webm' }, { codec: 'vp8', extension: 'webm', mimeType: 'video/webm' }]) {
    checkAbort(signal);
    if (await vendor.canEncodeVideo(candidate.codec, { width: plan.width, height: plan.height, frameRate: plan.fps, quality: vendor.QUALITY_HIGH })) return candidate;
  }
  throw new Error(t('This browser cannot encode video at the selected size. Use the desktop app or a browser with WebCodecs support.'));
}

function rasterColors(document) {
  // html2canvas 1.x cannot parse CSS Color 4. The calibrated action chips use
  // color-mix(), so resolve their computed colors through the browser's own
  // Canvas implementation, changing only the disposable capture document.
  const probe = document.createElement('canvas'); probe.width = probe.height = 1;
  const context = probe.getContext('2d', { willReadFrequently: true }), cache = new Map();
  const legacy = color => {
    if (cache.has(color)) return cache.get(color);
    context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data, value = `rgba(${r},${g},${b},${a / 255})`;
    cache.set(color, value); return value;
  };
  for (const element of document.querySelectorAll('.room-chips span')) {
    const computed = document.defaultView.getComputedStyle(element);
    for (const property of ['color', 'background-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'box-shadow']) {
      const value = computed.getPropertyValue(property);
      if (/(?:color|oklab|oklch|lab|lch)\(/.test(value)) element.style.setProperty(property, value.replace(/(?:color|oklab|oklch|lab|lch)\([^)]*\)/g, legacy), 'important');
    }
  }
}

export async function exportDemoVideo(options = {}) {
  const plan = demoVideoPlan(options), signal = options.signal;
  checkAbort(signal);
  if (exporting) throw new Error(t('A video export is already running.'));
  if (typeof document === 'undefined' || typeof VideoEncoder === 'undefined') throw new Error(t('Video export requires a browser with WebCodecs support.'));
  exporting = true;
  const startedAt = performance.now();
  let iframe, output, source, canvas, encoding;
  const report = (phase, frame = 0) => options.onProgress?.({ phase, frame, totalFrames: plan.frameCount, progress: frame / plan.frameCount, elapsedMs: performance.now() - startedAt, codec: encoding?.codec, extension: encoding?.extension });
  try {
    report('preparing');
    const vendor = await import('/vendor/demo-export-vendor.js');
    checkAbort(signal);
    encoding = await chooseCodec(vendor, plan, signal);
    const url = new URL('/', location.href);
    url.search = new URLSearchParams({ preview: '1', export: '1', scene: plan.scene, duration: String(plan.sceneDuration), format: plan.format, autoplay: '0', controls: '0', loop: '0' }).toString();
    iframe = document.createElement('iframe');
    iframe.title = t('Isolated demo video renderer'); iframe.tabIndex = -1;
    iframe.setAttribute('aria-hidden', 'true'); iframe.dataset.demoExportFrame = '';
    Object.assign(iframe.style, { position: 'fixed', left: '-100000px', top: '0', width: `${plan.width}px`, height: `${plan.height}px`, border: '0', pointerEvents: 'none' });
    iframe.src = url.href;
    document.body.append(iframe);
    const preview = await waitForPreview(iframe, plan.scene, signal);
    const frameDocument = iframe.contentDocument;
    await frameDocument.fonts.ready;
    checkAbort(signal);
    // Automatic CSS animations must not advance while a frame is being drawn.
    // Canvas and scripted motion still use the explicit virtual timestamp.
    const freeze = frameDocument.createElement('style');
    freeze.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
    frameDocument.head.append(freeze);
    preview.renderAt(0);
    canvas = document.createElement('canvas'); canvas.width = plan.width; canvas.height = plan.height;
    output = new vendor.Output({ format: encoding.extension === 'mp4' ? new vendor.Mp4OutputFormat({ fastStart: 'in-memory' }) : new vendor.WebMOutputFormat(), target: new vendor.BufferTarget() });
    source = new vendor.CanvasSource(canvas, { codec: encoding.codec, quality: vendor.QUALITY_HIGH, keyFrameInterval: 2, latencyMode: 'quality', contentHint: 'detail' });
    output.addVideoTrack(source, { frameRate: plan.fps });
    output.setMetadataTags({ title: 'Agent Bay demo — SIMULATED', artist: 'Agent Bay' });
    await output.start();
    for (let frame = 0; frame < plan.frameCount; frame++) {
      checkAbort(signal);
      preview.renderAt(frame * 1000 / plan.fps);
      await vendor.html2canvas(frameDocument.body, {
        canvas, width: plan.width, height: plan.height, windowWidth: plan.width, windowHeight: plan.height,
        x: 0, y: 0, scrollX: 0, scrollY: 0, scale: 1, backgroundColor: null, logging: false,
        useCORS: false, allowTaint: false, removeContainer: true,
        onclone: rasterColors,
        ignoreElements: element => element.tagName === 'IFRAME' || element.matches?.('#preview-controls,#video-export-dialog,#preview-dialog,#connect-dialog,#desktop-window-controls,#toast'),
      });
      checkAbort(signal);
      // add() applies encoder backpressure. No frame is dropped to match the
      // computer's rendering speed; every output timestamp is virtual time.
      await source.add(frame / plan.fps, 1 / plan.fps, { keyFrame: frame === 0 || frame % (plan.fps * 2) === 0 });
      report('rendering', frame + 1);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    checkAbort(signal); report('finalizing', plan.frameCount);
    source.close();
    await output.finalize();
    checkAbort(signal);
    const buffer = output.target.buffer;
    if (!buffer?.byteLength) throw new Error(t('The encoder did not produce video data.'));
    const blob = new Blob([buffer], { type: encoding.mimeType });
    return { ...plan, ...encoding, blob, filename: `agent-bay-${plan.scene}-${plan.format}-${plan.duration}s-${plan.fps}fps.${encoding.extension}` };
  } finally {
    if (output && !['finalized', 'canceled'].includes(output.state)) await output.cancel().catch(() => {});
    iframe?.remove();
    if (canvas) { canvas.width = 1; canvas.height = 1; }
    exporting = false;
  }
}
