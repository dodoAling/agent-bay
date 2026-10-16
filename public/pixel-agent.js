// One measured pixel silhouette for both the header SVG and any Canvas avatar.
// Geometry uses an 80 × 80 grid; never maintain a separate Canvas drawing.
export const PIXEL_AGENT_SIZE = 80;
export const PIXEL_AGENT_PALETTE = Object.freeze({
  coral: '#ff8056', edge: '#da6846', light: '#ff986e',
  hat: '#fff9f2', hatShadow: '#dcd7d3', hatBand: '#f2eae3',
  eye: '#24110d', brow: '#9b3b26', pan: '#494450', panLip: '#6a6371',
  spark: '#e6d477', sparkDim: '#aaa35c'
});

// [x, y, width, height, palette key, semantic part]. Four legs, the stepped
// three-lobed chef hat and the raised right eyebrow are part of the identity.
const paShape = Object.freeze([
  [8, 63, 3, 7, 'edge', 'leg'], [15, 63, 3, 7, 'edge', 'leg'],
  [34, 63, 3, 7, 'edge', 'leg'], [41, 63, 3, 7, 'edge', 'leg'],
  [10, 64, 1, 5, 'coral', 'leg'], [17, 64, 1, 5, 'coral', 'leg'],
  [36, 64, 1, 5, 'coral', 'leg'], [43, 64, 1, 5, 'coral', 'leg'],
  [0, 50, 6, 7, 'edge', 'arm'], [3, 47, 3, 10, 'coral', 'arm'],
  [46, 51, 7, 5, 'edge', 'arm'], [46, 49, 4, 6, 'coral', 'arm'],
  [5, 33, 42, 31, 'edge', 'body'], [6, 33, 40, 30, 'coral', 'body'],
  [6, 33, 1, 29, 'light', 'body'], [7, 33, 38, 1, 'light', 'body'],
  [5, 15, 10, 10, 'hat', 'hat'], [19, 15, 10, 10, 'hat', 'hat'],
  [33, 15, 10, 10, 'hat', 'hat'], [5, 20, 38, 8, 'hat', 'hat'],
  [9, 27, 31, 3, 'hatShadow', 'hat'], [9, 30, 31, 3, 'hatBand', 'hat'],
  [18, 39, 4, 7, 'eye', 'eye'], [37, 40, 3, 6, 'eye', 'eye'],
  [36, 37, 3, 2, 'brow', 'brow'], [39, 36, 2, 2, 'eye', 'brow']
]);
const paPan = Object.freeze([
  [51, 49, 7, 2, 'pan', 'pan'], [58, 48, 16, 8, 'pan', 'pan'],
  [54, 45, 26, 3, 'pan', 'pan'], [54, 45, 26, 1, 'panLip', 'pan'],
  [65, 29, 2, 2, 'spark', 'spark'], [69, 32, 3, 2, 'spark', 'spark'],
  [70, 34, 2, 4, 'spark', 'spark'], [67, 37, 3, 2, 'sparkDim', 'spark'],
  [53, 34, 2, 2, 'sparkDim', 'spark'], [57, 38, 2, 2, 'spark', 'spark']
]);

export function pixelAgentRects(options = {}) {
  const parts = options.accessory === 'none' ? paShape : [...paShape, ...paPan];
  return parts.filter(part => options.sparkles !== false || part[5] !== 'spark').map(([x, y, width, height, color, part]) => {
    if (options.blink && part === 'eye') { y += height - 2; height = 2; }
    return { x: options.direction === 'left' ? PIXEL_AGENT_SIZE - x - width : x, y, width, height, fill: PIXEL_AGENT_PALETTE[color], part };
  });
}

export function pixelAgentSvg(options = {}) {
  const rectangles = pixelAgentRects(options).map(({ x, y, width, height, fill }) => `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}"/>`).join('');
  return `<svg viewBox="0 0 ${PIXEL_AGENT_SIZE} ${PIXEL_AGENT_SIZE}" shape-rendering="crispEdges" data-pixel-agent="shared-v1" aria-hidden="true">${rectangles}</svg>`;
}

export function drawPixelAgent(ctx, x, y, scale = 1, options = {}) {
  if (!Number.isFinite(scale) || scale <= 0) return;
  ctx.save(); ctx.imageSmoothingEnabled = false;
  for (const rect of pixelAgentRects(options)) {
    // Round the shared grid boundaries, not each rectangle's width separately.
    const xx = Math.round(x + rect.x * scale), yy = Math.round(y + rect.y * scale);
    ctx.fillStyle = rect.fill;
    ctx.fillRect(xx, yy, Math.max(1, Math.round(x + (rect.x + rect.width) * scale) - xx), Math.max(1, Math.round(y + (rect.y + rect.height) * scale) - yy));
  }
  ctx.restore();
}
