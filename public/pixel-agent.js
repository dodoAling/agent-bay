// One measured pixel silhouette for both the header SVG and any Canvas avatar.
// Geometry uses an 80 × 80 grid; never maintain a separate Canvas drawing.
export const PIXEL_AGENT_SIZE = 80;
export const PIXEL_AGENT_PALETTE = Object.freeze({
  coral: '#ff854d', edge: '#d56337', light: '#ff8a52',
  hat: '#f7f3ed', hatShadow: '#dcd7d3', hatBand: '#f2eae3',
  eye: '#1c0805', brow: '#9b3b26', pan: '#494450', panLip: '#6a6371',
  spark: '#e6d477', sparkDim: '#aaa35c'
});

// [x, y, width, height, palette key, semantic part]. Four legs, the stepped
// three-lobed chef hat and the slanted right eyebrow are part of the identity.
// Proportions are measured from the 1080 × 1080 reference (1.075 px per unit).
const paShape = Object.freeze([
  [8, 62, 3, 8, 'edge', 'leg'], [16, 62, 3, 8, 'edge', 'leg'],
  [33, 62, 3, 8, 'edge', 'leg'], [40, 62, 3, 8, 'edge', 'leg'],
  [10, 63, 1, 6, 'coral', 'leg'], [18, 63, 1, 6, 'coral', 'leg'],
  [35, 63, 1, 6, 'coral', 'leg'], [42, 63, 1, 6, 'coral', 'leg'],
  [0, 49, 6, 7, 'edge', 'arm'], [3, 46, 3, 10, 'coral', 'arm'],
  [46, 51, 7, 5, 'edge', 'arm'], [46, 49, 4, 6, 'coral', 'arm'],
  [5, 32, 42, 30, 'edge', 'body'], [6, 32, 40, 29, 'coral', 'body'],
  [6, 32, 1, 28, 'light', 'body'], [7, 32, 38, 1, 'light', 'body'],
  [5, 14, 10, 4, 'hat', 'hat'], [19, 14, 10, 4, 'hat', 'hat'],
  [33, 14, 10, 4, 'hat', 'hat'], [5, 18, 38, 7, 'hat', 'hat'],
  [9, 25, 31, 3, 'hatShadow', 'hat'], [9, 28, 31, 3, 'hatBand', 'hat'],
  [19.6, 39, 2.7, 6, 'eye', 'eye'], [36.3, 40, 3.7, 5, 'eye', 'eye'],
  [39.1, 36, 1.8, 1, 'eye', 'brow'], [37.25, 37, 3.6, 1, 'eye', 'brow'], [36.3, 38, 1.8, 1, 'eye', 'brow'], [36.3, 39, .9, 1, 'eye', 'brow']
]);
const paPan = Object.freeze([
  [52, 50, 5, 2, 'pan', 'pan'], [59, 50, 15, 5, 'pan', 'pan'],
  [56, 44, 22, 6, 'pan', 'pan'], [56, 45, 22, 1, 'panLip', 'pan'],
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
  const rects = pixelAgentRects(options), svg = list => list.map(({ x, y, width, height, fill }) => `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}"/>`).join('');
  // Sparks sit in their own group so an animated preview can swap them per frame.
  return `<svg viewBox="0 0 ${PIXEL_AGENT_SIZE} ${PIXEL_AGENT_SIZE}" shape-rendering="crispEdges" data-pixel-agent="shared-v1" aria-hidden="true">${svg(rects.filter(r => r.part !== 'spark'))}<g data-part="spark">${svg(rects.filter(r => r.part === 'spark'))}</g></svg>`;
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
